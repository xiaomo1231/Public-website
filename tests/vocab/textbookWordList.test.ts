import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import { grammarLine } from '@/entities/vocab/types'
import {
  TextbookWordListService,
  looksLikeWordList,
  planWordListParts,
  validateWordListItems,
} from '@/services/textbookWordList'
import { PhraseCardService, looksLikeDialogue, validatePhrases } from '@/services/phraseCards'
import { ReviewCardService } from '@/services/reviewCardService'
import { VocabService } from '@/services/vocabService'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { DocumentChunk } from '@/entities/chunk/types'

const FIXTURES = join(__dirname, '..', 'fixtures', 'language')
const DE = readFileSync(join(FIXTURES, 'de_course.txt'), 'utf8')
const HU = readFileSync(join(FIXTURES, 'hu_course.txt'), 'utf8')

/** The fixture split into pages, as processed chunks would be. */
function pagesOf(text: string): Array<{ page: number; text: string }> {
  return text
    .split(/^=== PAGE (\d+) ===\n/m)
    .slice(1)
    .reduce<Array<{ page: number; text: string }>>((pages, part, i, all) => {
      if (i % 2 === 0) pages.push({ page: Number(part), text: all[i + 1]!.trim() })
      return pages
    }, [])
}

describe('word list validation', () => {
  it('keeps German nouns with article and plural found in the text', () => {
    const kept = validateWordListItems(
      [
        { term: 'Kopf', gloss: 'head', article: 'der', plural: 'Köpfe', lesson: 'Körperteile' },
        // The article inside the term is split off.
        { term: 'die Hand', gloss: 'hand', article: null, plural: 'die Hände' },
        // Article not der / die / das.
        { term: 'Fuß', gloss: 'foot', article: 'dem', plural: 'Füße' },
        // Not in the text.
        { term: 'Lunge', gloss: 'lung', article: 'die', plural: 'Lungen' },
        // No gloss.
        { term: 'Zahn', gloss: '', article: 'der' },
        // A plural the text does not write is dropped, the word stays.
        { term: 'Organ', gloss: 'organ', article: 'das', plural: 'Organen' },
        // Duplicate.
        { term: 'Kopf', gloss: 'head again', article: 'der' },
      ],
      { text: DE },
      'de',
      'Lektion 1',
    )
    expect(kept).toEqual([
      { term: 'Kopf', gloss: 'head', article: 'der', plural: 'Köpfe', lesson: 'Körperteile' },
      { term: 'Hand', gloss: 'hand', article: 'die', plural: 'Hände', lesson: 'Lektion 1' },
      { term: 'Organ', gloss: 'organ', article: 'das', lesson: 'Lektion 1' },
    ])
  })

  it('keeps Hungarian "word gloss" lines with accents exact', () => {
    const kept = validateWordListItems(
      [
        { term: 'beteg', gloss: 'sick, ill' },
        { term: 'fogorvostanhallgató', gloss: 'dentistry student' },
        { term: 'Elnézést!', gloss: 'Excuse me!' },
        // Accents must match the text.
        { term: 'koszonom', gloss: 'thank you' },
        // A Hungarian list has no articles.
        { term: 'egyetem', gloss: 'university', article: 'der' },
        // Invented.
        { term: 'kórház', gloss: 'hospital' },
      ],
      { text: HU },
      'hu',
    )
    expect(kept.map((item) => item.term)).toEqual(['beteg', 'fogorvostanhallgató', 'Elnézést!'])
  })

  it('spots word-list parts', () => {
    expect(looksLikeWordList('Szótár\nbeteg sick')).toBe(true)
    expect(looksLikeWordList(pagesOf(DE)[1]!.text)).toBe(true)
    expect(looksLikeWordList('A long paragraph of reading text that goes on and on.')).toBe(false)
  })

  it('shows a German noun in dictionary form', () => {
    expect(grammarLine({ word: 'Kopf', article: 'der', plural: 'Köpfe' })).toBe(
      'der Kopf, die Köpfe',
    )
    expect(grammarLine({ word: 'Mund', article: 'der' })).toBe('der Mund')
    expect(grammarLine({ word: 'beteg' })).toBeUndefined()
  })
})

