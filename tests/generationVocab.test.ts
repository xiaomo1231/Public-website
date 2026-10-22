import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { setVocabDataLoaderForTesting } from '@/infrastructure/vocab/wordData'
import { resetVocabIndexForTesting } from '@/services/vocabService'
import { CourseVocabService } from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import {
  TextbookWordListService,
  clearWordListPartCacheForTesting,
} from '@/services/textbookWordList'
import { PhraseCardService, clearPhrasePartCacheForTesting } from '@/services/phraseCards'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import { AbortedError, AuthFailedError } from '@/infrastructure/ai/errors'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

beforeAll(() => {
  setVocabDataLoaderForTesting(async (file) =>
    JSON.parse(readFileSync(join(process.cwd(), 'public', 'vocab', file), 'utf8')),
  )
  resetVocabIndexForTesting()
})
afterAll(() => {
  setVocabDataLoaderForTesting(null)
  resetVocabIndexForTesting()
})

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  clearWordListPartCacheForTesting()
  clearPhrasePartCacheForTesting()
})

const NOW = new Date(2026, 9, 21, 9).getTime()

/** Made-up course terms no dictionary knows, so each one needs an AI gloss. */
function pseudoWords(count: number): string[] {
  const syllables = ['blor', 'quen', 'vax', 'trim', 'zel', 'prux', 'dov', 'kif', 'mosk', 'gath']
  const words: string[] = []
  for (const a of syllables)
    for (const b of syllables) if (a !== b && words.length < count) words.push(`zy${a}${b}`)
  return words
}

async function englishCourse(words: string[]) {
  const projects = new ProjectService(db)
  const project = await projects.create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'atlas.pdf',
    sizeBytes: 1,
  })
  await docs.update(doc.id, { status: 'ready' })
  await new ChunkRepository(db).addMany(
    words.map((word, i) => ({
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph' as const,
      text: `The ${word} lies near the ${word} of the joint.`,
      sourceReference: 'atlas',
      order: i,
      pageNumber: i + 1,
    })),
  )
  return { projects, projectId: project.id }
}

/** Glosses every term it is asked about; `onCall` can pause or stop the run. */
function glossAI(onCall?: (call: number, signal?: AbortSignal) => Promise<void> | void) {
  let calls = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
    calls += 1
    await onCall?.(calls, options?.signal)
    const words = [...messages[1]!.content.matchAll(/^\d+\. (\S+) — /gm)].map((m) => m[1]!)
    return {
      data: {
        terms: words.map((word) => ({ word, pos: 'n.', meaning: `${word}的释义`, phonetic: null })),
      },
    }
  })
  // One batch at a time: these tests pin down which request is in flight.
  return { ai: { chatJSON, concurrency: 1 } as unknown as AIService, chatJSON }
}

/** A request that only ends when its signal is aborted. */
function hangUntilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new AbortedError()))
  })
}

describe('course vocabulary glossing', () => {
  it('pausing keeps the glossed batches; continuing glosses only the rest', async () => {
    const { projects, projectId } = await englishCourse(pseudoWords(90))
    let run: GenerationRun = createGenerationRun()
    const first = glossAI((call) => {
      if (call === 1) run.requestPause()
    })
    const paused = await new CourseVocabService({ projects, ai: first.ai, db }).extract(projectId, {
      control: run,
      now: NOW,
    })
    expect(first.chatJSON).toHaveBeenCalledTimes(1)
    expect(paused).toMatchObject({ paused: true, glossed: 40 })
    // Saved at once, not only at the end of the run.
    const repo = new VocabRepository(db)
    const saved = await repo.listEntries(paused.book.id)
    expect(saved.filter((entry) => entry.glossBy === 'ai')).toHaveLength(40)
    expect(saved.filter((entry) => entry.meanings.length === 0).length).toBe(paused.unglossed)
    expect(paused.unglossed).toBeGreaterThan(0)

    run = createGenerationRun()
    const second = glossAI()
    const done = await new CourseVocabService({ projects, ai: second.ai, db }).extract(projectId, {
      control: run,
      now: NOW + 1,
    })
    // Only the batches that were left are requested.
    expect(second.chatJSON).toHaveBeenCalledTimes(Math.ceil(paused.unglossed / 40))
    expect(done).toMatchObject({ paused: false, unglossed: 0, added: 0 })
  })

  it('stopping aborts the request in flight without failing or dropping words', async () => {
    const { projects, projectId } = await englishCourse(pseudoWords(90))
    const run = createGenerationRun()
    const { ai, chatJSON } = glossAI(async (call, signal) => {
      if (call === 2) {
        queueMicrotask(() => run.stopNow())
        await hangUntilAborted(signal)
      }
    })
    const result = await new CourseVocabService({ projects, ai, db }).extract(projectId, {
      control: run,
      now: NOW,
    })
    expect(chatJSON).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ paused: true, glossed: 40 })
    const entries = await new VocabRepository(db).listEntries(result.book.id)
    // The aborted batch's words stay, without a meaning, for the next run.
    expect(entries).toHaveLength(result.total)
    expect(entries.filter((entry) => entry.meanings.length === 0)).toHaveLength(result.unglossed)
  })

  it('stops at an account error and reports it instead of sending every batch', async () => {
    const { projects, projectId } = await englishCourse(pseudoWords(90))
    const chatJSON = vi.fn(async () => {
      throw new AuthFailedError('Incorrect API key provided')
    })
    const result = await new CourseVocabService({
      projects,
      ai: { chatJSON, concurrency: 1 } as unknown as AIService,
      db,
    }).extract(projectId, { control: createGenerationRun(), now: NOW })
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(result.glossed).toBe(0)
    expect(result.unglossed).toBeGreaterThan(0)
    expect(result.glossError).toBeInstanceOf(AuthFailedError)
  })
})

