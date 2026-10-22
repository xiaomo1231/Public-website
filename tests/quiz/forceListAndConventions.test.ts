import { beforeEach, describe, expect, it } from 'vitest'
import {
  decodeForceRows,
  encodeForceRows,
  gradeForceList,
  readForceDirection,
  type ForceSpec,
} from '@/entities/question/forceList'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'
import { isNoneOption, shuffledOptions } from '@/shared/lib/shuffle'
import { professorConventions, type QuestionHabitsProfile } from '@/entities/questionHabits/types'
import { setUILanguage } from '@/i18n'

const block: ForceSpec[] = [
  { type: 'gravity', angle: 270, magnitude: 49 },
  { type: 'normal', angle: 90 },
  { type: 'friction', angle: 180 },
  { type: 'applied', angle: 30 },
]

describe('free-body diagram answers', () => {
  it('reads directions in several forms', () => {
    expect(readForceDirection('up')).toBe(90)
    expect(readForceDirection('向下')).toBe(270)
    expect(readForceDirection('-x')).toBe(180)
    expect(readForceDirection('30')).toBe(30)
    expect(readForceDirection('30° above +x')).toBe(30)
    expect(readForceDirection('nonsense')).toBeNull()
  })

  it('round-trips the stored rows', () => {
    const rows = [
      { type: 'gravity', direction: 'down', magnitude: '49' },
      { type: 'normal', direction: 'up', magnitude: '' },
    ]
    expect(decodeForceRows(encodeForceRows(rows))).toEqual(rows)
  })

  it('matches by type and direction within 10°, reporting missing / extra / wrong', () => {
    const answer = encodeForceRows([
      { type: 'gravity', direction: 'down', magnitude: '49' },
      { type: 'normal', direction: 'up', magnitude: '' },
      { type: 'applied', direction: '35', magnitude: '' },
      { type: 'tension', direction: 'left', magnitude: '' },
    ])
    const result = gradeForceList(answer, block)
    expect(result.matched).toEqual(['gravity', 'normal', 'applied'])
    expect(result.missing).toEqual(['friction'])
    expect(result.extra).toEqual(['tension'])
  })

  it('a force pointing the wrong way and a wrong magnitude are named', () => {
    const answer = encodeForceRows([
      { type: 'gravity', direction: 'down', magnitude: '20' },
      { type: 'normal', direction: 'down', magnitude: '' },
    ])
    const result = gradeForceList(answer, block.slice(0, 2))
    expect(result.wrongMagnitude).toEqual(['gravity'])
    expect(result.wrongDirection).toEqual(['normal'])
  })

  it('grades a question with partial credit', () => {
    setUILanguage('zh-CN')
    const question: Question = {
      id: 'f1',
      projectId: 'p',
      knowledgePoint: 'FBD',
      type: 'force_list',
      difficulty: 'basic',
      prompt: 'List the forces on the block.',
      correctAnswer: '',
      forces: block,
      hints: [],
      sourceRefs: [],
      promptVersion: 'v9',
      createdAt: 0,
    }
    const result = evaluateDeterministic(
      question,
      encodeForceRows([
        { type: 'gravity', direction: 'down', magnitude: '' },
        { type: 'normal', direction: 'up', magnitude: '' },
      ]),
    )
    expect(result.isCorrect).toBe(false)
    expect(result.score).toEqual({ earned: 2, total: 4 })
    expect(result.note).toContain('漏了')
  })
})

describe('a final "None of the options are correct" choice', () => {
  it('is recognised in English and Chinese', () => {
    expect(isNoneOption('None of the options are correct')).toBe(true)
    expect(isNoneOption('none of the above')).toBe(true)
    expect(isNoneOption('以上都不对')).toBe(true)
    expect(isNoneOption('Nonane')).toBe(false)
  })

  it('stays last when the options are shuffled', () => {
    const options = ['A1', 'B2', 'C3', 'D4', 'E5', 'None of the options are correct'].map(
      (label, i) => ({ label, isCorrect: i === 5 }),
    )
    for (let seed = 0; seed < 20; seed++) {
      let state = seed + 1
      const random = () => {
        state = (state * 16807) % 2147483647
        return state / 2147483647
      }
      const out = shuffledOptions(options, random)
      expect(out.at(-1)!.label).toBe('None of the options are correct')
      expect(out).toHaveLength(6)
    }
  })
})

describe('professor conventions from the habits profile', () => {
  beforeEach(() => setUILanguage('en'))
  const item = (category: string, statement: string, quote = 'x') => ({
    id: category,
    category: category as never,
    statement,
    evidence: [{ documentId: 'd', quote }],
    createdAt: 0,
    updatedAt: 0,
  })

  it('reads conventions and the professor wording of the final option', () => {
    const profile: QuestionHabitsProfile = {
      items: [
        item(
          'options',
          'Every multiple-choice question has six options; F is always "None of the options are correct".',
          'E. 2.4 g F. None of the options are correct',
        ),
        item('marks', 'Each sub-part shows its marks, e.g. (3 marks).'),
        item('sig_figs', 'Marks are deducted for wrong significant figures.'),
        item('data_sheet', 'Molar masses are taken from the data sheet.'),
        item('context', 'Questions tell a short lab story with extra details.'),
      ],
      sources: [],
      updatedAt: 0,
    }
    expect(professorConventions(profile)).toEqual({
      conventions: ['none_of_above', 'marks_per_part', 'data_sheet', 'context_story', 'sig_figs'],
      noneOptionLabel: 'None of the options are correct',
    })
  })

  it('nothing when the profile is off or empty', () => {
    expect(professorConventions(undefined)).toEqual({ conventions: [] })
    expect(
      professorConventions({
        items: [item('marks', 'Marks shown.')],
        sources: [],
        enabled: false,
        updatedAt: 0,
      }),
    ).toEqual({ conventions: [] })
  })
})
