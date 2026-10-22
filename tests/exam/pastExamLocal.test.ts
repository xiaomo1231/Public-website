import { describe, expect, it } from 'vitest'
import { isReferenceOnlyMaterial } from '@/entities/document/types'
import { detectExamMinutes, findFormulaSheet, looksLikePastExam } from '@/entities/exam/paper'
import { markingSchemeLines, marksIn, parseQuestionMarks } from '@/entities/exam/marks'
import { analyzePastExams, classifyExamQuestion } from '@/entities/exam/analysis'
import { resultFromCheck, scoreMockExam } from '@/entities/exam/scoring'
import { formatRemaining } from '@/widgets/exam/time'

describe('past exam: material role and file names', () => {
  it('is reference-only material', () => {
    expect(isReferenceOnlyMaterial('past_exam')).toBe(true)
  })

  it('suggests the role from typical past-paper names, not answer keys or syllabi', () => {
    for (const name of [
      'MATH101 Midterm 2023.pdf',
      'final exam 2022.pdf',
      'f26t1.pdf',
      'Test 2.docx',
      '2021期末试卷.pdf',
      '高数期中.pdf',
      'mock paper.pdf',
    ])
      expect(looksLikePastExam(name), name).toBe(true)
    for (const name of [
      'midterm solutions.pdf',
      'final answer key.pdf',
      'Exam topics syllabus.pdf',
      '期末答案.pdf',
      'lecture 3.pdf',
      'contest.pdf',
    ])
      expect(looksLikePastExam(name), name).toBe(false)
  })
})

describe('past exam: time allowed', () => {
  it('reads the stated time', () => {
    expect(detectExamMinutes('MATH 101\nTime allowed: 2 hours\nAnswer all questions')).toBe(120)
    expect(detectExamMinutes('Duration: 90 minutes')).toBe(90)
    expect(detectExamMinutes('Time allowed: 1 hour 30 minutes')).toBe(90)
    expect(detectExamMinutes('考试时间：120分钟')).toBe(120)
    expect(detectExamMinutes('Time allowed: two hours')).toBe(120)
  })

  it('ignores times that are not the exam duration', () => {
    expect(detectExamMinutes('A car drives for 2 hours at 60 km/h.')).toBeUndefined()
    expect(detectExamMinutes('Question 1 (10 marks)')).toBeUndefined()
  })
})

describe('past exam: marks printed on the paper', () => {
  it('reads common mark notations', () => {
    expect(marksIn('Find x. (10 marks)')).toEqual([10])
    expect(marksIn('State the law. [3]')).toEqual([3])
    expect(marksIn('求极限。（5分）')).toEqual([5])
    expect(marksIn('Explain. [2 marks]')).toEqual([2])
    expect(marksIn('Compute 3 + [4] in the array.')).toEqual([])
  })

  it('gives marks per sub-part and sums them', () => {
    const marks = parseQuestionMarks('A ball is thrown.\n(a) Find v. [3]\n(b) Find h. [4]')
    expect(marks.parts).toEqual([
      { label: 'a', marks: 3 },
      { label: 'b', marks: 4 },
    ])
    expect(marks.total).toBe(7)
  })

  it('prefers a total stated for the whole question', () => {
    const marks = parseQuestionMarks('Question 2 (10 marks)\n(a) Find v. [3]\n(b) Find h.')
    expect(marks.total).toBe(10)
    expect(marks.parts).toEqual([{ label: 'a', marks: 3 }])
  })

  it('states nothing when the paper states nothing', () => {
    expect(parseQuestionMarks('Find the derivative of x^2.')).toEqual({ parts: [] })
  })

  it('reads the professor marking scheme lines verbatim', () => {
    const lines = markingSchemeLines('v = u + at M1\nv = 12 m/s A1\nTherefore the ball rises.')
    expect(lines).toEqual(['v = u + at M1', 'v = 12 m/s A1'])
    expect(markingSchemeLines('x = 3')).toEqual([])
  })
})

describe('past exam: formula / data sheet', () => {
  const chunk = (id: string, order: number, text: string, pageNumber?: number) => ({
    id,
    order,
    text,
    ...(pageNumber !== undefined ? { pageNumber } : {}),
  })

  it('finds a headed sheet and the rest of its page', () => {
    const sheet = findFormulaSheet([
      chunk('c1', 0, 'Question 1. Find v.', 1),
      chunk('c2', 1, 'Formula sheet\nv = u + at', 4),
      chunk('c3', 2, 's = ut + 1/2 at^2', 4),
    ])
    expect(sheet?.pages).toEqual([4])
    expect(sheet?.chunkIds).toEqual(['c2', 'c3'])
    expect(sheet?.text).toContain('s = ut')
  })

  it('finds a header block of bare equations before the first question', () => {
    const sheet = findFormulaSheet([
      chunk('c1', 0, 'v = u + at\ns = ut + at^2/2', 1),
      chunk('c2', 1, 'F = ma\nW = Fd', 1),
      chunk('c3', 2, '1. A car accelerates.', 1),
    ])
    expect(sheet?.chunkIds).toEqual(['c1', 'c2'])
  })

  it('returns null without a sheet', () => {
    expect(findFormulaSheet([chunk('c1', 0, '1. Find x = ?', 1)])).toBeNull()
  })
})

