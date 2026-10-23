import { describe, expect, it } from 'vitest'
import { markingSchemeLines, parseRubricItems } from '@/entities/exam/marks'
import { buildUserPrompt } from '@/infrastructure/ai/prompts/homework-answer-check/v1'

// Synthetic answer-key text in the shape of a printed rubric box.
const KEY = [
  '(b) (4 points) Explain who bears more of the tax.',
  'Demand is less elastic, so buyers bear more.',
  '2 pts: Links tax incidence to the elasticities',
  'of demand and supply',
  '2 pts: Larger burden on buyers.',
  '(c) (8 points) Draw the market before and after.',
  '3 pts: Explains the direction of change in P and Q,',
  'even when the direction is wrong but the logic holds.',
  'Graph',
  '1 pt: Axes and curve labels',
  '2 pts: Rightward shift of S',
  '2 pts: Lower P and higher Q',
].join('\n')

describe('professor rubric boxes', () => {
  it('reads each item with its points, joins wrapped lines and keeps sub-headings', () => {
    expect(parseRubricItems(KEY)).toEqual([
      { points: 2, text: 'Links tax incidence to the elasticities of demand and supply' },
      { points: 2, text: 'Larger burden on buyers.' },
      {
        points: 3,
        text: 'Explains the direction of change in P and Q, even when the direction is wrong but the logic holds.',
      },
      { points: 1, text: 'Axes and curve labels', group: 'Graph' },
      { points: 2, text: 'Rightward shift of S', group: 'Graph' },
      { points: 2, text: 'Lower P and higher Q', group: 'Graph' },
    ])
  })

  it('is the professor marking scheme shown with mock-exam results', () => {
    expect(markingSchemeLines(KEY)).toContain('Graph · 2 pts: Rightward shift of S')
    expect(markingSchemeLines(KEY)[0]).toBe(
      '2 pts: Links tax incidence to the elasticities of demand and supply',
    )
    // Keys without a box keep the old line-based reading.
    expect(markingSchemeLines('x = 2 [2 marks]\nso y = 3')).toEqual(['x = 2 [2 marks]'])
  })

  it('reaches the answer-check prompt only when a box exists', () => {
    const base = {
      question: 'Q',
      studentAnswer: 'S',
      referenceAnswer: 'R',
      referenceKind: 'professor' as const,
      sourceText: '',
      language: 'en' as const,
    }
    expect(buildUserPrompt({ ...base, markingScheme: [] })).toBe(buildUserPrompt(base))
    const withBox = buildUserPrompt({ ...base, markingScheme: ['2 pts: Rightward shift of S'] })
    expect(withBox).toContain('PROFESSOR MARKING SCHEME')
    expect(withBox).toContain('- 2 pts: Rightward shift of S')
  })
})
