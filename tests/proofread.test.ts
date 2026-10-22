import { describe, expect, it } from 'vitest'
import {
  classifyEdit,
  findProofreadRisks,
  insertSubpartBoundary,
  mergeSubpart,
  normalizeQuestionNumber,
  proofreadAnswerText,
  reconfirmItems,
  subpartLabels,
  suggestImageCompare,
  chunkLowConfidence,
  textSimilarity,
} from '@/entities/homework/proofread'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'

const kinds = (text: string, source?: string) => findProofreadRisks(text, source).map((r) => r.kind)

describe('findProofreadRisks', () => {
  it('flags dashes used where a minus sign belongs', () => {
    const risks = findProofreadRisks('Solve x – 3 = –5')
    expect(risks.filter((r) => r.kind === 'minus_sign')).toHaveLength(2)
    expect(risks[0]!.text).toBe('–')
    // A plain hyphen-minus is fine.
    expect(kinds('Solve x - 3 = -5')).not.toContain('minus_sign')
  })

  it('flags flattened exponents and subscripts', () => {
    expect(findProofreadRisks('a = 9.8 m/s2 downward').map((r) => r.text)).toContain('m/s2')
    expect(
      findProofreadRisks('k = 3.2 x10-1 per s').some((r) => r.kind === 'flattened_power'),
    ).toBe(true)
    expect(kinds('Let x2 + 1 = 0')).toContain('flattened_power')
    // Already written with ^ / _ : not flagged.
    expect(kinds('a = 9.8 m/s^2 and 10^{-1}')).not.toContain('flattened_power')
  })

  it('flags matrices, tables and stacked fractions', () => {
    expect(kinds('A =\n1 2 3\n4 5 6\nfind det')).toContain('matrix')
    expect(kinds('x | y | z\n1 | 2 | 3')).toContain('table')
    expect(kinds('dy\ndx\n= 3')).toContain('fraction')
  })

  it('flags sub-part markers in the middle of a line and skipped letters', () => {
    expect(kinds('Find the rank. (b) Find the null space.')).toContain('subpart')
    expect(kinds('(a) one\n(c) three')).toContain('subpart')
    expect(kinds('(a) one\n(b) two')).not.toContain('subpart')
  })

  it('flags numbers that are not in the recognised source', () => {
    const risks = findProofreadRisks('Add 4 and 15.', 'Question 1. Add 4 and 5.')
    expect(risks.filter((r) => r.kind === 'number_mismatch').map((r) => r.text)).toEqual(['15'])
  })
})

describe('suggestImageCompare / chunkLowConfidence', () => {
  it('asks for the original page for matrices, tables, fractions or extractor flags', () => {
    expect(suggestImageCompare(findProofreadRisks('1 2\n3 4'))).toBe(true)
    expect(suggestImageCompare(findProofreadRisks('x – 1'))).toBe(false)
    expect(suggestImageCompare([], true)).toBe(true)
    expect(chunkLowConfidence({ lowConfidence: true })).toBe(true)
    expect(chunkLowConfidence({ confidence: 0.3 })).toBe(true)
    expect(chunkLowConfidence({ uncertainRegions: [{}] })).toBe(true)
    expect(chunkLowConfidence({ text: 'x' })).toBe(false)
  })
})

describe('classifyEdit', () => {
  it('names the kind of correction', () => {
    expect(classifyEdit('prompt', 'x – 3', 'x - 3')).toContain('minus_sign')
    expect(classifyEdit('prompt', 'm/s2', 'm/s^2')).toEqual(['exponent'])
    expect(classifyEdit('prompt', 'x1 + x2', 'x_1 + x_2')).toEqual(['subscript'])
    expect(classifyEdit('prompt', '1 2', '\\frac{1}{2}')).toContain('fraction')
    expect(classifyEdit('prompt', '(a) one (b) two', '(a) one\n(b) two\n(c) three')).toContain(
      'subpart_boundary',
    )
    expect(classifyEdit('number', '2', '3')).toEqual(['label'])
    expect(classifyEdit('prompt', 'cat', 'dog')).toEqual(['other'])
    expect(classifyEdit('prompt', 'same', 'same')).toEqual([])
  })
})

