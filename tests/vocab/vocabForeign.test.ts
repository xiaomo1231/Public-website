import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { setVocabDataLoaderForTesting } from '@/infrastructure/vocab/wordData'
import { VocabService, resetVocabIndexForTesting } from '@/services/vocabService'
import { CourseVocabService } from '@/services/courseVocabService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import {
  checkSpelling,
  clozeOf,
  dropRunningLines,
  extractCourseTerms,
  parseWordList,
  wordKey,
} from '@/entities/vocab/text'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

/** Real lines from a Hungarian medical-terminology textbook (Semmelweis). */
const HU_PAGES = [
  'Hungarian medical terminology I.\nSemmelweis Egyetem, Szaknyelvi Intézet\n-Milyen erős a fájdalom 1 és 10 között?\n-Hol dagad a lába? A bokája? A vádlija dagad?',
  'Hungarian medical terminology I.\nSemmelweis Egyetem, Szaknyelvi Intézet\n1/A: Hol fáj? Kérdezze a pácienst a fájdalom helyéről és jelölje a válasz alapján a fájdalom helyét!',
  'Hungarian medical terminology I.\nSemmelweis Egyetem, Szaknyelvi Intézet\n-Értem, a mellkasa hol fáj pontosan? Sugárzik valahová a fájdalom?',
  'Hungarian medical terminology I.\nSemmelweis Egyetem, Szaknyelvi Intézet\nA hátam kicsit fáj. Nagyon fáj a nyakam. A lábfejem nem dagad.',
]

/** Real lines from a German medical-language course (running header on every page). */
const DE_PAGES = [
  'Einführung in die Medizinische / Pharmazeutische Fachsprache Deutsch I.\nKatalin Fogarasi 2024, Institut für Fachsprachen, Semmelweis Universität\n10\nÄ ä die Ärztin (female physician)\nÜ ü die Übelkeit (nausea)\nß die Straße (street)',
  'Einführung in die Medizinische / Pharmazeutische Fachsprache Deutsch I.\nKatalin Fogarasi 2024, Institut für Fachsprachen, Semmelweis Universität\n11\nder Schmerz, plural: die Schmerzen = pain. Wo haben Sie Schmerzen? Der Patient beschreibt die Schmerzen.',
  'Einführung in die Medizinische / Pharmazeutische Fachsprache Deutsch I.\nKatalin Fogarasi 2024, Institut für Fachsprachen, Semmelweis Universität\n12\nIch habe Übelkeit und Bauchschmerzen. Die Übelkeit ist so schlimm!',
  'Einführung in die Medizinische / Pharmazeutische Fachsprache Deutsch I.\nKatalin Fogarasi 2024, Institut für Fachsprachen, Semmelweis Universität\n13\nAuf der Straße fühlt sie Übelkeit. Schmerzen im Bauch.',
]

const pages = (texts: string[], documentName = 'book.pdf') =>
  texts.map((text, i) => ({ text, page: i + 10, documentName }))

const identity = { isCommon: () => false, lemma: (token: string) => token, limit: 50 }

describe('Unicode words in course material', () => {
  it('keeps Hungarian accented words whole and drops the running header', () => {
    const terms = extractCourseTerms(pages(HU_PAGES), { ...identity, language: 'hu' })
    const words = terms.map((term) => term.word)
    expect(words).toContain('fájdalom')
    expect(terms.find((term) => term.word === 'fájdalom')!.occurrences).toBe(4)
    expect(words).toContain('pácienst')
    // No fragments cut at an accented letter.
    expect(words).not.toContain('jdalom')
    expect(words.some((word) => /^(jdalom|cienst|rdezze)$/.test(word))).toBe(false)
    // "Semmelweis Egyetem …" is on every page: a header, not a term.
    expect(words).not.toContain('Semmelweis')
    expect(words).not.toContain('Egyetem')
  })

  it('keeps German words with umlauts and ß, and the capital of nouns', () => {
    const terms = extractCourseTerms(pages(DE_PAGES), { ...identity, language: 'de' })
    const words = terms.map((term) => term.word)
    expect(words).toContain('Übelkeit')
    expect(words).toContain('Straße')
    expect(words).toContain('Schmerzen')
    expect(words).not.toContain('belkeit')
    expect(words).not.toContain('stra')
    // The page header ("Einführung …", "Fogarasi", "Semmelweis") is dropped.
    expect(words).not.toContain('Fogarasi')
    expect(words).not.toContain('Einführung')
    expect(words).not.toContain('Fachsprache')
    expect(terms.find((term) => term.word === 'Übelkeit')!.context.text).toContain('Übelkeit')
  })

  it('reads accented words in English material too, lower-cased as before', () => {
    const terms = extractCourseTerms(
      [{ text: 'The Übelkeit of the café patient. Another café visit.' }],
      identity,
    )
    expect(terms.map((term) => term.word)).toEqual(expect.arrayContaining(['übelkeit', 'café']))
  })

  it('drops lines repeated on most pages only when there are enough pages', () => {
    const few = pages(HU_PAGES.slice(0, 3))
    expect(dropRunningLines(few)).toBe(few)
    const cleaned = dropRunningLines(pages(HU_PAGES))
    expect(cleaned.every((source) => !source.text.includes('Semmelweis'))).toBe(true)
    expect(cleaned[0]!.text).toContain('fájdalom')
  })
})

