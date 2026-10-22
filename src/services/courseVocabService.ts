import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { VocabRepository } from '@/entities/vocab/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import type { DictEntry, VocabBook, VocabEntry } from '@/entities/vocab/types'
import { extractCourseTerms, lemmaOf, type TermSource } from '@/entities/vocab/text'
import { loadCommonWords } from '@/infrastructure/vocab/wordData'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { AIProviderError, type AIErrorCode } from '@/infrastructure/ai/errors'
import { withLightModel, type AIService } from './aiService'
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

  constructor(deps: { projects: ProjectService; ai?: AIService | null; db?: AppDatabase }) {
    const db = deps.db ?? getDb()
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
    if (!this.ai || missing.length === 0) return { glossed, dropped, paused: false }
    const total = Math.ceil(missing.length / GLOSS_BATCH)
    let done = 0
    onProgress?.({ done, total })
    for (let i = 0; i < missing.length; i += GLOSS_BATCH) {
      // Paused or stopped: the batches already glossed are saved.
      if (!control.shouldContinue()) return { glossed, dropped, paused: true }
      const batch = missing.slice(i, i + GLOSS_BATCH)
      try {
        const { data } = await withLightModel(this.ai).chatJSON<unknown>(
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
          { maxTokens: 2048, signal: control.signal },
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
        if (isAbortError(err, control.signal)) return { glossed, dropped, paused: true }
        // The words stay, without a meaning; the next extraction tries again.
        logger.warn('Course vocabulary gloss failed', { error: (err as Error)?.message })
        error ??= err
        // A bad key, an empty balance or a wrong model fails every batch the
        // same way: stop instead of sending the rest.
        if (err instanceof AIProviderError && ACCOUNT_ERRORS.has(err.code)) break
      }
      done += 1
      onProgress?.({ done, total })
    }
    return { glossed, dropped, paused: false, ...(error !== undefined ? { error } : {}) }
  }
}
