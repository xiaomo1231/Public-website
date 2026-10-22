import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { VocabRepository } from '@/entities/vocab/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import type { DictEntry, VocabBook, VocabEntry, WordContext } from '@/entities/vocab/types'
import { extractCourseTerms, lemmaOf, wordKey, type TermSource } from '@/entities/vocab/text'
import { lookupTermOf, sentenceWith } from '@/entities/vocab/lookup'
import type { LearningMaterialType } from '@/entities/document/types'
import { loadExamLanguage } from '@/entities/project/examLanguage'
import { fnv1a } from '@/shared/lib/hash'
import { loadCommonWords } from '@/infrastructure/vocab/wordData'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { AIProviderError, type AIErrorCode } from '@/infrastructure/ai/errors'
import { aiConcurrency, withLightModel, type AIService } from './aiService'
import { createAdaptivePool, isOverloadError } from '@/shared/lib/concurrency'
import type { ProjectService } from './projectService'
import { loadProjectSubject } from './projectSubject'
import { projectTargetLanguage } from './projectTargetLanguage'
import { isEnglish, primaryLanguage } from '@/shared/lib/language'
import { vocabIndex } from './vocabService'
import { t } from '@/i18n'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'

/** Terms kept per extraction (most frequent first). */
export const COURSE_TERM_LIMIT = 150
/** Terms glossed per AI request. */
const GLOSS_BATCH = 40

/** Errors every later batch would hit too: glossing stops at the first one. */
const ACCOUNT_ERRORS = new Set<AIErrorCode>([
  'MISSING_API_KEY',
  'MISSING_BASE_URL',
  'MISSING_MODEL',
  'AUTH_FAILED',
  'QUOTA_EXCEEDED',
  'ENDPOINT_NOT_FOUND',
])

export interface CourseVocabResult {
  book: VocabBook
  added: number
  /** Meanings given by the AI in this run. */
  glossed: number
  /** Words still without a meaning (no AI, or the AI could not say). */
  unglossed: number
  total: number
  /** The glossing was paused / stopped before every batch ran (finished batches are saved). */
  paused: boolean
  /** The first AI error while glossing (the words were still saved). */
  glossError?: unknown
}