async function germanCourse(chapters: number, dialogueRepeat = 1) {
  const projects = new ProjectService(db)
  const project = await projects.create({ name: 'Deutsch', subject: 'medicine' })
  await db.projects.update(project.id, {
    subject: 'language',
    targetLanguage: 'de',
  } as Record<string, unknown>)
  const docs = new DocumentRepository(db)
  const doc = await docs.create({
    projectId: project.id,
    type: 'pdf',
    name: 'de.pdf',
    sizeBytes: 1,
  })
  await docs.update(doc.id, { status: 'ready' })
  const nouns = ['Kopf', 'Zahn', 'Arm', 'Fuß', 'Hals', 'Bauch']
  await new ChunkRepository(db).addMany(
    Array.from({ length: chapters }, (_, i) => ({
      documentId: doc.id,
      projectId: project.id,
      contentType: 'paragraph' as const,
      text: `Wortschatz\nder ${nouns[i]}, die ${nouns[i]}e\nkrank sick\nGespräch: Wie geht es Ihnen? Mir geht es gut. Was fehlt Ihnen? Ich habe Schmerzen. Seit wann?
`.repeat(dialogueRepeat),
      sourceReference: `p${i + 1}`,
      order: i,
      pageNumber: i + 1,
      chapterId: `ch${i + 1}`,
      chapterTitle: `Lektion ${i + 1}`,
    })),
  )
  return { projectId: project.id, documentId: doc.id, nouns: nouns.slice(0, chapters) }
}

function wordListAI(onCall?: (call: number, signal?: AbortSignal) => Promise<void> | void) {
  let calls = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[], options?: { signal?: AbortSignal }) => {
    calls += 1
    await onCall?.(calls, options?.signal)
    const noun = /der (\p{Lu}\p{Ll}+),/u.exec(messages[1]!.content)?.[1] ?? 'Kopf'
    return { data: { items: [{ term: noun, gloss: `${noun} (en)`, article: 'der' }] } }
  })
  // Two parts at once: these tests pin down which requests are in flight.
  return { ai: { chatJSON, concurrency: 2 } as unknown as AIService, chatJSON }
}

describe('textbook word list import', () => {
  it('pausing returns the parts read; continuing reads only the rest', async () => {
    const { projectId, documentId, nouns } = await germanCourse(4)
    let run = createGenerationRun()
    const first = wordListAI((call) => {
      if (call === 2) run.requestPause()
    })
    const service = new TextbookWordListService({ ai: first.ai, db })
    const paused = await service.split(projectId, documentId, { control: run })
    // Two requests run at once; both finish, no third one starts.
    expect(first.chatJSON).toHaveBeenCalledTimes(2)
    expect(paused).toMatchObject({ paused: true, doneParts: 2, totalParts: 4, failedParts: 0 })
    expect(paused.candidates.map((c) => c.term)).toEqual(nouns.slice(0, 2))

    run = createGenerationRun()
    const second = wordListAI()
    const done = await new TextbookWordListService({ ai: second.ai, db }).split(
      projectId,
      documentId,
      { control: run },
    )
    expect(second.chatJSON).toHaveBeenCalledTimes(2)
    expect(done).toMatchObject({ paused: false, doneParts: 4, failedParts: 0 })
    expect(done.candidates.map((c) => c.term)).toEqual(nouns)
  })

  it('stopping aborts the parts in flight and counts no failure', async () => {
    const { projectId, documentId } = await germanCourse(4)
    const run = createGenerationRun()
    const { ai, chatJSON } = wordListAI(async (call, signal) => {
      if (call === 2) {
        queueMicrotask(() => run.stopNow())
        await hangUntilAborted(signal)
      }
    })
    const result = await new TextbookWordListService({ ai, db }).split(projectId, documentId, {
      control: run,
    })
    expect(chatJSON).toHaveBeenCalledTimes(2)
    expect(result.paused).toBe(true)
    expect(result.failedParts).toBe(0)
    expect(result.doneParts).toBe(1)
  })
})

describe('phrase card extraction', () => {
  it('pausing keeps the parts read; continuing asks only for the rest', async () => {
    const { projectId } = await germanCourse(4, 60)
    const phraseAI = (onCall?: (call: number) => void) => {
      let calls = 0
      const chatJSON = vi.fn(async () => {
        calls += 1
        onCall?.(calls)
        return { data: { phrases: [] } }
      })
      return { ai: { chatJSON } as unknown as AIService, chatJSON }
    }
    let run = createGenerationRun()
    const first = phraseAI((call) => {
      if (call === 1) run.requestPause()
    })
    const paused = await new PhraseCardService({ ai: first.ai, db }).extractParts(projectId, {
      control: run,
    })
    expect(first.chatJSON).toHaveBeenCalledTimes(1)
    expect(paused.totalParts).toBeGreaterThan(1)
    {
      expect(paused).toMatchObject({ paused: true, doneParts: 1 })
      run = createGenerationRun()
      const second = phraseAI()
      const done = await new PhraseCardService({ ai: second.ai, db }).extractParts(projectId, {
        control: run,
      })
      expect(second.chatJSON).toHaveBeenCalledTimes(paused.totalParts - 1)
      expect(done.paused).toBe(false)
    }
  })
})