describe('phrase validation', () => {
  const chunks = new Map(
    pagesOf(HU).map((page) => [
      `hu-${page.page}`,
      { id: `hu-${page.page}`, text: page.text, pageNumber: page.page },
    ]),
  )

  it('keeps phrases found verbatim in their passage', () => {
    const kept = validatePhrases(
      [
        {
          prompt: '问病人现在哪里不舒服',
          phrase: 'Mi a panasza most?',
          kind: 'question',
          sourceChunkId: 'hu-66',
        },
        {
          prompt: '我肚子很疼，还发烧',
          phrase: '-Nagyon fáj a hasam és lázas vagyok.',
          kind: 'answer',
          sourceChunkId: 'hu-66',
        },
        // Not in the passage it names.
        {
          prompt: '哪里疼？',
          phrase: 'Hol fáj pontosan?',
          kind: 'question',
          sourceChunkId: 'hu-28',
        },
        // An exercise line with a gap.
        { prompt: '问主诉', phrase: 'Mi a ……………………………?', kind: 'question', sourceChunkId: 'hu-72' },
        // Unknown passage.
        { prompt: 'x', phrase: 'Mi a panasza most?', kind: 'question', sourceChunkId: 'nope' },
        // Same prompt again.
        {
          prompt: '问病人现在哪里不舒服',
          phrase: 'Igen, a hasam fáj.',
          kind: 'answer',
          sourceChunkId: 'hu-72',
        },
        // Accent changed: not verbatim.
        {
          prompt: '我的肚子疼',
          phrase: 'Igen, a hasam faj.',
          kind: 'answer',
          sourceChunkId: 'hu-72',
        },
        { prompt: '问候', phrase: 'Jó napot kívánok.', kind: 'greeting', sourceChunkId: 'hu-66' },
      ],
      chunks,
    )
    expect(kept).toEqual([
      {
        prompt: '问病人现在哪里不舒服',
        phrase: 'Mi a panasza most?',
        kind: 'question',
        chunkId: 'hu-66',
        page: 66,
      },
      {
        prompt: '我肚子很疼，还发烧',
        phrase: 'Nagyon fáj a hasam és lázas vagyok.',
        kind: 'answer',
        chunkId: 'hu-66',
        page: 66,
      },
      {
        prompt: '问候',
        phrase: 'Jó napot kívánok.',
        kind: 'expression',
        chunkId: 'hu-66',
        page: 66,
      },
    ])
  })

  it('finds dialogue passages', () => {
    expect(looksLikeDialogue(pagesOf(HU).find((p) => p.page === 66)!.text)).toBe(true)
    expect(looksLikeDialogue(pagesOf(HU).find((p) => p.page === 28)!.text)).toBe(false)
  })
})

describe('importing a textbook word list into the course book', () => {
  let db: AppDatabase
  const NOW = new Date(2026, 9, 21, 9).getTime()

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function course(language: string, text: string) {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: `Kurs ${language}`, subject: 'medicine' })
    await db.projects.update(project.id, {
      subject: 'language',
      targetLanguage: language,
    } as Record<string, unknown>)
    const docs = new DocumentRepository(db)
    const doc = await docs.create({
      projectId: project.id,
      type: 'pdf',
      name: `${language}.pdf`,
      sizeBytes: 1,
    })
    await docs.update(doc.id, { status: 'ready' })
    const chunks = await new ChunkRepository(db).addMany(
      pagesOf(text).map((page, i) => ({
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph' as const,
        text: page.text,
        sourceReference: `${language} p${page.page}`,
        order: i,
        pageNumber: page.page,
        chapterTitle: page.page < 30 ? 'Lektion 1' : 'Lektion 2',
      })),
    )
    return { projectId: project.id, documentId: doc.id, chunks }
  }

  it('splits the German list with the AI, keeps only grounded entries, then merges', async () => {
    const { projectId, documentId } = await course('de', DE)
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      const user = messages[1]!.content
      expect(user).toContain('UNTRUSTED CONTENT')
      const items = user.includes('der Kopf, die Köpfe')
        ? [
            { term: 'Kopf', gloss: 'head', article: 'der', plural: 'Köpfe', lesson: null },
            { term: 'Zahn', gloss: 'tooth', article: 'der', plural: 'Zähne', lesson: null },
            { term: 'Herz', gloss: 'heart', article: 'das', plural: 'Herzen', lesson: null },
            { term: 'Wade', gloss: 'calf', article: 'der', plural: 'Waden', lesson: null },
          ]
        : []
      return { data: { items } }
    })
    const service = new TextbookWordListService({ ai: { chatJSON } as unknown as AIService, db })
    const result = await service.split(projectId, documentId)
    expect(chatJSON.mock.calls[0]![0][0]!.content).toContain('German')
    // "Herz" is not in the text; the text prints "die Wade", not "der Wade".
    expect(result.candidates.map((c) => c.term)).toEqual(['Kopf', 'Zahn'])
    const kopf = result.candidates[0]!
    expect(kopf).toMatchObject({ article: 'der', plural: 'Köpfe', lesson: 'Lektion 1' })
    expect(kopf.context).toMatchObject({ page: 14, documentName: 'de.pdf' })
    expect(kopf.context?.text).toContain('der Kopf, die Köpfe')

    // The student edits a gloss.
    const confirmed = result.candidates.map((c) =>
      c.term === 'Zahn' ? { ...c, gloss: '牙 (tooth)' } : c,
    )
    const merged = await service.merge(projectId, confirmed, NOW)
    expect(merged).toMatchObject({ added: 2, updated: 0 })
    expect(merged.book).toMatchObject({ kind: 'course', projectId, language: 'de' })
    const entries = await new VocabRepository(db).listEntries(merged.book.id)
    expect(entries.find((e) => e.word === 'Zahn')).toMatchObject({
      meanings: ['牙 (tooth)'],
      glossBy: 'user',
      article: 'der',
      plural: 'Zähne',
    })

    // Importing again updates instead of duplicating (same wordKey).
    const again = await service.merge(
      projectId,
      [{ term: 'Kopf', gloss: '头 (head)', article: 'der', plural: 'Köpfe' }],
      NOW + 1,
    )
    expect(again).toMatchObject({ added: 0, updated: 1, book: { id: merged.book.id } })
    const after = await new VocabRepository(db).listEntries(merged.book.id)
    expect(after.filter((e) => e.word === 'Kopf')).toHaveLength(1)
    expect(after.find((e) => e.word === 'Kopf')!.meanings).toEqual(['头 (head)'])

    // The word shows in dictionary form in the word book.
    const words = await new VocabService(db).bookWords(merged.book.id)
    expect(words.find((w) => w.word === 'Kopf')?.grammar).toBe('der Kopf, die Köpfe')
  })

  it('reads a Hungarian Szótár and rejects invented words', async () => {
    const { projectId, documentId } = await course('hu', HU)
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => ({
      data: {
        items: messages[1]!.content.includes('Szótár')
          ? [
              {
                term: 'beteg',
                gloss: 'sick, ill',
                article: null,
                plural: null,
                lesson: '1. lecke',
              },
              { term: 'éhes', gloss: 'hungry' },
              { term: 'ehes', gloss: 'hungry' },
              { term: 'orvos', gloss: 'doctor' },
            ]
          : [],
      },
    }))
    const service = new TextbookWordListService({ ai: { chatJSON } as unknown as AIService, db })
    const { candidates } = await service.split(projectId, documentId)
    expect(candidates.map((c) => [c.term, c.lesson])).toEqual([
      ['beteg', '1. lecke'],
      ['éhes', 'Lektion 1'],
    ])
  })

  it('refuses a course that is not a language course', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Physik', subject: 'physics' })
    await expect(
      new TextbookWordListService({ db }).merge(project.id, [{ term: 'x', gloss: 'y' }]),
    ).rejects.toThrow()
  })

  it('groups parts by chapter', () => {
    const chunk = (id: string, chapterTitle: string, text: string, order: number) =>
      ({ id, chapterTitle, chapterId: chapterTitle, text, order }) as DocumentChunk
    const parts = planWordListParts([
      chunk('a', 'L1', 'Szótár\nbeteg sick', 0),
      chunk('b', 'L1', 'jó good', 1),
      chunk('c', 'L2', 'Wortschatz\nder Kopf', 2),
    ])
    expect(parts.map((part) => [part.lesson, part.chunks.map((c) => c.id)])).toEqual([
      ['L1', ['a', 'b']],
      ['L2', ['c']],
    ])
  })
})

