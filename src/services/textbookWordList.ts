import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { DocumentRepository } from '@/entities/document/repository'
import { ProjectRepository } from '@/entities/project/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import type { VocabBook, VocabEntry, WordContext } from '@/entities/vocab/types'
import { wordKey } from '@/entities/vocab/text'
import { isGermanArticle, stripPluralArticle } from '@/entities/question/languageDrills'
import { prompts } from '@/infrastructure/ai/prompts'
import type { VocabListItem } from '@/infrastructure/ai/prompts/vocab-list-split/v1'
import { AppError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { targetLanguageOf } from '@/shared/lib/language'
import {
  appearsInSource,
  normalizeForSource,
  sourceContradictsArticle,
} from './languageDrillValidation'
import type { AIService } from './aiService'
import { t } from '@/i18n'
import { fnv1a } from '@/shared/lib/hash'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'

/**
 * Import the vocabulary list printed in a language textbook ("Szótár",
 * "Wortschatz") into the course's vocabulary book. The AI splits the lines
 * into term / gloss / article / plural / lesson; every entry is checked
 * against the text it was read from — the term must occur there as written —
 * and the student confirms the list before anything is saved.
 */

/** Characters of textbook text per request (a chapter, or part of a long one). */
export const WORD_LIST_PART_CHARS = 12_000
/** Requests in flight at once. */
const CONCURRENCY = 2
const MAX_TERM = 80
const MAX_GLOSS = 160
const MAX_LESSON = 80

/** One entry read from the textbook, before the student confirms it. */
export interface WordListCandidate {
  /** Stable within one import (list keys, edits). */
  id: string
  term: string
  gloss: string
  /** German nouns: der / die / das, as printed. */
  article?: string
  /** German nouns: the plural without article, when printed. */
  plural?: string
  lesson?: string
  /** The line the term was found on. */
  context?: WordContext
}

/** One request's worth of textbook text. */
export interface WordListPart {
  lesson?: string
  chunks: DocumentChunk[]
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** Headings that announce a vocabulary list. */
const LIST_HEADING =
  /\b(szótár|szavak|szókincs|wortschatz|vokabeln|wörter|wortliste|glossar|vocabulary|glossary|word list)\b|词汇|单词|生词/i

/**
 * Text that may hold a word list: a list heading, or mostly short lines
 * ("beteg sick, ill", "der Kopf, die Köpfe"). Prose-only parts are skipped
 * so a long textbook does not cost a request per page of reading text.
 */
export function looksLikeWordList(text: string): boolean {
  if (LIST_HEADING.test(text)) return true
  // German noun entries, often several per printed line: "der Kopf, die Köpfe".
  if ((text.match(/(?<!\p{L})(?:der|die|das)\s+\p{Lu}\p{Ll}+\s*,/gu) ?? []).length >= 3) return true
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 6) return false
  const short = lines.filter((line) => line.length <= 60 && line.split(/\s+/).length <= 8)
  return short.length / lines.length >= 0.6
}

/**
 * The document's text grouped by chapter (lesson), long chapters cut into
 * parts of at most `WORD_LIST_PART_CHARS`. Parts that do not look like a word
 * list are left out — unless none does, then every part is kept.
 */
export function planWordListParts(chunks: DocumentChunk[]): WordListPart[] {
  const parts: WordListPart[] = []
  let current: WordListPart | null = null
  let size = 0
  let chapter: string | undefined
  for (const chunk of [...chunks].sort((a, b) => a.order - b.order)) {
    const key = chunk.chapterId ?? chunk.chapterTitle
    if (!current || key !== chapter || size + chunk.text.length > WORD_LIST_PART_CHARS) {
      const lesson = clean(chunk.chapterTitle, MAX_LESSON)
      current = { ...(lesson ? { lesson } : {}), chunks: [] }
      parts.push(current)
      size = 0
      chapter = key
    }
    current.chunks.push(chunk)
    size += chunk.text.length
  }
  const listy = parts.filter((part) =>
    looksLikeWordList(part.chunks.map((chunk) => chunk.text).join('\n')),
  )
  return listy.length > 0 ? listy : parts
}

/** The line of `chunks` that contains `term`, as context for the word. */
function contextFor(
  term: string,
  chunks: DocumentChunk[],
  documentName: string | undefined,
): WordContext | undefined {
  for (const chunk of chunks) {
    for (const line of chunk.text.split('\n')) {
      if (appearsInSource(term, normalizeForSource(line))) {
        return {
          text: line.trim().slice(0, 200),
          ...(chunk.pageNumber !== undefined ? { page: chunk.pageNumber } : {}),
          ...(documentName ? { documentName } : {}),
          chunkId: chunk.id,
        }
      }
    }
  }
  return undefined
}

/**
 * Keep the entries that can be trusted, in order: the term occurs in the
 * source text (accents exact, case aside), the gloss is not empty, a given
 * article is der / die / das and not contradicted by the text's own entry. A term printed with its article ("der Kopf")
 * is split. A plural not found in the text is dropped (the entry stays).
 * Duplicates (same `wordKey`) keep their first occurrence.
 */
export function validateWordListItems(
  items: VocabListItem[],
  source: { text: string; chunks?: DocumentChunk[]; documentName?: string },
  language: string,
  fallbackLesson?: string,
): Omit<WordListCandidate, 'id'>[] {
  const normalized = normalizeForSource(source.text)
  const seen = new Set<string>()
  const kept: Omit<WordListCandidate, 'id'>[] = []
  for (const item of items) {
    let term = clean(item.term, MAX_TERM)
    let article = clean(item.article, 3).toLowerCase()
    const prefixed = /^(der|die|das)\s+(.+)$/i.exec(term)
    if (language === 'de' && prefixed) {
      if (article && article !== prefixed[1]!.toLowerCase()) continue
      article = prefixed[1]!.toLowerCase()
      term = prefixed[2]!.trim()
    }
    const gloss = clean(item.gloss, MAX_GLOSS)
    if (!term || !gloss) continue
    if (article && (language !== 'de' || !isGermanArticle(article))) continue
    if (!appearsInSource(term, normalized)) continue
    // The list itself prints the noun with another article ("die Wade, …").
    if (article && sourceContradictsArticle(term, article, normalized)) continue
    const key = wordKey(term, language)
    if (seen.has(key)) continue
    seen.add(key)
    const pluralText = stripPluralArticle(clean(item.plural, MAX_TERM))
    const plural =
      article &&
      pluralText &&
      !/^[-–—]+$/.test(pluralText) &&
      appearsInSource(pluralText, normalized)
        ? pluralText
        : ''
    const lesson = clean(item.lesson, MAX_LESSON) || fallbackLesson
    const context = source.chunks ? contextFor(term, source.chunks, source.documentName) : undefined
    kept.push({
      term,
      gloss,
      ...(article ? { article } : {}),
      ...(plural ? { plural } : {}),
      ...(lesson ? { lesson } : {}),
      ...(context ? { context } : {}),
    })
  }
  return kept
}

export interface WordListSplitResult {
  language: string
  candidates: WordListCandidate[]
  /** Parts whose request failed (the rest are still offered). */
  failedParts: number
  totalParts: number
  /** Parts read (in this run or kept from an earlier, paused one). */
  doneParts: number
  /** Paused / stopped before every part was read; the parts read are offered. */
  paused: boolean
}

/**
 * Parts already read, kept for this page visit (by document, language and
 * the part's own text), so continuing a paused import only asks for the
 * parts that are left. A reload starts over.
 */
const partCache = new Map<string, Array<Omit<WordListCandidate, 'id'>>>()

function partKey(documentId: string, language: string, part: WordListPart): string {
  const text = part.chunks.map((chunk) => `${chunk.id}\u0000${chunk.text}`).join('\u0001')
  return `${documentId}:${language}:${fnv1a(`${part.lesson ?? ''}\u0002${text}`)}`
}

/** Tests: forget the parts read in earlier runs. */
export function clearWordListPartCacheForTesting(): void {
  partCache.clear()
}

export interface WordListMergeResult {
  book: VocabBook
  added: number
  updated: number
}

export class TextbookWordListService {
  private db: AppDatabase
  private ai: AIService | null

  constructor(deps: { ai?: AIService | null; db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.ai = deps.ai ?? null
  }

  /** The language the course teaches, or a clear error for any other course. */
  private async courseLanguage(projectId: string): Promise<{ language: string; name: string }> {
    const project = await new ProjectRepository(this.db).get(projectId)
    const language = targetLanguageOf(project)
    if (!language) throw new ValidationError(t('wordList.notLanguageCourse'))
    return { language, name: project.name }
  }

  /**
   * Read the word list of one processed document: one request per part
   * (chapter), two at a time. A failed part is skipped and counted; when
   * every part fails, the first error is thrown. Paused or stopped
   * (`control`), the parts already read are returned with `paused` and kept
   * for this page visit, so running it again only reads the rest.
   */
  async split(
    projectId: string,
    documentId: string,
    options: {
      signal?: AbortSignal
      control?: GenerationControl
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<WordListSplitResult> {
    const control = resolveControl(options.control, options.signal)
    if (!this.ai) throw new AppError(t('wordList.noProvider'), 'NO_PROVIDER')
    const { language } = await this.courseLanguage(projectId)
    const document = await new DocumentRepository(this.db).get(documentId)
    if (!document || document.projectId !== projectId)
      throw new AppError(t('errors.documentNotFound'), 'NOT_FOUND')
    const chunks = await new ChunkRepository(this.db).listByDocument(documentId)
    if (chunks.length === 0) throw new ValidationError(t('wordList.noText'))
    const parts = planWordListParts(chunks)

    const results: Array<Omit<WordListCandidate, 'id'>[] | undefined> = new Array(parts.length)
    const keys = parts.map((part) => partKey(documentId, language, part))
    let failed = 0
    let firstError: unknown = null
    let done = 0
    let interrupted = false
    for (const [index, key] of keys.entries()) {
      const cached = partCache.get(key)
      if (cached) {
        results[index] = cached
        done++
      }
    }
    const queue = parts.map((_, index) => index).filter((index) => !results[index])
    options.onProgress?.(done, parts.length)
    const worker = async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        if (!control.shouldContinue()) {
          interrupted = true
          return
        }
        const part = parts[index]!
        const text = part.chunks.map((chunk) => chunk.text).join('\n')
        try {
          const { data } = await this.ai!.chatJSON<unknown>(
            [
              {
                role: 'system',
                content: prompts.vocabListSplit.buildSystemPrompt({ targetLanguage: language }),
              },
              {
                role: 'user',
                content: prompts.vocabListSplit.buildUserPrompt({
                  targetLanguage: language,
                  ...(part.lesson ? { lesson: part.lesson } : {}),
                  text,
                }),
              },
            ],
            { maxTokens: 4096, signal: control.signal },
          )
          const items = validateWordListItems(
            prompts.vocabListSplit.readItems(data),
            { text, chunks: part.chunks, documentName: document.name },
            language,
            part.lesson,
          )
          results[index] = items
          partCache.set(keys[index]!, items)
        } catch (err) {
          // A stopped request is not a failed part: it is read on continue.
          if (isAbortError(err, control.signal)) {
            interrupted = true
            return
          }
          failed++
          firstError ??= err
          results[index] = []
          logger.warn('Word list part failed', { part: index, error: (err as Error)?.message })
        }
        done++
        options.onProgress?.(done, parts.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    const paused = interrupted || !control.shouldContinue() ? done < parts.length : false
    if (!paused && failed === parts.length && firstError) throw firstError

    // One entry per word over the whole document (the first lesson wins).
    const seen = new Set<string>()
    const candidates: WordListCandidate[] = []
    for (const item of results.flatMap((items) => items ?? [])) {
      const key = wordKey(item.term, language)
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ id: `w${candidates.length + 1}`, ...item })
    }
    return {
      language,
      candidates,
      failedParts: failed,
      totalParts: parts.length,
      doneParts: done,
      paused,
    }
  }

  /**
   * Save the confirmed entries into the course's vocabulary book (created
   * when missing, in the course's language). A word already in the book —
   * same `wordKey`, or the same letters in another case — is updated with
   * the confirmed meaning, article, plural and lesson; others are added.
   * Confirmed meanings count as the student's own (`glossBy: 'user'`).
   */
  async merge(
    projectId: string,
    entries: Array<Omit<WordListCandidate, 'id'>>,
    now = Date.now(),
  ): Promise<WordListMergeResult> {
    const { language, name } = await this.courseLanguage(projectId)
    const repo = new VocabRepository(this.db)
    const existingBook = await repo.findCourseBook(projectId)
    const book: VocabBook = {
      id: existingBook?.id ?? crypto.randomUUID(),
      kind: 'course',
      name: existingBook?.name ?? name,
      projectId,
      language,
      createdAt: existingBook?.createdAt ?? now,
      updatedAt: now,
    }
    const current = await repo.listEntries(book.id)
    const byKey = new Map(current.map((entry) => [wordKey(entry.word, language), entry]))
    const byLower = new Map(current.map((entry) => [entry.word.toLowerCase(), entry]))
    const changed = new Map<string, VocabEntry>()
    let added = 0
    let updated = 0
    for (const [i, item] of entries.entries()) {
      const term = clean(item.term, MAX_TERM)
      const gloss = clean(item.gloss, MAX_GLOSS)
      if (!term || !gloss) continue
      const key = wordKey(term, language)
      const before = byKey.get(key) ?? byLower.get(term.toLowerCase())
      const grammar = {
        ...(item.article && isGermanArticle(item.article) ? { article: item.article } : {}),
        ...(item.article && item.plural ? { plural: item.plural } : {}),
        ...(item.lesson ? { lesson: item.lesson } : {}),
      }
      if (before) {
        const next: VocabEntry = {
          ...before,
          meanings: [gloss],
          glossBy: 'user',
          ...grammar,
          ...(before.context || !item.context ? {} : { context: item.context }),
        }
        if (!changed.has(before.id)) updated++
        changed.set(before.id, next)
        byKey.set(key, next)
        byLower.set(term.toLowerCase(), next)
        continue
      }
      const entry: VocabEntry = {
        id: crypto.randomUUID(),
        bookId: book.id,
        projectId,
        word: term,
        meanings: [gloss],
        glossBy: 'user',
        ...grammar,
        ...(item.context ? { context: item.context } : {}),
        // Keep the textbook's order after what the book already has.
        createdAt: now + i,
      }
      added++
      changed.set(entry.id, entry)
      byKey.set(key, entry)
      byLower.set(term.toLowerCase(), entry)
    }
    await this.db.transaction('rw', this.db.vocabBooks, this.db.vocabEntries, async () => {
      await repo.putBook(book)
      await repo.putEntries([...changed.values()])
    })
    return { book, added, updated }
  }
}
