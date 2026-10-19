import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { setVocabDataLoaderForTesting } from '@/infrastructure/vocab/wordData'
import { VocabService, resetVocabIndexForTesting, startOfDay } from '@/services/vocabService'
import { CourseVocabService } from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

/** The real word data built by scripts/build-vocab.mjs. */
beforeAll(() => {
  setVocabDataLoaderForTesting(async (file) => JSON.parse(readFileSync(join(process.cwd(), 'public', 'vocab', file), 'utf8')))
  resetVocabIndexForTesting()
})
afterAll(() => {
  setVocabDataLoaderForTesting(null)
  resetVocabIndexForTesting()
})

let db: AppDatabase
let service: VocabService
const NOW = new Date(2026, 9, 18, 9).getTime()
const DAY = 86400000

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  service = new VocabService(db)
})

describe('word books', () => {
  it('ships every exam book, most frequent words first', async () => {
    const books = await service.books()
    expect(books.map((book) => book.id).slice(0, 8)).toEqual(['exam:zk', 'exam:gk', 'exam:cet4', 'exam:cet6', 'exam:ky', 'exam:toefl', 'exam:ielts', 'exam:gre'])
    const cet4 = books.find((book) => book.id === 'exam:cet4')!
    expect(cet4.wordCount).toBeGreaterThan(3500)
    const words = await service.bookWords('exam:cet4')
    expect(words[0]!.meanings.length).toBeGreaterThan(0)
    expect(words.find((word) => word.word === 'abandon')?.meanings[0]).toContain('放弃')
  })
})

describe('daily session', () => {
  it('offers nothing until a book is chosen, then the daily new words', async () => {
    expect(await service.session(NOW)).toEqual([])
    await service.updateSettings({ bookId: 'exam:cet4', dailyNew: 5 })
    const items = await service.session(NOW)
    expect(items).toHaveLength(5)
    expect(items.every((item) => item.kind === 'new' && item.mode === 'learn')).toBe(true)
    const book = await service.bookWords('exam:cet4')
    expect(items.map((item) => item.view.word)).toEqual(book.slice(0, 5).map((view) => view.word))
  })

  it('counts new words learned today against the limit, and puts due reviews first', async () => {
    await service.updateSettings({ bookId: 'exam:cet4', dailyNew: 3 })
    const first = await service.session(NOW)
    for (const item of first) await service.grade(item.view.word, 3, 'learn', { now: NOW })
    expect(await service.session(NOW + 60000)).toEqual([])
    // Next day: the three come back first (as recognition), then three new words.
    const next = await service.session(NOW + DAY * 2)
    expect(next.slice(0, 3).map((item) => [item.kind, item.mode])).toEqual([
      ['review', 'recognize'],
      ['review', 'recognize'],
      ['review', 'recognize'],
    ])
    expect(next.slice(3).every((item) => item.kind === 'new')).toBe(true)
    expect(next).toHaveLength(6)
  })

  it('moves settled words to spelling, gap-fill and dictation', () => {
    const settings = { bookId: 'exam:cet4', dailyNew: 20, reviewMode: 'auto' as const }
    const card = { word: 'bursa', state: 2, reps: 3 } as never
    const withSentence = { word: 'bursa', phonetic: '', meanings: [], tags: [], context: { text: 'The bursa reduces friction.' } }
    expect(service.reviewMode({ word: 'x', state: 1, reps: 1 } as never, withSentence, settings)).toBe('recognize')
    expect(service.reviewMode(card, withSentence, settings)).toBe('spell')
    expect(service.reviewMode({ word: 'bursa', state: 2, reps: 4 } as never, withSentence, settings)).toBe('cloze')
    expect(service.reviewMode({ word: 'bursa', state: 2, reps: 4 } as never, { ...withSentence, context: { text: 'No word here.' } }, settings)).toBe('spell')
    expect(service.reviewMode({ word: 'bursa', state: 2, reps: 5 } as never, withSentence, settings)).toBe('dictation')
    expect(service.reviewMode(card, withSentence, { ...settings, reviewMode: 'spell' })).toBe('spell')
  })

  it('records misspellings for the mistake list and its practice', async () => {
    await service.grade('abandon', 3, 'learn', { now: NOW, bookId: 'exam:cet4' })
    await service.grade('abandon', 1, 'spell', { now: NOW + DAY, correct: false })
    const mistakes = await service.mistakes()
    expect(mistakes.map((m) => [m.view.word, m.card.mistakes])).toEqual([['abandon', 1]])
    expect((await service.mistakeSession()).map((item) => [item.view.word, item.mode])).toEqual([['abandon', 'spell']])
    await service.clearMistakes('abandon')
    expect(await service.mistakes()).toEqual([])
  })

  it('reports the streak, today’s work and the coming due dates', async () => {
    await service.updateSettings({ bookId: 'exam:cet4' })
    await service.grade('abandon', 3, 'learn', { now: NOW - DAY * 2 })
    await service.grade('ability', 3, 'learn', { now: NOW - DAY })
    await service.grade('able', 3, 'learn', { now: NOW })
    const stats = await service.stats(NOW)
    expect(stats.streak).toBe(3)
    expect(stats.newToday).toBe(1)
    expect(stats.reviewsToday).toBe(1)
    expect(stats.learned).toBe(3)
    expect(stats.forecast).toHaveLength(7)
    expect(stats.forecast.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3)
    // A gap breaks the streak.
    expect((await service.stats(NOW + DAY * 3)).streak).toBe(0)
    expect(startOfDay(NOW)).toBe(new Date(2026, 9, 18).getTime())
  })
})

