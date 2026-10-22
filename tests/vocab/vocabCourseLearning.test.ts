import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { setVocabDataLoaderForTesting } from '@/infrastructure/vocab/wordData'
import { VocabService, resetVocabIndexForTesting } from '@/services/vocabService'
import {
  CourseVocabService,
  clearExamTermCacheForTesting,
  countOccurrences,
  planExamTermParts,
  validateExamTerms,
} from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import { lookupTermOf, sentenceWith } from '@/entities/vocab/lookup'
import {
  EXAM_WEEK_DAYS,
  YOUNG_INTERVAL_DAYS,
  detectLeech,
  dueForExamWeek,
  newVocabCard,
  scheduleVocabCard,
} from '@/entities/vocab/schedule'
import { LEECH_GAP, LEECH_REPEATS, requeueAfterRating } from '@/entities/vocab/session'
import type { SessionItem, VocabCard } from '@/entities/vocab/types'
import { createGenerationRun } from '@/shared/lib/generationControl'
import { formatNextReview } from '@/widgets/vocab/formatSpan'
import { translate } from '@/i18n'
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

const NOW = new Date(2026, 9, 18, 9).getTime()
const DAY = 86400000

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  clearExamTermCacheForTesting()
})

async function course(name = 'Anatomy') {
  const projects = new ProjectService(db)
  const project = await projects.create({ name, subject: 'medicine' })
  return { projects, projectId: project.id }
}

async function addDocument(
  projectId: string,
  materialType: 'past_exam' | 'textbook',
  texts: string[],
): Promise<string[]> {
  const docs = new DocumentRepository(db)
  const doc = await docs.create({
    projectId,
    type: 'pdf',
    name: `${materialType}.pdf`,
    sizeBytes: 1,
    materialType,
  })
  await docs.update(doc.id, { status: 'ready' })
  const rows = await new ChunkRepository(db).addMany(
    texts.map((text, i) => ({
      documentId: doc.id,
      projectId,
      contentType: 'paragraph' as const,
      text,
      sourceReference: doc.name,
      order: i,
      pageNumber: i + 1,
    })),
  )
  return rows.map((row) => row.id)
}

describe('looked-up words', () => {
  it('keeps words and short phrases only', () => {
    expect(lookupTermOf('  brachial plexus, ')).toBe('brachial plexus')
    expect(lookupTermOf('Herzbeutel')).toBe('Herzbeutel')
    expect(lookupTermOf('The heart pumps blood through the body every day.')).toBeNull()
    expect(lookupTermOf('心包')).toBeNull()
    expect(lookupTermOf('x^2 + 1')).toBeNull()
    expect(lookupTermOf('42')).toBeNull()
    expect(
      sentenceWith(
        'The heart lies in the mediastinum. The pericardium surrounds it.',
        'pericardium',
      ),
    ).toBe('The pericardium surrounds it.')
  })

  it('adds a lookup to the course book with its sentence, counts repeats and puts it first', async () => {
    const { projects, projectId } = await course()
    const service = new CourseVocabService({ projects, db })
    const vocab = new VocabService(db)
    const first = await service.recordLookup({
      projectId,
      text: 'pericardium',
      surrounding: 'The heart lies in the mediastinum. The pericardium surrounds it.',
      meaning: '心包',
      documentName: 'Lesson 3',
      now: NOW,
    })
    expect(first?.added).toBe(true)
    expect(first?.entry).toMatchObject({
      word: 'pericardium',
      origin: 'lookup',
      lookups: 1,
      context: { text: 'The pericardium surrounds it.', documentName: 'Lesson 3' },
    })
    expect(first?.entry.meanings.length).toBeGreaterThan(0)
    // Another word, looked up once; the first one twice more.
    await service.recordLookup({ projectId, text: 'mediastinum', now: NOW })
    await service.recordLookup({ projectId, text: 'Pericardium', now: NOW + 1 })
    const again = await service.recordLookup({ projectId, text: 'pericardium.', now: NOW + 2 })
    expect(again?.added).toBe(false)
    expect(again?.entry.lookups).toBe(3)
    // Ignored: a sentence, Chinese text.
    expect(
      await service.recordLookup({
        projectId,
        text: 'This is a long sentence that is not a word at all.',
      }),
    ).toBeNull()
    expect(await service.recordLookup({ projectId, text: '心包' })).toBeNull()

    const book = await new VocabRepository(db).findCourseBook(projectId)
    const entries = await new VocabRepository(db).listEntries(book!.id)
    expect(entries.map((entry) => entry.word).sort()).toEqual(['mediastinum', 'pericardium'])
    const words = await vocab.bookWords(book!.id)
    expect(words[0]!.word).toBe('pericardium')
  })

  it('a word being learnt that is looked up again comes back tomorrow at the latest', async () => {
    const { projects, projectId } = await course()
    const repo = new VocabRepository(db)
    const card: VocabCard = {
      ...newVocabCard('pericardium', 'b', NOW),
      due: NOW + 30 * DAY,
      reps: 5,
      state: 2,
      scheduled_days: 30,
    }
    await repo.putCard(card)
    await new CourseVocabService({ projects, db }).recordLookup({
      projectId,
      text: 'pericardium',
      now: NOW,
    })
    expect((await repo.getCard('pericardium'))!.due).toBe(NOW + DAY)
  })
})

