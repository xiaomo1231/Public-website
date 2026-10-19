import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { VocabRepository } from '@/entities/vocab/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import type { VocabBook, VocabEntry } from '@/entities/vocab/types'
import { extractCourseTerms, lemmaOf, type TermSource } from '@/entities/vocab/text'
import { loadCommonWords } from '@/infrastructure/vocab/wordData'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import type { AIService } from './aiService'
import type { ProjectService } from './projectService'
import { loadProjectSubject } from './projectSubject'
import { vocabIndex } from './vocabService'
import { t } from '@/i18n'

/** Terms kept per extraction (most frequent first). */
export const COURSE_TERM_LIMIT = 150
/** Terms glossed per AI request. */
const GLOSS_BATCH = 40

export interface CourseVocabResult {
  book: VocabBook
  added: number
  /** Meanings given by the AI in this run. */
  glossed: number
  /** Words still without a meaning (no AI, or the AI could not say). */
  unglossed: number
  total: number
}

/**
 * A course's own vocabulary: the uncommon words of its English material,
 * each with the sentence and page it was found on. Meanings come from the
 * dictionary, otherwise from the student's AI (cached in the entry).
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
   * meaning.
   */
  async extract(projectId: string, options: { signal?: AbortSignal; now?: number } = {}): Promise<CourseVocabResult> {
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

    const [{ byWord, lemmas }, common] = await Promise.all([vocabIndex(), loadCommonWords()])
    // Words from school-level and CET-4 lists count as known to a university student.
    const basic = (word: string) => {
      const entry = byWord.get(word)
      return Boolean(entry && entry.tags.some((tag) => tag === 'zk' || tag === 'gk' || tag === 'cet4'))
    }
    const known = (word: string) => byWord.has(word) || common.has(word)
    const candidates = extractCourseTerms(sources, {
      isCommon: (word) => common.has(word) || basic(word),
      lemma: (token) => lemmaOf(token, lemmas, known),
      limit: COURSE_TERM_LIMIT,
    })

    let book = await this.repo.findCourseBook(projectId)
    book = {
      id: book?.id ?? crypto.randomUUID(),
      kind: 'course',
      name: project.name,
      projectId,
      createdAt: book?.createdAt ?? now,
      updatedAt: now,
    }
    // Every entry of the book after this run, by word: earlier ones (counts
    // refreshed when found again) plus the new ones.
    const byTerm = new Map((await this.repo.listEntries(book.id)).map((entry) => [entry.word, entry]))
    const fresh = new Set<string>()
    for (const [i, candidate] of candidates.entries()) {
      const before = byTerm.get(candidate.word)
      if (before) {
        byTerm.set(candidate.word, { ...before, occurrences: candidate.occurrences, context: before.context ?? candidate.context })
        continue
      }
      const entry = byWord.get(candidate.word)
      const id = crypto.randomUUID()
      fresh.add(id)
      byTerm.set(candidate.word, {
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
    const { glossed, dropped } = await this.gloss(entries, await loadProjectSubject(projectId), options.signal)
    const kept = entries.filter((entry) => !dropped.has(entry.id))
    await this.repo.putBook(book)
    await this.repo.putEntries(kept)
    for (const id of dropped) await this.repo.deleteEntry(id)
    return {
      book,
      added: kept.filter((entry) => fresh.has(entry.id)).length,
      glossed,
      unglossed: kept.filter((entry) => entry.meanings.length === 0).length,
      total: kept.length,
    }
  }

  /**
   * Ask the AI for the meanings still missing, in batches; the answers are
   * written into the entries. Terms the AI says are not words are dropped.
   */
  private async gloss(
    entries: VocabEntry[],
    subject: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ glossed: number; dropped: Set<string> }> {
    const dropped = new Set<string>()
    let glossed = 0
    const missing = entries.filter((entry) => entry.meanings.length === 0)
    if (!this.ai || missing.length === 0) return { glossed, dropped }
    for (let i = 0; i < missing.length; i += GLOSS_BATCH) {
      signal?.throwIfAborted()
      const batch = missing.slice(i, i + GLOSS_BATCH)
      try {
        const { data } = await this.ai.chatJSON<unknown>(
          [
            { role: 'system', content: prompts.vocabGloss.buildSystemPrompt() },
            {
              role: 'user',
              content: prompts.vocabGloss.buildUserPrompt({
                ...(subject ? { subject } : {}),
                terms: batch.map((entry) => ({ word: entry.word, sentence: entry.context?.text ?? '' })),
              }),
            },
          ],
          { maxTokens: 2048, ...(signal ? { signal } : {}) },
        )
        const glosses = prompts.vocabGloss.readGlosses(data, batch.map((entry) => entry.word))
        for (const entry of batch) {
          const gloss = glosses.get(entry.word)
          if (gloss === null) dropped.add(entry.id)
          else if (gloss) {
            entry.meanings = [gloss.meaning]
            if (gloss.phonetic && !entry.phonetic) entry.phonetic = gloss.phonetic
            entry.glossBy = 'ai'
            glossed++
          }
        }
      } catch (err) {
        if (signal?.aborted) throw err
        // The words stay, without a meaning; the next extraction tries again.
        logger.warn('Course vocabulary gloss failed', { error: (err as Error)?.message })
      }
    }
    return { glossed, dropped }
  }
}