describe('past exam: types and coverage (local, no prediction)', () => {
  it('classifies question kinds', () => {
    expect(classifyExamQuestion('Which is a vector?\nA. mass\nB. force\nC. time\nD. energy')).toBe(
      'multiple_choice',
    )
    expect(classifyExamQuestion('Prove that the sum is finite.')).toBe('proof')
    expect(classifyExamQuestion('Calculate the work done.')).toBe('calculation')
    expect(classifyExamQuestion('Explain why the sky is blue.')).toBe('explain')
    expect(classifyExamQuestion('True or false: 2 is prime.')).toBe('true_false')
    expect(classifyExamQuestion('判断：所有矩阵都可逆。')).toBe('true_false')
  })

  it('sums marks per topic and reports exam-scope coverage', () => {
    const analysis = analyzePastExams({
      papers: [
        {
          setId: 's1',
          title: 'Midterm',
          questions: [
            { id: 'q1', setId: 's1', prompt: 'Calculate the derivative of x^2. (6 marks)' },
            { id: 'q2', setId: 's1', prompt: 'Evaluate the integral of x. (4 marks)' },
            { id: 'q3', setId: 's1', prompt: 'Describe the history of Rome. (2 marks)' },
          ],
        },
      ],
      topics: [
        { id: 't1', name: 'Derivative', description: 'derivatives of functions' },
        { id: 't2', name: 'Integral', description: 'integrals' },
      ],
      scopes: [
        {
          id: 'sc',
          label: 'Final',
          kind: 'final',
          topics: [
            { id: 'e1', text: 'Derivatives', order: 0, source: 'local', topicIds: ['t1'] },
            { id: 'e2', text: 'Series', order: 1, source: 'local' },
          ],
        },
      ],
    })
    expect(analysis.questions).toBe(3)
    expect(analysis.totalMarks).toBe(12)
    expect(analysis.byTopic.map((row) => [row.topicId, row.marks])).toEqual([
      ['t1', 6],
      ['t2', 4],
    ])
    expect(analysis.unmatched).toEqual({ questions: 1, marks: 2 })
    expect(analysis.scopes[0]!.covered.map((item) => item.id)).toEqual(['e1'])
    expect(analysis.scopes[0]!.notSeen.map((item) => item.id)).toEqual(['e2'])
  })
})

describe('mock exam: platform estimates', () => {
  it('turns checks into estimated marks, never more than the paper states', () => {
    expect(
      resultFromCheck('q', 10, {
        verdict: 'partial',
        similarityPercent: 64,
        method: 'ai',
        feedback: '',
      }),
    ).toMatchObject({ status: 'checked', estimatedMarks: 6.5, fraction: 0.64 })
    expect(
      resultFromCheck('q', 4, { verdict: 'uncertain', method: 'ai', feedback: 'unclear' }),
    ).toMatchObject({ status: 'uncertain', marks: 4 })
  })

  it('scores the paper and leaves undecided questions out', () => {
    const score = scoreMockExam([
      {
        questionId: 'a',
        status: 'checked',
        verdict: 'correct',
        method: 'local',
        fraction: 1,
        marks: 4,
        estimatedMarks: 4,
      },
      { questionId: 'b', status: 'unanswered', fraction: 0, marks: 6, estimatedMarks: 0 },
      { questionId: 'c', status: 'uncertain', marks: 5 },
    ])
    expect(score.marks).toEqual({ estimated: 4, available: 10, undecidedMarks: 5 })
    expect(score.undecided).toBe(1)
    expect(score.aiChecked).toBe(false)
    expect(score.fraction).toBe(0.5)
  })

  it('reports a percentage when the paper states no marks', () => {
    const score = scoreMockExam([
      { questionId: 'a', status: 'checked', verdict: 'partial', method: 'ai', fraction: 0.5 },
    ])
    expect(score.marks).toBeUndefined()
    expect(score.fraction).toBe(0.5)
    expect(score.aiChecked).toBe(true)
  })

  it('formats the countdown', () => {
    expect(formatRemaining(65_000)).toBe('1:05')
    expect(formatRemaining(3_725_000)).toBe('1:02:05')
    expect(formatRemaining(-5)).toBe('0:00')
  })
})