describe('exam key terms', () => {
  const PLEXUS =
    'Describe the brachial plexus and its branches. Name the cords of the brachial plexus.'

  /** Answers with a real term, an invented one and one from another part's chunk. */
  function examAI(onCall?: (n: number) => void) {
    let calls = 0
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      calls++
      onCall?.(calls)
      const ids = [...messages[1]!.content.matchAll(/\[c:([^\]]+)\]/g)].map((m) => m[1]!)
      return {
        data: {
          terms: ids.flatMap((id) => [
            { term: 'brachial plexus', chunkId: id, gloss: '臂丛' },
            { term: 'invented nerve', chunkId: id, gloss: '编的' },
            { term: 'cords', chunkId: 'not-in-this-part', gloss: '束' },
          ]),
        },
      }
    })
    return { ai: { chatJSON, concurrency: 1 } as unknown as AIService, chatJSON }
  }

  it('keeps only verbatim terms, with sentence and counted occurrences', () => {
    const part = [{ id: 'c1', text: PLEXUS, documentName: 'exam.pdf', page: 2 }]
    const kept = validateExamTerms(
      [
        { term: 'Brachial Plexus', chunkId: 'c1', gloss: '臂丛' },
        { term: 'brachial plexus', chunkId: 'c1', gloss: '臂丛' },
        { term: 'ulnar nerve', chunkId: 'c1', gloss: '尺神经' },
        { term: 'cords', chunkId: 'c9', gloss: '束' },
      ],
      part,
    )
    expect(kept).toEqual([
      {
        term: 'brachial plexus',
        gloss: '臂丛',
        context: {
          text: 'Describe the brachial plexus and its branches.',
          documentName: 'exam.pdf',
          page: 2,
          chunkId: 'c1',
        },
      },
    ])
    expect(countOccurrences(PLEXUS, 'Brachial plexus')).toBe(2)
    expect(countOccurrences('plexuses', 'plexus')).toBe(0)
  })

  it('reads every part through the pool, then resumes only the parts left after a pause', async () => {
    const { projects, projectId } = await course()
    const filler = 'x'.repeat(4500)
    await addDocument(projectId, 'past_exam', [
      `${PLEXUS} ${filler}`,
      `${PLEXUS} ${filler}`,
      `${PLEXUS} ${filler}`,
    ])
    await addDocument(projectId, 'textbook', ['The brachial plexus in the textbook is not read.'])
    expect(
      planExamTermParts([
        { id: 'a', text: 'a'.repeat(5000), documentName: 'd' },
        { id: 'b', text: 'b'.repeat(5000), documentName: 'd' },
      ]),
    ).toHaveLength(2)

    const run = createGenerationRun()
    const { ai, chatJSON } = examAI((n) => {
      if (n === 1) run.requestPause()
    })
    const service = new CourseVocabService({ projects, ai, db })
    const first = await service.extractExamTerms(projectId, { control: run, now: NOW })
    expect(first.paused).toBe(true)
    expect(chatJSON).toHaveBeenCalledTimes(1)
    expect(first.added).toBe(1)

    const repo = new VocabRepository(db)
    let entries = await repo.listEntries(first.book.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      word: 'brachial plexus',
      origin: 'exam',
      meanings: ['臂丛'],
      examOccurrences: 6,
    })

    // 继续: only the two parts left are read; the word is not duplicated.
    const progress: Array<[number, number]> = []
    const second = await service.extractExamTerms(projectId, {
      now: NOW,
      onProgress: ({ done, total }) => progress.push([done, total]),
    })
    expect(second.paused).toBe(false)
    expect(chatJSON).toHaveBeenCalledTimes(3)
    expect(progress[0]).toEqual([1, 3])
    entries = await repo.listEntries(first.book.id)
    expect(entries.map((entry) => entry.word)).toEqual(['brachial plexus'])
    // The textbook was never sent.
    const sent = chatJSON.mock.calls
      .map((call) => (call[0] as ChatMessage[])[1]!.content)
      .join('\n')
    expect(sent).not.toContain('in the textbook')
  })

  it('says what is missing without exam papers or an AI', async () => {
    const { projects, projectId } = await course()
    await expect(
      new CourseVocabService({ projects, db }).extractExamTerms(projectId),
    ).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await expect(
      new CourseVocabService({ projects, ai: examAI().ai, db }).extractExamTerms(projectId),
    ).rejects.toMatchObject({ code: 'NO_EXAM_MATERIALS' })
  })
})