describe('custom lists, import and export', () => {
  it('imports a list, filling meanings from the dictionary, and keeps progress when deleted', async () => {
    const result = await service.importList('Anatomy', 'abandon\nglenoid\t关节盂\nfoobarxyz', NOW)
    expect(result).toMatchObject({ added: 3, skipped: 0, withoutMeaning: 1 })
    const words = await service.bookWords(result.book.id)
    expect(words.map((word) => [word.word, word.meanings[0] ?? ''])).toEqual([
      ['abandon', expect.stringContaining('放弃')],
      ['glenoid', '关节盂'],
      ['foobarxyz', ''],
    ])
    await service.grade('glenoid', 3, 'learn', { now: NOW, bookId: result.book.id })
    await service.deleteBook(result.book.id)
    expect((await service.books()).some((book) => book.id === result.book.id)).toBe(false)
    expect(await new VocabRepository(db).getCard('glenoid')).toBeDefined()
    await expect(service.deleteBook('exam:cet4')).rejects.toThrow()
  })

  it('exports a book, the learned words and the mistakes for other apps', async () => {
    const { book } = await service.importList('Joints', 'glenoid\t关节盂\nlabrum\t唇', NOW)
    const anki = await service.export({ bookId: book.id }, 'anki')
    expect(anki.filename).toBe('vocab-Joints-anki.txt')
    expect(anki.content).toContain('glenoid\t关节盂\tJoints')
    const cet4 = (await service.export({ bookId: 'exam:cet4' }, 'anki')).content
    expect(cet4).not.toMatch(/\bcet4 cet4\b/)
    expect(cet4).not.toContain('[计]')
    const csv = await service.export({ bookId: 'exam:cet4' }, 'csv')
    expect(csv.mimeType).toContain('text/csv')
    expect(csv.content.split('\r\n').length).toBeGreaterThan(3500)
    await service.grade('labrum', 1, 'spell', { now: NOW, correct: false, bookId: book.id })
    expect((await service.export('mistakes', 'txt')).content).toBe('labrum\n')
    expect((await service.export('learned', 'txt')).content).toBe('labrum\n')
  })
})