describe('sub-part boundaries', () => {
  it('splits at the cursor and relabels the later parts', () => {
    const prompt = 'Let A be a matrix.\n(a) Find rank A.\n(b) Find det A.'
    const at = prompt.indexOf('det A')
    // Splitting the stem: the new part becomes (a), the old ones shift.
    const stem = insertSubpartBoundary(prompt, prompt.indexOf('a matrix'))
    expect(subpartLabels(stem)).toEqual(['a', 'b', 'c'])
    expect(stem).toContain('(a) a matrix.')
    const mid = insertSubpartBoundary(prompt, at)
    expect(subpartLabels(mid)).toEqual(['a', 'b', 'c'])
    expect(mid).toContain('(c) det A.')
  })

  it('merges a part into the previous and relabels', () => {
    const prompt = 'Stem.\n(a) one\n(b) two\n(c) three'
    const merged = mergeSubpart(prompt, 'b')
    expect(subpartLabels(merged)).toEqual(['a', 'b'])
    expect(merged).toContain('(a) one two')
    expect(merged).toContain('(b) three')
  })
})

describe('helpers', () => {
  it('compares texts and numbers', () => {
    expect(textSimilarity('Add 4 and 5', 'Add 4 and 5')).toBe(1)
    expect(textSimilarity('Add 4 and 5', 'Multiply 6 by 7')).toBeLessThan(0.5)
    expect(normalizeQuestionNumber('Problem 2(a)')).toBe(normalizeQuestionNumber('2 (a)'))
    expect(normalizeQuestionNumber('2')).not.toBe(normalizeQuestionNumber('3'))
  })

  it('keeps a corrected professor answer when the link is to the same original', () => {
    const question = {
      answerText: 'x = -2',
      edits: [
        {
          at: 1,
          by: 'student' as const,
          field: 'answerText' as const,
          before: 'x = –2',
          after: 'x = -2',
          kinds: [],
        },
      ],
    }
    expect(proofreadAnswerText(question, 'x = –2')).toBe('x = -2')
    expect(proofreadAnswerText(question, 'something else')).toBeUndefined()
  })
})

describe('reconfirmItems', () => {
  const base: HomeworkQuestion = {
    id: 'q1',
    projectId: 'p',
    setId: 's',
    documentId: 'd',
    documentName: 'hw',
    order: 0,
    prompt: 'Q',
    sourceRefs: [],
    hints: ['h'],
    solution: 'sol',
    generationStatus: 'ready',
    promptVersion: 'v',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }

  it('lists nothing for a question never edited', () => {
    expect(reconfirmItems(base)).toEqual([])
  })

  it('lists everything made before the last edit', () => {
    const question: HomeworkQuestion = {
      ...base,
      contentAt: 50,
      answerLinkStale: true,
      edits: [
        { at: 100, by: 'student', field: 'prompt', before: 'Q', after: 'Q2', kinds: ['other'] },
      ],
      reviewGuide: { createdAt: 60 } as HomeworkQuestion['reviewGuide'],
      answerCheck: { createdAt: 200 } as HomeworkQuestion['answerCheck'],
    }
    const section = {
      status: 'ready',
      generatedAt: 90,
      guided: {},
      professorCompare: { comparedAt: 95 },
    } as unknown as WalkthroughSection
    expect(reconfirmItems(question, { section, practiceSetsCreatedAt: [80] })).toEqual([
      'answer_link',
      'hints',
      'walkthrough',
      'guided',
      'compare',
      'review',
      'practice',
    ])
    // Regenerated after the edit: nothing left.
    expect(
      reconfirmItems(
        { ...question, contentAt: 150, answerLinkStale: undefined, reviewGuide: undefined },
        {
          section: {
            ...section,
            generatedAt: 150,
            professorCompare: { comparedAt: 160 },
          } as WalkthroughSection,
          practiceSetsCreatedAt: [150],
        },
      ),
    ).toEqual([])
  })
})