describe('scheduling refinements', () => {
  it('never lets a word rated once disappear: young words come back within days', () => {
    const fresh = newVocabCard('bursa', 'b', NOW)
    for (const rating of [1, 2, 3, 4] as const) {
      const next = scheduleVocabCard(fresh, rating, NOW)
      expect(next.due).toBeGreaterThan(NOW)
      expect(next.due - NOW).toBeLessThanOrEqual(YOUNG_INTERVAL_DAYS[0]! * DAY)
    }
    // Second and third reviews stay short too.
    const once = scheduleVocabCard(fresh, 4, NOW)
    const twice = scheduleVocabCard(once, 4, once.due)
    expect(twice.due - once.due).toBeLessThanOrEqual(YOUNG_INTERVAL_DAYS[1]! * DAY)
    const thrice = scheduleVocabCard(twice, 4, twice.due)
    expect(thrice.due - twice.due).toBeLessThanOrEqual(YOUNG_INTERVAL_DAYS[2]! * DAY)
  })

  it('the daily session brings a word rated once back when it is due', async () => {
    const vocab = new VocabService(db)
    await vocab.updateSettings({ bookId: 'exam:cet4', dailyNew: 1 })
    const [item] = await vocab.session(NOW)
    const card = await vocab.grade(item!.view.word, 4, 'learn', { now: NOW })
    expect(card.due - NOW).toBeLessThanOrEqual(DAY)
    const later = await vocab.session(card.due)
    expect(later.some((next) => next.kind === 'review' && next.view.word === item!.view.word)).toBe(
      true,
    )
  })

  it('marks a word forgotten again and again as a 顽固词 and relearns it over the next days', () => {
    expect(detectLeech({ lapses: 3 }, [])).toBe(true)
    expect(detectLeech({ lapses: 0 }, [1, 3, 1, 1, 3])).toBe(true)
    expect(detectLeech({ lapses: 0 }, [1, 3, 3])).toBe(false)

    let card = newVocabCard('fascia', 'b', NOW)
    let now = NOW
    const recent: number[] = []
    for (const rating of [3, 3, 1, 3, 1, 3, 1] as const) {
      card = scheduleVocabCard(card, rating, now, { recent })
      recent.push(rating)
      now = Math.max(card.due, now + 60_000)
    }
    expect(card.leech).toBe(true)
    // Correct reviews: back within 1, 2, 3 days; three in a row release it.
    const intervals: number[] = []
    for (let i = 0; i < 3; i++) {
      const next = scheduleVocabCard(card, 3, now, { recent })
      intervals.push(next.due - now)
      recent.push(3)
      card = next
      now = next.due
    }
    expect(intervals[0]).toBeLessThanOrEqual(DAY)
    expect(intervals[1]).toBeLessThanOrEqual(2 * DAY)
    expect(card.leech).toBeUndefined()
  })

  it('re-shows a 顽固词 soon in the session, several times, rotating prompt types', () => {
    const item: SessionItem = {
      view: { word: 'fascia', phonetic: '', meanings: ['筋膜'], tags: [] },
      kind: 'review',
      mode: 'recognize',
      leech: true,
    }
    const others: SessionItem[] = ['a', 'b', 'c', 'd'].map((word) => ({
      view: { word, phonetic: '', meanings: [], tags: [] },
      kind: 'review',
      mode: 'recognize',
    }))
    const modes: string[] = []
    let queue = others
    for (let repeats = 0; repeats < LEECH_REPEATS; repeats++) {
      const { queue: next, repeated } = requeueAfterRating(queue, item, 1, { leech: true }, repeats)
      expect(repeated).toBe(true)
      const again = next[LEECH_GAP]!
      expect(again.view.word).toBe('fascia')
      expect(again.leech).toBe(true)
      modes.push(again.mode)
      queue = others
    }
    expect(new Set(modes).size).toBe(LEECH_REPEATS)
    // After its repeats a 顽固词 is done for this session.
    expect(requeueAfterRating(others, item, 1, { leech: true }, LEECH_REPEATS).repeated).toBe(false)
    // An ordinary forgotten word: once more at the end, as recognition.
    const plain = requeueAfterRating(others, { ...item, leech: false }, 1, {}, 0)
    expect(plain.queue.at(-1)?.mode).toBe('recognize')
    expect(requeueAfterRating(others, item, 3, { leech: true }, 0).repeated).toBe(false)
  })

  it('brings a course-exam word back in the final week before the exam', async () => {
    const examAt = NOW + 20 * DAY
    const card = {
      ...newVocabCard('plexus', 'b', NOW),
      reps: 6,
      state: 2 as const,
      stability: 80,
      difficulty: 5,
      last_review: NOW - 60 * DAY,
    }
    const next = scheduleVocabCard(card, 4, NOW, { examAt })
    expect(next.due).toBe(examAt - EXAM_WEEK_DAYS * DAY)
    // Scheduled past the exam before it was known: due in the final week.
    const late = { ...card, due: examAt + 30 * DAY, last_review: NOW }
    expect(dueForExamWeek(late, examAt, examAt - 3 * DAY)).toBe(true)
    expect(dueForExamWeek(late, examAt, NOW)).toBe(false)
    expect(dueForExamWeek({ ...late, last_review: examAt - 2 * DAY }, examAt, examAt - DAY)).toBe(
      false,
    )

    // Through the service, with an exam of the course in the plan.
    const { projects, projectId } = await course()
    await new CourseVocabService({ projects, db }).recordLookup({
      projectId,
      text: 'plexus',
      now: NOW,
    })
    await db.table('exams').put({ id: 'e1', projectId, at: examAt })
    const vocab = new VocabService(db)
    await new VocabRepository(db).putCard(late)
    const items = await vocab.session(examAt - 3 * DAY)
    expect(items.some((item) => item.view.word === 'plexus')).toBe(true)
  })
})