describe('word lists in other languages', () => {
  it('reads "die Ärztin – female doctor" and "fájdalom pain"', () => {
    expect(parseWordList('die Ärztin – female doctor', { language: 'de' }).words).toEqual([
      { word: 'die Ärztin', meaning: 'female doctor' },
    ])
    expect(parseWordList('fájdalom pain', { language: 'hu' }).words).toEqual([
      { word: 'fájdalom', meaning: 'pain' },
    ])
  })

  it('keeps articles with nouns, case, and phrases without a gloss', () => {
    const { words, skipped } = parseWordList(
      'der Arzt physician\ndie Übelkeit\tnausea\nStraße = street\nder Arzt\nSchmerz, 疼痛',
      { language: 'de' },
    )
    expect(skipped).toBe(0)
    expect(words).toEqual([
      { word: 'der Arzt', meaning: 'physician' },
      { word: 'die Übelkeit', meaning: 'nausea' },
      { word: 'Straße', meaning: 'street' },
      { word: 'Schmerz', meaning: '疼痛' },
    ])
    expect(parseWordList('fáj a fejem\na fej head', { language: 'hu' }).words).toEqual([
      { word: 'fáj a fejem' },
      { word: 'a fej', meaning: 'head' },
    ])
  })

  it('keeps English lists as before (lower-cased, no space-separated gloss)', () => {
    expect(parseWordList('Abandon\nphysiology\tn. 生理学\nglenoid, 关节盂\ngive up').words).toEqual(
      [
        { word: 'abandon' },
        { word: 'physiology', meaning: 'n. 生理学' },
        { word: 'glenoid', meaning: '关节盂' },
        { word: 'give up' },
      ],
    )
    // Accented English loanwords are words now.
    expect(parseWordList('café').words).toEqual([{ word: 'café' }])
  })

  it('keys English words lower-case and other languages as written', () => {
    expect(wordKey(' Tendon ')).toBe('tendon')
    expect(wordKey('Arzt', 'de')).toBe('Arzt')
    expect(wordKey('fájdalom', 'hu-HU')).toBe('fájdalom')
  })
})

describe('spelling in other languages', () => {
  it('rates accents, capitals and ß / ss as near misses with the reason', () => {
    expect(checkSpelling('fájdalom', 'fájdalom', 'hu')).toEqual({
      correct: true,
      nearMiss: false,
      outcome: 'exact',
    })
    expect(checkSpelling('fajdalom', 'fájdalom', 'hu')).toMatchObject({
      correct: false,
      nearMiss: true,
      outcome: 'accent',
    })
    expect(checkSpelling('arzt', 'Arzt', 'de')).toMatchObject({ nearMiss: true, outcome: 'case' })
    expect(checkSpelling('Strasse', 'Straße', 'de')).toMatchObject({
      nearMiss: true,
      outcome: 'variant',
    })
    expect(checkSpelling('Uebelkeit', 'Übelkeit', 'de')).toMatchObject({ outcome: 'variant' })
    expect(checkSpelling('Hund', 'Arzt', 'de')).toMatchObject({ correct: false, nearMiss: false })
  })

  it('leaves English exactly as it was', () => {
    expect(checkSpelling('Tendon', 'tendon')).toEqual({ correct: true, nearMiss: false })
    expect(checkSpelling('tendom', 'tendon')).toEqual({ correct: false, nearMiss: true })
    expect(checkSpelling('ligament', 'tendon')).toEqual({ correct: false, nearMiss: false })
  })

  it('blanks accented words in a sentence', () => {
    expect(clozeOf('Milyen erős a fájdalom 1 és 10 között?', 'fájdalom', [], 'hu')).toEqual({
      text: 'Milyen erős a _____ 1 és 10 között?',
      answer: 'fájdalom',
    })
    // No match inside a longer word.
    expect(clozeOf('Bauchschmerzen und Übelkeiten', 'Übelkeit', [], 'de')).toBeNull()
    expect(clozeOf('Die Übelkeit ist schlimm.', 'Übelkeit', [], 'de')?.answer).toBe('Übelkeit')
  })
})