describe('course vocabulary', () => {
  async function course(text: string[]) {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Anatomy', subject: 'medicine' })
    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId: project.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
    await docs.update(doc.id, { status: 'ready' })
    await new ChunkRepository(db).addMany(
      text.map((t, i) => ({ documentId: doc.id, projectId: project.id, contentType: 'paragraph' as const, text: t, sourceReference: 'atlas', order: i, pageNumber: i + 2 })),
    )
    return { projects, projectId: project.id }
  }

  const TEXT = [
    'The glenoid labrum deepens the glenoid cavity of the scapula. The labrum is made of fibrocartilage.',
    'Subacromial bursae reduce friction between the rotator cuff and the acromion. Inflammation of the bursa is common.',
  ]

  function glossAI(skip: string[] = []) {
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      const words = [...messages[1]!.content.matchAll(/^\d+\. (\S+) — /gm)].map((m) => m[1]!)
      return {
        data: { terms: words.map((word) => ({ word, pos: 'n.', meaning: skip.includes(word) ? null : `${word}的释义`, phonetic: null })) },
      }
    })
    return { ai: { chatJSON } as unknown as AIService, chatJSON }
  }

  it('picks the uncommon words with their sentence and page, glossing the rest with the AI', async () => {
    const { projects, projectId } = await course(TEXT)
    const { ai, chatJSON } = glossAI(['subacromial'])
    const result = await new CourseVocabService({ projects, ai, db }).extract(projectId, { now: NOW })
    const entries = await new VocabRepository(db).listEntries(result.book.id)
    const words = entries.map((entry) => entry.word)
    expect(words).toEqual(expect.arrayContaining(['glenoid', 'labrum', 'fibrocartilage', 'acromion']))
    // Common and CET-4-level words are skipped.
    for (const common of ['reduce', 'between', 'common', 'friction', 'made']) expect(words).not.toContain(common)
    // The AI said "subacromial" is not a word: dropped.
    expect(words).not.toContain('subacromial')
    const labrum = entries.find((entry) => entry.word === 'labrum')!
    expect(labrum).toMatchObject({ occurrences: 2, glossBy: 'ai', meanings: ['n. labrum的释义'], context: { page: 2, documentName: 'atlas.pdf' } })
    const inflammation = entries.find((entry) => entry.word === 'inflammation')
    if (inflammation) expect(inflammation.glossBy).toBe('dictionary')
    expect(chatJSON).toHaveBeenCalled()
    expect(result).toMatchObject({ total: entries.length, unglossed: 0 })
    // The course words appear with their sentence wherever the word is studied.
    expect((await new VocabService(db).view('labrum')).context?.text).toContain('labrum')
  })

  it('works without an AI and does not duplicate words when run again', async () => {
    const { projects, projectId } = await course(TEXT)
    const first = await new CourseVocabService({ projects, ai: null, db }).extract(projectId, { now: NOW })
    expect(first.unglossed).toBeGreaterThan(0)
    const second = await new CourseVocabService({ projects, ai: glossAI().ai, db }).extract(projectId, { now: NOW + 1 })
    expect(second.added).toBe(0)
    expect(second.total).toBe(first.total)
    expect(second.unglossed).toBe(0)
    expect(second.book.id).toBe(first.book.id)
  })

  it('goes with its course, but word progress stays', async () => {
    const { projects, projectId } = await course(TEXT)
    const { book } = await new CourseVocabService({ projects, ai: glossAI().ai, db }).extract(projectId, { now: NOW })
    await new VocabService(db).grade('labrum', 3, 'learn', { now: NOW, bookId: book.id })
    await new DataManagementService(db).deleteProject(projectId)
    const repo = new VocabRepository(db)
    expect(await repo.listEntries(book.id)).toEqual([])
    expect(await repo.getBook(book.id)).toBeUndefined()
    expect(await repo.getCard('labrum')).toBeDefined()
  })
})