describe('daily load and next review', () => {
  it('estimates today’s vocabulary task for a course', async () => {
    const { projects, projectId } = await course()
    const service = new CourseVocabService({ projects, db })
    for (const word of ['pericardium', 'mediastinum', 'myocardium'])
      await service.recordLookup({ projectId, text: word, now: NOW })
    const vocab = new VocabService(db)
    await vocab.updateSettings({ dailyNew: 2 })
    await vocab.grade('pericardium', 3, 'learn', { now: NOW - 2 * DAY })
    const load = await vocab.planDailyLoad(projectId, NOW + DAY)
    expect(load.due).toBe(1)
    expect(load.new).toBe(2)
    expect(load.estimatedMinutes).toBeGreaterThanOrEqual(1)
    // Without a course or a chosen book: every due word, no new ones.
    expect(await vocab.planDailyLoad(undefined, NOW + DAY)).toEqual({
      due: 1,
      new: 0,
      estimatedMinutes: 1,
    })
  })

  it('shows when each learnt word comes back', async () => {
    const vocab = new VocabService(db)
    const card = await vocab.grade('bursa', 4, 'learn', { now: NOW })
    const schedules = await vocab.schedules(['bursa', 'tendon'])
    expect(schedules.get('bursa')).toMatchObject({ due: card.due, leech: false })
    expect(schedules.has('tendon')).toBe(false)
    const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
      translate('zh-CN', key, params)
    expect(formatNextReview(NOW - 1, t, NOW)).toBe('现在')
    expect(formatNextReview(NOW + 3 * DAY, t, NOW)).toBe('3 天后')
    expect(formatNextReview(new Date(2026, 11, 3).getTime(), t, NOW)).toBe('2026-12-03')
  })
})
