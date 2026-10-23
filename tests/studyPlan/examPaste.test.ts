import { describe, expect, it } from 'vitest'
import {
  appearsVerbatim,
  checkExtractedExams,
  findDuplicate,
  inferYear,
  isRealDate,
  matchCourse,
  parseExamPaste,
} from '@/entities/studyPlan/examPaste'

// Friday 23 October 2026, 10:00 local.
const NOW = new Date(2026, 9, 23, 10).getTime()
const COURSES = [
  { id: 'econ', name: 'ECON 110 Principles of Economics' },
  { id: 'math', name: 'MATH 101 Calculus I' },
  { id: 'la', name: '线性代数' },
]

function one(text: string, options: Parameters<typeof parseExamPaste>[1] = {}) {
  const result = parseExamPaste(text, { now: NOW, courses: COURSES, ...options })
  expect(result.exams).toHaveLength(1)
  return { exam: result.exams[0]!, confident: result.confident }
}

describe('粘贴识别 — local parser', () => {
  it('reads an English line with weekday, year and a pm range', () => {
    const { exam, confident } = one('Midterm 1 – Tuesday, Oct 27, 2026, 7:00–8:30 pm')
    expect(exam).toMatchObject({
      name: 'Midterm 1',
      date: '2026-10-27',
      time: '19:00',
      durationMinutes: 90,
      origin: 'local',
    })
    expect(exam.uncertain).toEqual([])
    expect(confident).toBe(true)
  })

  it('reads "Final exam: Dec 12 9am" and infers the year', () => {
    const { exam } = one('Final exam: Dec 12 9am')
    expect(exam).toMatchObject({ name: 'Final exam', date: '2026-12-12', time: '09:00' })
  })

  it('reads a Chinese line with a course code and 上午', () => {
    const { exam } = one('ECON 110 期中考试 10月27日 上午9:00')
    expect(exam).toMatchObject({
      name: '期中考试',
      date: '2026-10-27',
      time: '09:00',
      projectId: 'econ',
      courseText: 'ECON 110',
    })
  })

  it('reads 年月日, 下午 X 点半 and a location', () => {
    const { exam } = one('线性代数 期末考试 2026年12月20日 下午2点半 地点：教学楼A101')
    expect(exam).toMatchObject({
      name: '期末考试',
      date: '2026-12-20',
      time: '14:30',
      location: '教学楼A101',
      projectId: 'la',
    })
  })

  it('accepts a bare date when it is all that was pasted (unsure: no exam word)', () => {
    const result = parseExamPaste('2026/10/27 09:00', { now: NOW, courses: COURSES })
    expect(result.exams[0]).toMatchObject({ date: '2026-10-27', time: '09:00', name: '' })
    expect(result.exams[0]!.uncertain).toContain('no-kind')
    expect(result.confident).toBe(false)
  })

  it('infers the year as the next occurrence from today', () => {
    expect(one('Quiz 2: March 3').exam.date).toBe('2027-03-03')
    expect(one('Quiz 3: Oct 23').exam.date).toBe('2026-10-23')
    expect(inferYear(1, 4, NOW, 1)).toBe(2027) // Monday 4 January 2027
  })

  it('flags a weekday that does not fall on the date', () => {
    const { exam, confident } = one('Midterm: Wednesday, Oct 27, 2026')
    expect(exam.uncertain).toContain('weekday-mismatch')
    expect(confident).toBe(false)
  })

  it('keeps the start of an "11:00–1:00 pm" range in the morning', () => {
    const { exam } = one('Test 3 — Nov 5, 11:00–1:00 pm')
    expect(exam).toMatchObject({ time: '11:00', durationMinutes: 120 })
  })

  it('reads a pasted table and matches courses by code', () => {
    const text = [
      'Course\tExam\tDate\tTime',
      'MATH 101\tMidterm\t10/30\t14:00',
      'MATH 101\tFinal\t12/15/2026\t9:00 AM',
    ].join('\n')
    const result = parseExamPaste(text, { now: NOW, courses: COURSES })
    expect(result.exams.map((e) => [e.name, e.date, e.time, e.projectId])).toEqual([
      ['Midterm', '2026-10-30', '14:00', 'math'],
      ['Final', '2026-12-15', '09:00', 'math'],
    ])
  })

  it('flags a month / day order it cannot be sure of', () => {
    expect(one('Quiz 1: 11/10').exam.uncertain).toContain('ambiguous-date')
    expect(one('Quiz 1: 25/11').exam).toMatchObject({ date: '2026-11-25', uncertain: [] })
  })

  it('reads the European day-first form', () => {
    expect(one('Exam 27.10. 10:00').exam).toMatchObject({ date: '2026-10-27', time: '10:00' })
  })

  it('carries an exam word on its own line to the date below', () => {
    const { exam } = one('Final exam:\nDecember 12, 9am')
    expect(exam).toMatchObject({ name: 'Final exam', date: '2026-12-12', time: '09:00' })
    expect(exam.sourceText).toBe('Final exam:\nDecember 12, 9am')
  })

  it('ignores dated lines that are not exams', () => {
    const result = parseExamPaste('Oct 28: Lecture 12 on eigenvalues\nMidterm: Nov 3', {
      now: NOW,
      courses: COURSES,
    })
    expect(result.exams.map((e) => e.date)).toEqual(['2026-11-03'])
  })

  it('splits several exams on one line by semicolons', () => {
    const result = parseExamPaste('Midterm 1: Oct 27; Midterm 2: Nov 24', { now: NOW })
    expect(result.exams.map((e) => [e.name, e.date])).toEqual([
      ['Midterm 1', '2026-10-27'],
      ['Midterm 2', '2026-11-24'],
    ])
  })

  it('uses the fixed course when none is named', () => {
    expect(one('Quiz: Nov 2', { defaultProjectId: 'math' }).exam.projectId).toBe('math')
  })

  it('matches courses by code, by name, and leaves a tie unmatched', () => {
    expect(matchCourse('ECON-110 midterm', COURSES).projectId).toBe('econ')
    expect(matchCourse('Calculus midterm', COURSES).projectId).toBe('math')
    expect(matchCourse('PHYS 200 final', COURSES)).toEqual({ courseText: 'PHYS 200' })
    const twins = [
      { id: 'a', name: 'Biology' },
      { id: 'b', name: 'Biology' },
    ]
    expect(matchCourse('Biology exam', twins).projectId).toBeUndefined()
  })

  it('flags drafts that repeat a saved exam', () => {
    const saved = [
      { id: 'x', projectId: 'econ', name: 'Midterm 1', at: new Date(2026, 9, 27, 19).getTime() },
    ]
    expect(
      findDuplicate({ projectId: 'econ', name: 'midterm 1', date: '2026-10-27', time: '' }, saved)
        ?.id,
    ).toBe('x')
    expect(
      findDuplicate({ projectId: 'econ', name: 'Quiz', date: '2026-10-27', time: '19:00' }, saved)
        ?.id,
    ).toBe('x')
    expect(
      findDuplicate({ projectId: 'math', name: 'Midterm 1', date: '2026-10-27', time: '' }, saved),
    ).toBeUndefined()
  })
})

