import { describe, expect, it } from 'vitest'
import {
  detectStructure,
  type StructureChunkInput,
} from '@/infrastructure/files/structureDetection'
import { findRunningLines, looksLikeHeadingLine } from '@/infrastructure/files/headingHeuristics'

const heading = (text: string, pageNumber: number): StructureChunkInput => ({
  text,
  contentType: 'heading',
  pageNumber,
})
const body = (text: string, pageNumber: number): StructureChunkInput => ({
  text,
  contentType: 'paragraph',
  pageNumber,
})

describe('heading lines in language-course materials', () => {
  it('accepts capitals in any alphabet and unit headings', () => {
    expect(looksLikeHeadingLine('BEMUTATKOZÁS, KÖSZÖNÉSEK')).toBe(true)
    expect(looksLikeHeadingLine('TESTRÉSZEK')).toBe(true)
    expect(looksLikeHeadingLine('2. lecke – BEMUTATKOZÁS, KÖSZÖNÉSEK')).toBe(true)
    expect(looksLikeHeadingLine('6.lecke- TESTRÉSZEK')).toBe(true)
    expect(looksLikeHeadingLine('8. lecke – MI A PANASZA MOST?')).toBe(true)
    expect(looksLikeHeadingLine('III. Körperteile/ Talking about parts of the body')).toBe(true)
    expect(looksLikeHeadingLine('Lektion 4')).toBe(true)
    expect(looksLikeHeadingLine('Unit 2: Hospital')).toBe(true)
    expect(looksLikeHeadingLine('Lesson 12')).toBe(true)
    // Still headings as before.
    expect(looksLikeHeadingLine('Chapter 1: Derivatives')).toBe(true)
    expect(looksLikeHeadingLine('LEARNING OBJECTIVES')).toBe(true)
  })

  it('rejects table-of-contents entries, answer keys and sentences', () => {
    expect(looksLikeHeadingLine('3. lecke – SZÁMOK ........................ 30')).toBe(false)
    expect(looksLikeHeadingLine('1: IGAZ, 2: HAMIS, 3: IGAZ')).toBe(false)
    expect(looksLikeHeadingLine('Fáj a nyakam.')).toBe(false)
    expect(looksLikeHeadingLine('C. Smith wrote the preface')).toBe(false)
    expect(looksLikeHeadingLine('der Kopf, die Köpfe')).toBe(false)
  })

  it('finds lines repeated on at least half of the pages', () => {
    const pages = Array.from({ length: 6 }, (_, i) => [
      'Einführung in die Medizinische Fachsprache Deutsch I.',
      `${i + 1}`,
      `Inhalt ${i}`,
    ])
    const running = findRunningLines(pages)
    expect(running.has('einführung in die medizinische fachsprache deutsch i.')).toBe(true)
    expect(running.has('#')).toBe(true)
    expect(running.has('inhalt #')).toBe(true)
    expect(findRunningLines(pages.slice(0, 3)).size).toBe(0)
  })
})

describe('structure of language-course materials', () => {
  it('detects Hungarian lessons and skips the table of contents and answer key repeats', () => {
    const chunks: StructureChunkInput[] = [
      body(
        'TARTALOMJEGYZÉK\n1. lecke- A MAGYAR ÁBÉCÉ ........ 6\n2. lecke – SZÁMOK ........ 13',
        2,
      ),
      heading('1. lecke- A MAGYAR ÁBÉCÉ', 6),
      body('A magyar magánhangzók: a, á, e, é, i, í, o, ó, ö, ő, u, ú, ü, ű.', 6),
      heading('BEMUTATKOZÁS', 9),
      body('Jó napot kívánok! Kovács Péter vagyok.', 9),
      heading('2. lecke – SZÁMOK', 13),
      body('egy, kettő, három, négy, öt', 13),
      heading('Megoldások', 40),
      heading('1.lecke', 40),
      body('lép, mell, kéz, fej', 40),
    ]
    const result = detectStructure(chunks)
    expect(result.confidence).toBe('high')
    expect(result.nodes.map((n) => [n.number, n.title])).toEqual([
      ['1', 'A MAGYAR ÁBÉCÉ'],
      ['2', 'SZÁMOK'],
    ])
    // The answer key continues the current lesson instead of a second "1".
    expect(result.assignments.slice(-3)).toEqual([1, 1, 1])
  })

  it('detects Roman-numeral, Lektion, Unit and Lesson headings', () => {
    const roman = detectStructure([
      heading('I. Einführung/ Introduction', 2),
      body('Name a few words that you already know in German.', 2),
      heading('II. Allgemeine Daten/ General data', 10),
      body('der Name, die Namen', 10),
      heading('III. Körperteile/ Talking about parts of the body', 18),
    ])
    expect(roman.nodes.map((n) => `${n.number} ${n.title}`)).toEqual([
      'I Einführung/ Introduction',
      'II Allgemeine Daten/ General data',
      'III Körperteile/ Talking about parts of the body',
    ])

    const keyword = detectStructure([
      heading('Lektion 1: Begrüßung', 1),
      body('Guten Tag!', 1),
      heading('Lesson 2', 3),
      body('Hello', 3),
      heading('Unit 3 – Hospital', 5),
    ])
    expect(keyword.nodes.map((n) => [n.type, n.number, n.title])).toEqual([
      ['chapter', '1', 'Begrüßung'],
      ['chapter', '2', 'Lesson 2'],
      ['unit', '3', 'Hospital'],
    ])
  })

  it('never opens a chapter at a running header', () => {
    const chunks: StructureChunkInput[] = []
    for (let page = 1; page <= 6; page++) {
      chunks.push(heading('I. Semmelweis University Handbook', page))
      chunks.push(body(`Text of page ${page}.`, page))
    }
    const result = detectStructure(chunks)
    expect(result.nodes).toHaveLength(1)
    expect(result.confidence).toBe('low')
  })
})