describe('phrase cards', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('extracts grounded phrases and saves them as review cards (with reverse)', async () => {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Magyar', subject: 'medicine' })
    await db.projects.update(project.id, {
      subject: 'language',
      targetLanguage: 'hu',
    } as Record<string, unknown>)
    const docs = new DocumentRepository(db)
    const doc = await docs.create({
      projectId: project.id,
      type: 'pdf',
      name: 'hu.pdf',
      sizeBytes: 1,
    })
    await docs.update(doc.id, { status: 'ready', materialType: 'textbook' } as Record<
      string,
      unknown
    >)
    const chunks = await new ChunkRepository(db).addMany(
      pagesOf(HU).map((page, i) => ({
        documentId: doc.id,
        projectId: project.id,
        contentType: 'paragraph' as const,
        text: page.text,
        sourceReference: `p${page.page}`,
        order: i,
        pageNumber: page.page,
      })),
    )
    const dialogue = chunks.find((chunk) => chunk.pageNumber === 66)!
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      // Only dialogue passages are sent.
      expect(messages[1]!.content).not.toContain('fogorvostanhallgató')
      return {
        data: {
          phrases: [
            {
              prompt: '问主诉',
              phrase: 'Mi a panasza most?',
              kind: 'question',
              sourceChunkId: dialogue.id,
            },
            {
              prompt: '问哪里疼',
              phrase: 'Hol fáj pontosan?',
              kind: 'question',
              sourceChunkId: dialogue.id,
            },
            { prompt: '编造', phrase: 'Fáj a szívem.', kind: 'answer', sourceChunkId: dialogue.id },
          ],
        },
      }
    })
    const service = new PhraseCardService({ ai: { chatJSON } as unknown as AIService, db })
    const found = await service.extract(project.id)
    expect(found.map((p) => p.phrase)).toEqual(['Mi a panasza most?', 'Hol fáj pontosan?'])

    const added = await service.save(project.id, found, { reverse: true })
    expect(added).toBe(4)
    const cards = await new ReviewCardService(db).list(project.id)
    expect(cards.every((card) => card.source === 'phrase')).toBe(true)
    expect(cards.find((card) => card.front === '问主诉')?.back).toBe('Mi a panasza most?')
    expect(cards.find((card) => card.front === 'Mi a panasza most?')?.back).toBe('问主诉')
    // Saving again adds nothing: fronts are unique per course.
    expect(await service.save(project.id, found, { reverse: true })).toBe(0)
  })
})