describe('粘贴识别 — checking an AI reply', () => {
  const text = 'Our MATH 101 midterm will be held on Thursday 5 Nov at 2pm in Hall B.'

  it('keeps exams whose source text is in the paste and drops the rest', () => {
    const { exams, dropped } = checkExtractedExams(
      {
        exams: [
          {
            course: 'MATH 101',
            name: 'Midterm',
            date: '2026-11-05',
            time: '14:00',
            sourceText: 'midterm will be held on Thursday 5 Nov at 2pm',
          },
          { name: 'Final', date: '2026-12-10', time: '09:00', sourceText: 'Final on Dec 10' },
          { name: 'Quiz', date: '2026-02-30', sourceText: 'Our MATH 101 midterm' },
          // The date read does not agree with the quoted text.
          { name: 'Midterm', date: '2026-11-06', sourceText: 'held on Thursday 5 Nov' },
        ],
      },
      { now: NOW, courses: COURSES, text },
    )
    expect(exams).toHaveLength(1)
    expect(exams[0]).toMatchObject({
      name: 'Midterm',
      date: '2026-11-05',
      time: '14:00',
      projectId: 'math',
      origin: 'ai',
    })
    expect(dropped).toBe(3)
  })

  it('fills in the year of a MM-DD date and ignores a malformed time', () => {
    const { exams } = checkExtractedExams(
      { exams: [{ name: 'Quiz', date: '03-03', time: '25:00', sourceText: 'Quiz on March 3' }] },
      { now: NOW, text: 'Quiz on March 3' },
    )
    expect(exams[0]).toMatchObject({ date: '2027-03-03', time: '' })
  })

  it('reads an image reply without text, still checking the quoted date', () => {
    const { exams, dropped } = checkExtractedExams(
      {
        exams: [
          {
            name: 'Final',
            date: '2026-12-12',
            time: '09:00',
            sourceText: 'Final Exam Dec 12 9:00',
          },
          { name: 'Final', date: '2026-12-13', sourceText: 'Final Exam Dec 12' },
        ],
      },
      { now: NOW },
    )
    expect(exams.map((e) => e.date)).toEqual(['2026-12-12'])
    expect(dropped).toBe(1)
  })

  it('checks quotes ignoring whitespace only', () => {
    expect(appearsVerbatim('held  on\nThursday', 'it is held on Thursday')).toBe(true)
    expect(appearsVerbatim('held on Friday', 'it is held on Thursday')).toBe(false)
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2026-02-29')).toBe(false)
  })
})
