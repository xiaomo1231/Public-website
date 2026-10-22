import { describe, expect, it } from 'vitest'
import { chapterFromFileName, detectStructure } from '@/infrastructure/files/structureDetection'
import { joinTitleLines } from '@/infrastructure/files/pdfExtractor'

const para = (text: string, pageNumber: number) => ({ text, contentType: 'paragraph', pageNumber })

/** Course structure from slide decks (synthetic lines). */
describe('extraction regression — structure', () => {
  it('file-name-chapter: a deck without headings becomes one chapter named by the file', () => {
    const chunks = [para('Meeting 3.1', 1), para('Velocity and speed', 2), para('Practice', 3)]
    const { nodes, confidence, assignments } = detectStructure(chunks, { fileName: 'Ch03.pdf' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'chapter', number: '3', title: 'Chapter 3' })
    expect(nodes[0]!.pageStart).toBe(1)
    expect(nodes[0]!.pageEnd).toBe(3)
    expect(confidence).toBe('low')
    expect(assignments).toEqual([0, 0, 0])
  })

  it('file-name-patterns: Chapter / Unit / 第N章 are read, other names are not', () => {
    expect(chapterFromFileName('Chapter 3 - Motion.pdf')).toMatchObject({ number: '3' })
    expect(chapterFromFileName('Unit 2 notes.pdf')).toMatchObject({ type: 'unit', number: '2' })
    expect(chapterFromFileName('Unit_1_S_F2026.pdf')).toMatchObject({ number: '1' })
    expect(chapterFromFileName('第3章 动量.pdf')).toMatchObject({ number: '3', title: '第3章' })
    expect(chapterFromFileName('AdvProb3.1-3.2.pdf')).toBeNull()
    expect(chapterFromFileName('match03.pdf')).toBeNull()
    expect(chapterFromFileName('midterm.pdf')).toBeNull()
    // With any real heading signal the file name is not used.
    const { nodes } = detectStructure(
      [{ text: 'Chapter 7: Energy', contentType: 'heading', pageNumber: 1 }],
      { fileName: 'Ch03.pdf' },
    )
    expect(nodes[0]).toMatchObject({ number: '7', title: 'Energy' })
  })

  it('ch-abbreviation: "Ch. 4 – Motion in a Plane" is a chapter heading', () => {
    const { nodes } = detectStructure([
      { text: 'Ch. 4 – Motion in a Plane', contentType: 'heading', pageNumber: 1 },
      para('sketch the path', 1),
    ])
    expect(nodes[0]).toMatchObject({ type: 'chapter', number: '4', title: 'Motion in a Plane' })
  })

  it('multi-line-unit-title: same-size lines under "Unit 3:" join into one title', () => {
    const lines = joinTitleLines([
      { text: 'Unit 3: Reaction', height: 32, y: 500 },
      { text: 'Rates and', height: 32, y: 462 },
      { text: 'Equilibria', height: 32, y: 424 },
      { text: '(Chp 3 in the textbook)', height: 32, y: 386 },
      { text: 'Body text', height: 20, y: 300 },
    ])
    expect(lines.map((line) => line.text)).toEqual([
      'Unit 3: Reaction Rates and Equilibria',
      '(Chp 3 in the textbook)',
      'Body text',
    ])
    // A smaller line below is not part of the title.
    expect(
      joinTitleLines([
        { text: 'Unit 3: Reaction', height: 32, y: 500 },
        { text: 'by the instructor', height: 18, y: 470 },
      ]).map((line) => line.text),
    ).toEqual(['Unit 3: Reaction', 'by the instructor'])
  })

  it('lettered-dividers: "A/ …", "B/ …" headings open sections under the unit', () => {
    const { nodes } = detectStructure([
      { text: 'Unit 3: Reaction Rates and Equilibria', contentType: 'heading', pageNumber: 1 },
      { text: 'A/ The mole and molar mass', contentType: 'heading', pageNumber: 2 },
      para('One mole contains 6.022 × 10²³ entities.', 3),
      { text: 'B/ Percentage composition', contentType: 'heading', pageNumber: 4 },
      para('Mass percent of an element.', 5),
    ])
    expect(nodes.map((node) => `${node.type}:${node.number}:${node.title}`)).toEqual([
      'unit:3:Reaction Rates and Equilibria',
      'section:A:The mole and molar mass',
      'section:B:Percentage composition',
    ])
    // An unmarked "A/ …" line in running text opens nothing.
    expect(detectStructure([para('A/ The mole and molar mass', 1)], {}).nodes[0]!.title).toBe(
      'General Course Material',
    )
  })
})