/** Gloss progress: AI batches finished / planned in this run. */
export interface CourseVocabProgress {
  done: number
  total: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A looked-up word or phrase and where it was read. */
export interface LookupInput {
  projectId: string
  /** The selected text (only a word or short phrase is kept). */
  text: string
  /** The paragraph around it; the sentence holding the word is kept. */
  surrounding?: string
  /** The meaning just shown (a Chinese translation), when there is one. */
  meaning?: string
  /** What was being read (document, lesson or assignment title). */
  documentName?: string
  page?: number
  chunkId?: string
  now?: number
}

/** Material roles read for exam key terms (unless documents are named). */
export const EXAM_TERM_ROLES: readonly LearningMaterialType[] = [
  'past_exam',
  'syllabus',
  'professor_practice',
]
/** Characters of exam text per AI request. */
export const EXAM_TERM_PART_CHARS = 8_000

export interface ExamChunk {
  id: string
  text: string
  documentName: string
  page?: number
}

export interface ValidatedExamTerm {
  term: string
  gloss: string
  context: WordContext
}

export interface ExamTermsResult {
  book: VocabBook
  added: number
  updated: number
  /** Paused / stopped before every part was read (the parts read are saved). */
  paused: boolean
  /** Parts that failed (the others are saved). */
  failed: number
  error?: unknown
}

/** Exam chunks in parts of at most `EXAM_TERM_PART_CHARS` (a longer chunk is a part of its own). */
export function planExamTermParts(chunks: readonly ExamChunk[]): ExamChunk[][] {
  const parts: ExamChunk[][] = []
  let current: ExamChunk[] = []
  let size = 0
  for (const chunk of chunks) {
    const text = chunk.text.slice(0, EXAM_TERM_PART_CHARS)
    if (current.length > 0 && size + text.length > EXAM_TERM_PART_CHARS) {
      parts.push(current)
      current = []
      size = 0
    }
    current.push({ ...chunk, text })
    size += text.length
  }
  if (current.length > 0) parts.push(current)
  return parts
}

/**
 * Parts already read in this page visit (by course and the part's text), so
 * continuing a paused extraction only asks for the rest. A reload starts over.
 */
const examTermCache = new Map<string, ValidatedExamTerm[]>()

function examPartKey(projectId: string, part: readonly ExamChunk[]): string {
  return `${projectId}:${fnv1a(part.map((chunk) => `${chunk.id}\u0000${chunk.text}`).join('\u0001'))}`
}

/** Tests: forget the parts read in earlier runs. */
export function clearExamTermCacheForTesting(): void {
  examTermCache.clear()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `term` as a whole word / phrase in `text`, ignoring case and spacing. */
function termPattern(term: string, flags = 'iu'): RegExp {
  const body = term.normalize('NFC').trim().split(/\s+/).map(escapeRegExp).join('\\s+')
  return new RegExp(`(?<![\\p{L}\\p{M}])${body}(?![\\p{L}\\p{M}])`, flags)
}

/** How often `term` occurs in `text` (whole words, any case). */
export function countOccurrences(text: string, term: string): number {
  return (text.normalize('NFC').match(termPattern(term, 'giu')) ?? []).length
}

/**
 * The AI's exam terms that hold up: a word or short phrase (`lookupTermOf`),
 * found verbatim in the chunk named, not repeated; the sentence comes from that chunk.
 */
export function validateExamTerms(
  items: ReadonlyArray<{ term: string; chunkId: string; gloss: string }>,
  part: readonly ExamChunk[],
): ValidatedExamTerm[] {
  const byId = new Map(part.map((chunk) => [chunk.id, chunk]))
  const seen = new Set<string>()
  const kept: ValidatedExamTerm[] = []
  for (const item of items) {
    const term = lookupTermOf(item.term)
    const chunk = byId.get(item.chunkId)
    if (!term || !chunk) continue
    const match = chunk.text.normalize('NFC').match(termPattern(term))
    if (!match) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push({
      term: match[0].replace(/\s+/g, ' '),
      gloss: item.gloss,
      context: {
        text: sentenceWith(chunk.text, match[0]) || term,
        documentName: chunk.documentName,
        ...(chunk.page !== undefined ? { page: chunk.page } : {}),
        chunkId: chunk.id,
      },
    })
  }
  return kept
}

/**
 * A course's own vocabulary: the uncommon words of its material, each with
 * the sentence and page it was found on. For English material meanings come
 * from the dictionary, otherwise from the student's AI (cached in the entry).
 * A course taught in another language (`Project.targetLanguage`) gets a book
 * in that language: words as written, no English dictionary, word lists or
 * lemmatisation, meanings from the AI only.
 */
export class CourseVocabService {
  private repo: VocabRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private projects: ProjectService
  private ai: AIService | null
  private db: AppDatabase

  constructor(deps: { projects: ProjectService; ai?: AIService | null; db?: AppDatabase }) {
    const db = deps.db ?? getDb()
    this.db = db
    this.repo = new VocabRepository(db)
    this.documents = new DocumentRepository(db)
    this.chunks = new ChunkRepository(db)
    this.projects = deps.projects
    this.ai = deps.ai ?? null
  }

  /**
   * Pick the course terms out of the material (adding new ones to the course
   * book, refreshing counts of known ones), then gloss what still has no
   * meaning. The book and its entries are saved before glossing starts and
   * every finished gloss batch is saved at once, so a pause, a stop or a
   * closed tab keeps what was done; running it again glosses only the words
   * still without a meaning.
   */
  async extract(
    projectId: string,
    options: {
      signal?: AbortSignal
      control?: GenerationControl
      onProgress?: (progress: CourseVocabProgress) => void
      now?: number
    } = {},
  ): Promise<CourseVocabResult> {
    const control = resolveControl(options.control, options.signal)
    const now = options.now ?? Date.now()
    const project = await this.projects.get(projectId)
    const documents = selectAnalysisDocuments(await this.documents.listByProject(projectId))
    if (documents.length === 0) throw new AppError(t('errors.noProcessedDocuments'), 'NO_DOCUMENTS')

    const sources: TermSource[] = []
    for (const doc of documents) {
      for (const chunk of await this.chunks.listByDocument(doc.id)) {
        sources.push({
          text: chunk.text,
          ...(chunk.pageNumber !== undefined ? { page: chunk.pageNumber } : {}),
          documentName: doc.name,
          chunkId: chunk.id,
        })
      }
    }

    const targetLanguage = await projectTargetLanguage(projectId)
    const language = isEnglish(targetLanguage) ? undefined : targetLanguage
    const [english, englishCommon] = await Promise.all([vocabIndex(), loadCommonWords()])
    const { byWord, lemmas } = language
      ? { byWord: new Map<string, DictEntry>(), lemmas: new Map<string, string>() }
      : english
    const common = language ? new Set<string>() : englishCommon
    // Words from school-level and CET-4 lists count as known to a university student.
    const basic = (word: string) => {
      const entry = byWord.get(word)
      return Boolean(
        entry && entry.tags.some((tag) => tag === 'zk' || tag === 'gk' || tag === 'cet4'),
      )
    }
    const known = (word: string) => byWord.has(word) || common.has(word)
    // Language textbooks are bilingual: their glosses and instructions are
    // English. In a foreign-language course an English word is not a course
    // term — except a German noun English shares (Hand, Name): capitalised
    // inside a sentence, where an English instruction word ("Please") is not.
    const englishKnown = (word: string) => english.byWord.has(word) || englishCommon.has(word)
    const isEnglishWord = (surface: string, initial = false): boolean => {
      if (primaryLanguage(language) === 'de' && !initial && /^\p{Lu}\p{Ll}/u.test(surface))
        return false
      const lower = surface.toLowerCase()
      if (!/^[a-z'-]+$/.test(lower)) return false
      // "Pain-where", "patient's": judged by their first English part.
      const head = lower.split(/['-]/)[0] ?? lower
      return [lower, head].some(
        (form) =>
          form.length > 1 &&
          (englishKnown(form) || englishKnown(lemmaOf(form, english.lemmas, englishKnown))),
      )
    }
    const candidates = extractCourseTerms(sources, {
      isCommon: (word, initial) =>
        language ? isEnglishWord(word, initial) : common.has(word) || basic(word),
      lemma: (token) => lemmaOf(token, lemmas, known),
      limit: COURSE_TERM_LIMIT,
      ...(language ? { language } : {}),
    })

    let book = await this.repo.findCourseBook(projectId)
    book = {
      id: book?.id ?? crypto.randomUUID(),
      kind: 'course',
      name: project.name,
      projectId,
      ...(language ? { language } : {}),
      createdAt: book?.createdAt ?? now,
      updatedAt: now,
    }
    // Every entry of the book after this run, by word: earlier ones (counts
    // refreshed when found again) plus the new ones. Words of another
    // language are matched regardless of case (the written form wins once).
    const termKey = (word: string) => (language ? word.toLowerCase() : word)
    const byTerm = new Map(
      (await this.repo.listEntries(book.id)).map((entry) => [termKey(entry.word), entry]),
    )
    const fresh = new Set<string>()
    for (const [i, candidate] of candidates.entries()) {
      const before = byTerm.get(termKey(candidate.word))
      if (before) {
        byTerm.set(termKey(candidate.word), {
          ...before,
          occurrences: candidate.occurrences,
          context: before.context ?? candidate.context,
        })
        continue
      }
      const entry = byWord.get(candidate.word)
      const id = crypto.randomUUID()
      fresh.add(id)
      byTerm.set(termKey(candidate.word), {
        id,
        bookId: book.id,
        projectId,
        word: candidate.word,
        ...(entry?.phonetic ? { phonetic: entry.phonetic } : {}),
        meanings: entry?.meanings ?? [],
        context: candidate.context,
        occurrences: candidate.occurrences,
        glossBy: entry ? 'dictionary' : 'none',
        createdAt: now + i,
      })
    }

    const entries = [...byTerm.values()]
    await this.repo.putBook(book)
    await this.repo.putEntries(entries)
    const { glossed, dropped, paused, error } = await this.gloss(
      entries,
      await loadProjectSubject(projectId),
      language,
      control,
      options.onProgress,
    )
    const kept = entries.filter((entry) => !dropped.has(entry.id))
    return {
      book,
      added: kept.filter((entry) => fresh.has(entry.id)).length,
      glossed,
      unglossed: kept.filter((entry) => entry.meanings.length === 0).length,
      total: kept.length,
      paused,
      ...(error !== undefined ? { glossError: error } : {}),
    }
  }

  /**
   * The course book, created when missing (named after the course, in the
   * language it teaches). Not saved here.
   */
  private async ensureBook(projectId: string, now: number): Promise<VocabBook> {
    const existing = await this.repo.findCourseBook(projectId)
    if (existing) return existing
    const project = await this.projects.get(projectId)
    const targetLanguage = await projectTargetLanguage(projectId)
    const language = isEnglish(targetLanguage) ? undefined : targetLanguage
    return {
      id: crypto.randomUUID(),
      kind: 'course',
      name: project.name,
      projectId,
      ...(language ? { language } : {}),
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * A word or short phrase the student looked up (划词翻译 / 解释) in this
   * course goes into its course book with the sentence it was read in; a
   * repeated lookup counts again (and moves it up the study order). A word
   * already being learnt that is looked up again comes back tomorrow at the
   * latest. Never an AI call: the meaning is the translation just shown, or
   * the dictionary's. Sentences, Chinese text and formulas are ignored (null).
   */
  async recordLookup(input: LookupInput): Promise<{ entry: VocabEntry; added: boolean } | null> {
    const term = lookupTermOf(input.text)
    if (!term) return null
    const now = input.now ?? Date.now()
    const book = await this.ensureBook(input.projectId, now)
    const language = isEnglish(book.language) ? undefined : book.language
    let word = wordKey(term, language)
    let dictionary: DictEntry | undefined
    if (!language) {
      try {
        const { byWord, lemmas } = await vocabIndex()
        if (!word.includes(' ') && !byWord.has(word))
          word = lemmaOf(word, lemmas, (w) => byWord.has(w))
        dictionary = byWord.get(word)
      } catch {
        // No dictionary data: the word is kept as typed.
      }
    }
    const sentence = input.surrounding ? sentenceWith(input.surrounding, term) : ''
    const context: WordContext = {
      text: sentence || term,
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.documentName ? { documentName: input.documentName } : {}),
      ...(input.chunkId ? { chunkId: input.chunkId } : {}),
    }
    const meaning = input.meaning?.trim()
    const shortMeaning = meaning && meaning.length <= 60 ? meaning : undefined
    const sameWord = (entry: VocabEntry) =>
      language ? entry.word.toLowerCase() === word.toLowerCase() : entry.word === word

    let result: { entry: VocabEntry; added: boolean } | null = null
    await this.db.transaction(
      'rw',
      this.db.vocabBooks,
      this.db.vocabEntries,
      this.db.vocabCards,
      async () => {
        const before = (await this.repo.listEntries(book.id)).find(sameWord)
        let entry: VocabEntry
        if (before) {
          const needsMeaning = before.meanings.length === 0 && (shortMeaning || dictionary)
          entry = {
            ...before,
            lookups: (before.lookups ?? 0) + 1,
            lastLookedUpAt: now,
            ...(before.context ? {} : { context }),
            ...(needsMeaning
              ? shortMeaning
                ? { meanings: [shortMeaning], glossBy: 'ai' as const }
                : { meanings: dictionary!.meanings, glossBy: 'dictionary' as const }
              : {}),
          }
        } else {
          entry = {
            id: crypto.randomUUID(),
            bookId: book.id,
            projectId: input.projectId,
            word,
            ...(dictionary?.phonetic ? { phonetic: dictionary.phonetic } : {}),
            meanings: dictionary?.meanings.length
              ? dictionary.meanings
              : shortMeaning
                ? [shortMeaning]
                : [],
            context,
            glossBy: dictionary?.meanings.length ? 'dictionary' : shortMeaning ? 'ai' : 'none',
            origin: 'lookup',
            lookups: 1,
            lastLookedUpAt: now,
            createdAt: now,
          }
        }
        await this.repo.putBook({ ...book, updatedAt: now })
        await this.repo.putEntries([entry])
        // Looked up again while being learnt: probably not remembered.
        const card = await this.repo.getCard(entry.word)
        const tomorrow = now + DAY_MS
        if (card && card.due > tomorrow) {
          await this.repo.putCard({
            ...card,
            due: tomorrow,
            scheduled_days: Math.min(card.scheduled_days, 1),
          })
        }
        result = { entry, added: !before }
      },
    )
    return result
  }

  /**
   * AI-picked high-frequency key terms of the course's exam papers and review
   * materials (往年试卷 / 课程大纲 / 教授练习, or the `documentIds` given),
   * added to the course book with their sentence and occurrence count. One
   * request per ≤ 8 000-character part, through the shared AI pool; every
   * finished part is saved at once. Paused or stopped, the parts read are
   * kept for this page visit, so running it again reads only the rest. A term
   * is kept only if it occurs verbatim in the chunk the AI names; counts and
   * sentences come from the text itself.
   */
  async extractExamTerms(
    projectId: string,
    options: {
      control?: GenerationControl
      signal?: AbortSignal
      documentIds?: string[]
      onProgress?: (progress: CourseVocabProgress) => void
      now?: number
    } = {},
  ): Promise<ExamTermsResult> {
    const control = resolveControl(options.control, options.signal)
    const ai = this.ai
    if (!ai) throw new AppError(t('vocab.examTerms.noProvider'), 'NO_PROVIDER')
    const now = options.now ?? Date.now()
    const wanted = options.documentIds ? new Set(options.documentIds) : null
    const documents = (await this.documents.listByProject(projectId)).filter(
      (doc) =>
        doc.status === 'ready' &&
        (wanted ? wanted.has(doc.id) : EXAM_TERM_ROLES.includes(doc.materialType ?? 'textbook')),
    )
    if (documents.length === 0)
      throw new AppError(t('vocab.examTerms.noMaterials'), 'NO_EXAM_MATERIALS')

    const chunks: ExamChunk[] = []
    for (const doc of documents)
      for (const chunk of await this.chunks.listByDocument(doc.id))
        if (chunk.text.trim())
          chunks.push({
            id: chunk.id,
            text: chunk.text,
            documentName: doc.name,
            ...(chunk.pageNumber !== undefined ? { page: chunk.pageNumber } : {}),
          })
    const parts = planExamTermParts(chunks)
    const book = await this.ensureBook(projectId, now)
    const language = isEnglish(book.language) ? undefined : book.language
    const examLanguage =
      language ?? (await loadExamLanguage(this.db, projectId).catch(() => undefined))
    const subject = await loadProjectSubject(projectId, this.db)
    const allText = chunks.map((chunk) => chunk.text).join('\n')

    let done = 0
    let failed = 0
    let firstError: unknown
    let interrupted = false
    let halted = false
    const total = parts.length
    const keys = parts.map((part) => examPartKey(projectId, part))
    const queue = parts.map((_, index) => index).filter((index) => !examTermCache.has(keys[index]!))
    done = total - queue.length
    options.onProgress?.({ done, total })
    let added = 0
    let updated = 0

    const save = async (terms: ValidatedExamTerm[]) => {
      const counts = await this.mergeExamTerms(book, projectId, terms, allText, language, now)
      added += counts.added
      updated += counts.updated
    }

    const outcomes = await createAdaptivePool({ max: aiConcurrency(ai), control }).run(
      queue,
      async (index, ctx): Promise<void> => {
        const part = parts[index]!
        try {
          const { data } = await ai.chatJSON<unknown>(
            [
              {
                role: 'system',
                content: prompts.examTerms.buildSystemPrompt(
                  examLanguage && examLanguage !== 'zh' ? { language: examLanguage } : {},
                ),
              },
              {
                role: 'user',
                content: prompts.examTerms.buildUserPrompt({
                  ...(subject ? { subject } : {}),
                  chunks: part.map((chunk) => ({ id: chunk.id, text: chunk.text })),
                }),
              },
            ],
            { signal: control.signal, reasoning: 'low' },
          )
          const terms = validateExamTerms(prompts.examTerms.readTerms(data), part)
          examTermCache.set(keys[index]!, terms)
          // Saved per part: a later pause or stop keeps it.
          await save(terms)
        } catch (err) {
          if (isAbortError(err, control.signal)) {
            interrupted = true
            return
          }
          if (isOverloadError(err)) throw err
          failed++
          firstError ??= err
          logger.warn('Exam term part failed', { part: index, error: (err as Error)?.message })
          if (err instanceof AIProviderError && ACCOUNT_ERRORS.has(err.code)) {
            halted = true
            ctx.halt()
          }
        }
        done++
        options.onProgress?.({ done, total })
      },
    )
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        failed++
        firstError ??= outcome.reason
      } else if (outcome.status === 'skipped' && !halted) interrupted = true
    }
    const paused = interrupted && done < total
    if (!paused && queue.length > 0 && failed === queue.length && firstError) throw firstError
    // Every part read: the next run reads the papers afresh.
    if (!paused && failed === 0) for (const key of keys) examTermCache.delete(key)
    return {
      book,
      added,
      updated,
      paused,
      failed,
      ...(firstError !== undefined && failed > 0 ? { error: firstError } : {}),
    }
  }

  /** Exam terms into the course book: new words added, known ones updated (count, meaning). */
  private async mergeExamTerms(
    book: VocabBook,
    projectId: string,
    terms: ValidatedExamTerm[],
    allText: string,
    language: string | undefined,
    now: number,
  ): Promise<{ added: number; updated: number }> {
    let added = 0
    let updated = 0
    await this.db.transaction('rw', this.db.vocabBooks, this.db.vocabEntries, async () => {
      const entries = await this.repo.listEntries(book.id)
      const key = (word: string) => word.toLowerCase()
      const byWord = new Map(entries.map((entry) => [key(entry.word), entry]))
      const changed = new Map<string, VocabEntry>()
      for (const [i, term] of terms.entries()) {
        const word = wordKey(term.term, language)
        const count = Math.max(1, countOccurrences(allText, term.term))
        const before = changed.get(key(word)) ?? byWord.get(key(word))
        if (before) {
          changed.set(key(word), {
            ...before,
            examOccurrences: Math.max(before.examOccurrences ?? 0, count),
            ...(before.context ? {} : { context: term.context }),
            ...(before.meanings.length === 0 && term.gloss
              ? { meanings: [term.gloss], glossBy: 'ai' as const }
              : {}),
          })
          if (byWord.has(key(word))) updated++
          continue
        }
        changed.set(key(word), {
          id: crypto.randomUUID(),
          bookId: book.id,
          projectId,
          word,
          meanings: term.gloss ? [term.gloss] : [],
          context: term.context,
          glossBy: term.gloss ? 'ai' : 'none',
          origin: 'exam',
          examOccurrences: count,
          createdAt: now + i,
        })
        added++
      }
      await this.repo.putBook({ ...book, updatedAt: now })
      await this.repo.putEntries([...changed.values()])
    })
    return { added, updated }
  }

  /**
   * Ask the AI for the meanings still missing, in batches; the answers are
   * written into the entries. Terms the AI says are not words are dropped.
   */
  private async gloss(
    entries: VocabEntry[],
    subject: string | undefined,
    language: string | undefined,
    control: GenerationControl,
    onProgress?: (progress: CourseVocabProgress) => void,
  ): Promise<{ glossed: number; dropped: Set<string>; paused: boolean; error?: unknown }> {
    const dropped = new Set<string>()
    let glossed = 0
    let error: unknown
    const missing = entries.filter((entry) => entry.meanings.length === 0)
    const ai = this.ai
    if (!ai || missing.length === 0) return { glossed, dropped, paused: false }
    const total = Math.ceil(missing.length / GLOSS_BATCH)
    let done = 0
    onProgress?.({ done, total })
    const batches: VocabEntry[][] = []
    for (let i = 0; i < missing.length; i += GLOSS_BATCH)
      batches.push(missing.slice(i, i + GLOSS_BATCH))
    let paused = false
    let halted = false
    // 同时进行的 AI 请求数 batches at once (halved on a rate limit, which is
    // tried again after a back-off).
    const outcomes = await createAdaptivePool({ max: aiConcurrency(ai), control }).run(
      batches,
      async (batch, ctx): Promise<void> => {
        try {
          const { data } = await withLightModel(ai).chatJSON<unknown>(
            [
              {
                role: 'system',
                content: prompts.vocabGloss.buildSystemPrompt(
                  language ? { targetLanguage: language } : {},
                ),
              },
              {
                role: 'user',
                content: prompts.vocabGloss.buildUserPrompt({
                  ...(subject ? { subject } : {}),
                  ...(language ? { targetLanguage: language } : {}),
                  terms: batch.map((entry) => ({
                    word: entry.word,
                    sentence: entry.context?.text ?? '',
                  })),
                }),
              },
            ],
            { signal: control.signal, reasoning: 'low' },
          )
          const glosses = prompts.vocabGloss.readGlosses(
            data,
            batch.map((entry) => entry.word),
          )
          const changed: VocabEntry[] = []
          const removed: string[] = []
          for (const entry of batch) {
            const gloss = glosses.get(entry.word)
            if (gloss === null) {
              dropped.add(entry.id)
              removed.push(entry.id)
            } else if (gloss) {
              entry.meanings = [gloss.meaning]
              if (gloss.phonetic && !entry.phonetic) entry.phonetic = gloss.phonetic
              entry.glossBy = 'ai'
              glossed++
              changed.push(entry)
            }
          }
          // Saved per batch: a later pause or stop keeps it.
          if (changed.length > 0) await this.repo.putEntries(changed)
          for (const id of removed) await this.repo.deleteEntry(id)
        } catch (err) {
          // A stopped request is an interruption, not a failure.
          if (isAbortError(err, control.signal)) {
            paused = true
            return
          }
          // A rate limit: the pool slows down and sends this batch again.
          if (isOverloadError(err)) throw err
          // The words stay, without a meaning; the next extraction tries again.
          logger.warn('Course vocabulary gloss failed', { error: (err as Error)?.message })
          error ??= err
          // A bad key, an empty balance or a wrong model fails every batch the
          // same way: stop instead of sending the rest.
          if (err instanceof AIProviderError && ACCOUNT_ERRORS.has(err.code)) {
            halted = true
            ctx.halt()
          }
        }
        done += 1
        onProgress?.({ done, total })
      },
    )
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') error ??= outcome.reason
      // Paused or stopped: the batches already glossed are saved.
      else if (outcome.status === 'skipped' && !halted) paused = true
    }
    if (paused) return { glossed, dropped, paused: true }
    return { glossed, dropped, paused: false, ...(error !== undefined ? { error } : {}) }
  }
}
