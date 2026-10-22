import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { DocumentRepository } from '@/entities/document/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import { ProjectRepository } from '@/entities/project/repository'
import { UserRepository } from '@/entities/user/repository'
import { prompts } from '@/infrastructure/ai/prompts'
import type { PhraseItem, PhraseKind } from '@/infrastructure/ai/prompts/phrase-extract/v1'
import { AppError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { targetLanguageOf } from '@/shared/lib/language'
import type { AIService } from './aiService'
import { ReviewCardService } from './reviewCardService'
import { t } from '@/i18n'
import { fnv1a } from '@/shared/lib/hash'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'

/**
 * Phrase cards for a language course: useful sentences from the textbook's
 * dialogues and exam scenarios ("Mi a panasza most?"), each with what it
 * means, become review cards — prompt on the front, the phrase to produce on
 * the back. The AI picks them out; a phrase is kept only when it occurs word
 * for word in the passage it is said to come from, and the student confirms
 * the list before any card is made.
 */

/** Characters of passages per request. */
const PASSAGE_CHARS = 8_000
/** Requests per extraction at most (a whole textbook would be too many). */
const MAX_REQUESTS = 8
const MAX_PROMPT = 200
const MAX_PHRASE = 200

export const PHRASE_KINDS: PhraseKind[] = ['question', 'answer', 'expression']

export interface PhraseCandidate {
  id: string
  prompt: string
  phrase: string
  kind: PhraseKind
  chunkId: string
  page?: number
}

/** Whitespace collapsed; letters, accents and case kept. */
function squash(text: string): string {
  return text.normalize('NFC').replace(/­/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Dialogue or scenario text: several lines that open with a dash (as
 * textbooks print dialogues), several questions, or speaker labels.
 */
export function looksLikeDialogue(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim())
  const dashed = lines.filter((line) => /^[-–—]\s*\S/.test(line)).length
  const questions = (text.match(/\?/g) ?? []).length
  const speakers = lines.filter((line) =>
    /^(arzt|ärztin|patient(in)?|orvos|beteg|páciens|doktor|doctor|nurse|schwester|ápoló)\s*:/i.test(
      line,
    ),
  ).length
  return dashed >= 3 || questions >= 3 || speakers >= 2
}

/**
 * Keep the phrases that can be trusted: a known passage id, the phrase found
 * verbatim in that passage (spacing aside), no gap marks, a prompt, a valid
 * kind; duplicates (same prompt) keep the first.
 */
export function validatePhrases(
  items: PhraseItem[],
  chunks: Map<string, Pick<DocumentChunk, 'id' | 'text' | 'pageNumber'>>,
): Omit<PhraseCandidate, 'id'>[] {
  const seen = new Set<string>()
  const kept: Omit<PhraseCandidate, 'id'>[] = []
  for (const item of items) {
    const chunkId = typeof item.sourceChunkId === 'string' ? item.sourceChunkId.trim() : ''
    const chunk = chunks.get(chunkId)
    if (!chunk) continue
    const phrase =
      typeof item.phrase === 'string' ? squash(item.phrase).replace(/^[-–—]\s*/, '') : ''
    const prompt = typeof item.prompt === 'string' ? squash(item.prompt).slice(0, MAX_PROMPT) : ''
    if (!phrase || !prompt || phrase.length > MAX_PHRASE) continue
    // A line with blanks to fill in is an exercise, not a phrase.
    if (/[…_]{2,}|\.{3,}/.test(phrase)) continue
    if (!squash(chunk.text).includes(phrase)) continue
    const kind = PHRASE_KINDS.includes(item.kind as PhraseKind)
      ? (item.kind as PhraseKind)
      : 'expression'
    const key = prompt.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    kept.push({
      prompt,
      phrase,
      kind,
      chunkId: chunk.id,
      ...(chunk.pageNumber !== undefined ? { page: chunk.pageNumber } : {}),
    })
  }
  return kept
}

/** Passages grouped into requests of at most `PASSAGE_CHARS`. */
function planBatches(chunks: DocumentChunk[]): DocumentChunk[][] {
  const batches: DocumentChunk[][] = []
  let size = 0
  for (const chunk of chunks) {
    const last = batches[batches.length - 1]
    if (!last || size + chunk.text.length > PASSAGE_CHARS) {
      batches.push([chunk])
      size = chunk.text.length
    } else {
      last.push(chunk)
      size += chunk.text.length
    }
  }
  return batches.slice(0, MAX_REQUESTS)
}

/** Phrases read from the dialogues, and whether the reading was paused. */
export interface PhraseExtractResult {
  candidates: PhraseCandidate[]
  paused: boolean
  doneParts: number
  totalParts: number
}

/** Parts already read, for this page visit (see `extractParts`). */
const phraseCache = new Map<string, Array<Omit<PhraseCandidate, 'id'>>>()

function batchKey(
  projectId: string,
  language: string,
  explanationLanguage: string,
  batch: DocumentChunk[],
): string {
  const text = batch.map((chunk) => chunk.id + '|' + chunk.text).join('||')
  return [projectId, language, explanationLanguage, fnv1a(text)].join(':')
}

/** Tests: forget the parts read in earlier runs. */
export function clearPhrasePartCacheForTesting(): void {
  phraseCache.clear()
}

export class PhraseCardService {
  private db: AppDatabase
  private ai: AIService | null

  constructor(deps: { ai?: AIService | null; db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.ai = deps.ai ?? null
  }

  /** Pick phrases out of the course's dialogue passages (one document, or all of them). */
  async extract(
    projectId: string,
    options: {
      documentId?: string
      signal?: AbortSignal
      control?: GenerationControl
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<PhraseCandidate[]> {
    return (await this.extractParts(projectId, options)).candidates
  }

  /**
   * `extract`, also saying whether it was paused / stopped (`control`) before
   * every part was read. Parts read are kept for this page visit, so running
   * it again only asks for the parts that are left; a reload starts over.
   */
  async extractParts(
    projectId: string,
    options: {
      documentId?: string
      signal?: AbortSignal
      control?: GenerationControl
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<PhraseExtractResult> {
    if (!this.ai) throw new AppError(t('phrases.noProvider'), 'NO_PROVIDER')
    const control = resolveControl(options.control, options.signal)
    const project = await new ProjectRepository(this.db).get(projectId)
    const language = targetLanguageOf(project)
    if (!language) throw new ValidationError(t('wordList.notLanguageCourse'))
    const documents = options.documentId
      ? [await new DocumentRepository(this.db).get(options.documentId)]
      : selectAnalysisDocuments(await new DocumentRepository(this.db).listByProject(projectId))
    const chunkRepo = new ChunkRepository(this.db)
    const chunks: DocumentChunk[] = []
    for (const doc of documents) {
      if (doc.projectId !== projectId) continue
      chunks.push(...(await chunkRepo.listByDocument(doc.id)))
    }
    const dialogues = chunks.filter((chunk) => looksLikeDialogue(chunk.text))
    if (dialogues.length === 0) throw new ValidationError(t('phrases.noDialogues'))
    const byId = new Map(dialogues.map((chunk) => [chunk.id, chunk]))
    const batches = planBatches(dialogues)
    const profile = await new UserRepository(this.db).get().catch(() => undefined)
    const explanationLanguage = profile?.questionLanguage === 'en' ? 'en' : 'zh'

    const results: Array<Omit<PhraseCandidate, 'id'>[] | undefined> = new Array(batches.length)
    const keys = batches.map((batch) => batchKey(projectId, language, explanationLanguage, batch))
    let failed = 0
    let firstError: unknown = null
    let done = 0
    let paused = false
    for (const [index, key] of keys.entries()) {
      const cached = phraseCache.get(key)
      if (cached) {
        results[index] = cached
        done++
      }
    }
    options.onProgress?.(done, batches.length)
    for (const [index, batch] of batches.entries()) {
      if (results[index]) continue
      if (!control.shouldContinue()) {
        paused = true
        break
      }
      try {
        const { data } = await this.ai.chatJSON<unknown>(
          [
            {
              role: 'system',
              content: prompts.phraseExtract.buildSystemPrompt({ targetLanguage: language }),
            },
            {
              role: 'user',
              content: prompts.phraseExtract.buildUserPrompt({
                targetLanguage: language,
                explanationLanguage,
                passages: batch.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
              }),
            },
          ],
          { signal: control.signal },
        )
        const phrases = validatePhrases(prompts.phraseExtract.readPhrases(data), byId)
        results[index] = phrases
        phraseCache.set(keys[index]!, phrases)
      } catch (err) {
        // A stopped request is not a failed part: it is read on continue.
        if (isAbortError(err, control.signal)) {
          paused = true
          break
        }
        failed++
        firstError ??= err
        results[index] = []
        logger.warn('Phrase extraction part failed', {
          part: index,
          error: (err as Error)?.message,
        })
      }
      done++
      options.onProgress?.(done, batches.length)
    }
    if (!paused && failed === batches.length && firstError) throw firstError
    const seen = new Set<string>()
    const candidates = results
      .flatMap((items) => items ?? [])
      .filter((item) => {
        const key = item.prompt.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((item, i) => ({ id: `p${i + 1}`, ...item }))
    return { candidates, paused, doneParts: done, totalParts: batches.length }
  }

  /**
   * Review cards for the confirmed phrases: front = prompt, back = phrase;
   * with `reverse`, also front = phrase, back = prompt. Fronts the course
   * already has are skipped. Returns how many cards were added.
   */
  async save(
    projectId: string,
    phrases: Array<Pick<PhraseCandidate, 'prompt' | 'phrase'>>,
    options: { reverse?: boolean } = {},
  ): Promise<number> {
    const cards = phrases.flatMap((item) => [
      { front: item.prompt, back: item.phrase, source: 'phrase' as const },
      ...(options.reverse
        ? [{ front: item.phrase, back: item.prompt, source: 'phrase' as const }]
        : []),
    ])
    return new ReviewCardService(this.db).addMany(projectId, cards)
  }
}