describe('vocabulary service with other languages', () => {
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
  let service: VocabService
  const NOW = new Date(2026, 9, 18, 9).getTime()

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    service = new VocabService(db)
  })

  it('imports a German list without the English dictionary and keeps capitals', async () => {
    const result = await service.importList(
      'Deutsch',
      'die Ärztin – female doctor\nArzt\ndie\tthe',
      NOW,
      'de-DE',
    )
    expect(result.book.language).toBe('de')
    expect(result.withoutMeaning).toBe(1)
    const words = await service.bookWords(result.book.id)
    expect(words.map((word) => word.word)).toEqual(['die Ärztin', 'Arzt', 'die'])
    // "die" is an English dictionary word, but this book is German.
    expect(words[2]!.meanings).toEqual(['the'])
    expect(words[1]!.meanings).toEqual([])
    const summary = (await service.books()).find((book) => book.id === result.book.id)
    expect(summary?.language).toBe('de')
  })

  it('stores progress under the written form and offers the book language in sessions', async () => {
    const { book } = await service.importList('Deutsch', 'Arzt – physician', NOW, 'de')
    await service.updateSettings({ bookId: book.id })
    const items = await service.session(NOW)
    expect(items).toEqual([expect.objectContaining({ kind: 'new', language: 'de' })])
    await service.grade('Arzt', 2, 'spell', { correct: false, language: 'de', now: NOW })
    const repo = new VocabRepository(db)
    expect(await repo.getCard('Arzt')).toBeDefined()
    expect(await repo.getCard('arzt')).toBeUndefined()
    // Mistake list and details find it by its written form; no English root hints.
    await service.grade('Arzt', 1, 'spell', { correct: false, language: 'de', now: NOW })
    const mistakes = await service.mistakes()
    expect(mistakes[0]!.view).toMatchObject({ word: 'Arzt', meanings: ['physician'] })
    expect((await service.details('Arzt', 'de')).roots).toEqual([])
    await service.clearMistakes('Arzt')
    expect((await repo.getCard('Arzt'))!.mistakes).toBe(0)
  })

  it('keeps English progress lower-cased as before', async () => {
    await service.grade('Tendon', 3, 'learn', { now: NOW })
    expect(await new VocabRepository(db).getCard('tendon')).toBeDefined()
  })

  it('makes a course book in the course language, glossed by the AI', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Medizinisches Deutsch', subject: 'medicine' })
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
    await new ChunkRepository(db).addMany(
      DE_PAGES.map((text, i) => ({
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph' as const,
        text,
        sourceReference: 'de',
        order: i,
        pageNumber: i + 10,
      })),
    )
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      const words = [...messages[1]!.content.matchAll(/^\d+\. (\S+) — /gm)].map((m) => m[1]!)
      return {
        data: {
          terms: words.map((word) => ({
            word: word.toLowerCase(),
            pos: 'n.',
            meaning: `${word}的释义`,
          })),
        },
      }
    })
    const result = await new CourseVocabService({
      projects,
      ai: { chatJSON } as unknown as AIService,
      db,
    }).extract(project.id, { now: NOW })
    expect(result.book.language).toBe('de')
    expect(chatJSON.mock.calls[0]![0][0]!.content).toContain('German')
    expect(chatJSON.mock.calls[0]![0][1]!.content).toContain('Course language: German.')
    const entries = await new VocabRepository(db).listEntries(result.book.id)
    const uebelkeit = entries.find((entry) => entry.word === 'Übelkeit')
    // Glossed although the model answered in lower case.
    expect(uebelkeit).toMatchObject({ glossBy: 'ai', meanings: ['n. Übelkeit的释义'] })
    expect(entries.some((entry) => entry.word === 'Fogarasi')).toBe(false)
    expect(entries.some((entry) => entry.word === 'belkeit')).toBe(false)
  })
})
