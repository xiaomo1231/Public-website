import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  FINAL_DAYS,
  learnMinutes,
  type ScheduleInput,
  type SchedulerExam,
  type SchedulerTopic,
} from '@/entities/studyPlan/scheduler'
import { addDays, daysBetween, minutesOn } from '@/entities/studyPlan/calendar'
import { DEFAULT_CALENDAR, type StudyCalendar, type StudyTask } from '@/entities/studyPlan/types'
import { pinnedMinutes, reconcileTasks, topicProgress } from '@/entities/studyPlan/tasks'
import { suggestWeights } from '@/entities/studyPlan/weights'

// 2026-11-02 is a Monday.
const TODAY = '2026-11-02'

function topic(
  id: string,
  mastery: number | null,
  extra: Partial<SchedulerTopic> = {},
): SchedulerTopic {
  return { id, name: id.toUpperCase(), mastery, openMistakes: 0, ...extra }
}

function exam(extra: Partial<SchedulerExam> = {}): SchedulerExam {
  return {
    id: 'e1',
    projectId: 'p1',
    name: 'Midterm',
    date: addDays(TODAY, 21),
    weight: 100,
    topics: [],
    mocks: [],
    sets: [],
    mistakesDue: 0,
    openMistakes: 0,
    cardsDue: 0,
    ...extra,
  }
}

function input(exams: SchedulerExam[], calendar: StudyCalendar = DEFAULT_CALENDAR): ScheduleInput {
  return { today: TODAY, calendar, exams }
}

const tasksOf = (result: ReturnType<typeof buildSchedule>) => result.days.flatMap((d) => d.tasks)

describe('study scheduler', () => {
  it('never puts more minutes on a day than the calendar gives', () => {
    const topics = Array.from({ length: 30 }, (_, i) => topic(`t${i}`, null))
    const result = buildSchedule(
      input([
        exam({
          topics,
          mistakesDue: 6,
          cardsDue: 40,
          mocks: [{ id: 'm', title: 'P', minutes: 90 }],
        }),
      ]),
    )
    for (const day of result.days) {
      const used = day.tasks.reduce((sum, task) => sum + task.minutes, 0)
      expect(used).toBeLessThanOrEqual(day.available)
      expect(used).toBe(day.used)
    }
  })

  it('follows day types: class days, weekends, holidays and days off', () => {
    const calendar: StudyCalendar = {
      ...DEFAULT_CALENDAR,
      minutes: { class: 60, weekend: 200, holiday: 120, off: 0 },
      overrides: {
        [addDays(TODAY, 1)]: { type: 'off' },
        [addDays(TODAY, 2)]: { type: 'holiday' },
        [addDays(TODAY, 3)]: { type: 'class', minutes: 30 },
      },
    }
    expect(minutesOn(calendar, TODAY)).toBe(60)
    expect(minutesOn(calendar, addDays(TODAY, 1))).toBe(0)
    expect(minutesOn(calendar, addDays(TODAY, 2))).toBe(120)
    expect(minutesOn(calendar, addDays(TODAY, 3))).toBe(30)
    expect(minutesOn(calendar, addDays(TODAY, 5))).toBe(200) // Saturday
    const topics = Array.from({ length: 12 }, (_, i) => topic(`t${i}`, null))
    const result = buildSchedule(input([exam({ topics })], calendar))
    const off = result.days.find((day) => day.date === addDays(TODAY, 1))!
    expect(off.tasks).toEqual([])
    const holiday = result.days.find((day) => day.date === addDays(TODAY, 2))!
    expect(holiday.used).toBeGreaterThan(60)
  })

  it('teaches the weakest topics first and skips confirmed mastered ones', () => {
    const topics = [
      topic('strong', 0.9),
      topic('weak', 0.2),
      topic('mid', 0.6),
      topic('mastered', 0.95, { confirmed: true }),
    ]
    const roomy: StudyCalendar = {
      ...DEFAULT_CALENDAR,
      minutes: { class: 240, weekend: 240, holiday: 240, off: 0 },
    }
    const result = buildSchedule(input([exam({ topics })], roomy))
    const learn = tasksOf(result).filter((task) => task.kind === 'learn')
    expect(learn.map((task) => task.topicId)).toEqual(['weak', 'mid', 'strong'])
    expect(learn.some((task) => task.topicId === 'mastered')).toBe(false)
    // A mastered topic only gets an occasional review.
    const mastered = tasksOf(result).filter((task) => task.topicId === 'mastered')
    expect(mastered.length).toBeLessThanOrEqual(1)
    expect(mastered.every((task) => task.kind === 'review')).toBe(true)
  })

  it('weights marks share and open mistakes into the order', () => {
    const topics = [
      topic('few-marks', 0.5, { marksShare: 0.1 }),
      topic('many-marks', 0.5, { marksShare: 0.9 }),
      topic('mistakes', 0.5, { marksShare: 0.0, openMistakes: 5 }),
    ]
    const learn = tasksOf(buildSchedule(input([exam({ topics })]))).filter(
      (t) => t.kind === 'learn',
    )
    expect(learn[0]!.topicId).toBe('many-marks')
    expect(learn.findIndex((t) => t.topicId === 'mistakes')).toBeLessThan(
      learn.findIndex((t) => t.topicId === 'few-marks'),
    )
  })

  it('reviews each topic +1, +3 and +7 days after its first pass', () => {
    const result = buildSchedule(input([exam({ topics: [topic('only', 0.3)] })]))
    const learn = tasksOf(result).find((task) => task.kind === 'learn')!
    const reviews = tasksOf(result)
      .filter((task) => task.kind === 'review' && task.topicId === 'only')
      .map((task) => daysBetween(learn.date, task.date))
    expect(reviews).toEqual([1, 3, 7])
  })

  it('ends every study day with a short practice block on that day’s topics', () => {
    const topics = Array.from({ length: 8 }, (_, i) => topic(`t${i}`, 0.4))
    const result = buildSchedule(input([exam({ topics })]))
    for (const day of result.days) {
      const topicTasks = day.tasks.filter((task) =>
        ['learn', 'review', 'weak_spots'].includes(task.kind),
      )
      if (topicTasks.length === 0) continue
      const last = day.tasks[day.tasks.length - 1]!
      expect(last.kind).toBe('day_practice')
      expect(last.minutes).toBeGreaterThanOrEqual(5)
      expect(last.minutes).toBeLessThanOrEqual(10)
      expect(last.topicNames?.length).toBeGreaterThan(0)
    }
  })

  it('keeps the final days for weak spots and mistakes only', () => {
    const topics = Array.from({ length: 40 }, (_, i) => topic(`t${i}`, null))
    const ex = exam({ topics, date: addDays(TODAY, 10), openMistakes: 4 })
    const result = buildSchedule(input([ex]))
    const final = result.days.filter((day) => daysBetween(day.date, ex.date) <= FINAL_DAYS)
    expect(final.length).toBe(FINAL_DAYS)
    for (const day of final) {
      expect(day.tasks.some((task) => task.kind === 'learn')).toBe(false)
      expect(day.tasks.some((task) => task.kind === 'weak_spots')).toBe(true)
      expect(day.tasks.some((task) => task.kind === 'mistakes')).toBe(true)
    }
  })

  it('reports what does not fit, with trade-offs', () => {
    const topics = Array.from({ length: 40 }, (_, i) => topic(`t${i}`, 0.75))
    const calendar: StudyCalendar = {
      ...DEFAULT_CALENDAR,
      minutes: { class: 30, weekend: 30, holiday: 30, off: 0 },
      weekly: ['off', 'class', 'class', 'class', 'class', 'class', 'weekend'],
    }
    const result = buildSchedule(input([exam({ topics, date: addDays(TODAY, 9) })], calendar))
    expect(result.dropped.length).toBeGreaterThan(0)
    expect(result.droppedMinutes).toBe(result.dropped.reduce((s, d) => s + d.minutes, 0))
    const kinds = result.suggestions.map((s) => s.kind)
    expect(kinds).toContain('add_minutes')
    expect(kinds).toContain('use_off_days')
    expect(kinds).toContain('skip_mastered')
  })

  it('places professor mock papers near T−14 and T−7 and an AI mock slot after them', () => {
    const ex = exam({
      date: addDays(TODAY, 20),
      topics: [topic('a', 0.5)],
      mocks: [
        { id: 'p1', title: '2024', minutes: 90 },
        { id: 'p2', title: '2025', minutes: 90 },
      ],
      aiMockSlot: true,
    })
    const tasks = tasksOf(buildSchedule(input([ex])))
    const mocks = tasks.filter((task) => task.kind === 'mock')
    expect(mocks.map((task) => task.refId)).toEqual(['p1', 'p2'])
    const offsets = mocks.map((task) => daysBetween(task.date, ex.date))
    expect(Math.abs(offsets[0]! - 14)).toBeLessThanOrEqual(3)
    expect(Math.abs(offsets[1]! - 7)).toBeLessThanOrEqual(3)
    const ai = tasks.find((task) => task.kind === 'ai_mock')!
    expect(daysBetween(ai.date, ex.date)).toBeLessThan(offsets[1]!)
  })

  it('rolls unfinished work forward: a topic not learned yesterday is planned again', () => {
    const ex = exam({ topics: [topic('a', 0.2), topic('b', 0.3)] })
    const first = buildSchedule(input([ex]))
    const firstLearn = tasksOf(first).filter((task) => task.kind === 'learn')
    expect(firstLearn[0]!.date).toBe(TODAY)
    // Next day: nothing was marked done, re-plan from tomorrow.
    const tomorrow = addDays(TODAY, 1)
    const again = buildSchedule({ ...input([ex]), today: tomorrow })
    const learn = tasksOf(again).filter((task) => task.kind === 'learn')
    expect(learn.map((task) => task.topicId).sort()).toEqual(['a', 'b'])
    expect(learn[0]!.date).toBe(tomorrow)
  })

  it('reconciles: keeps done and pinned tasks, replaces the rest', () => {
    const now = new Date(2026, 10, 3, 12).getTime()
    const today = '2026-11-03'
    const base = {
      projectId: 'p1',
      examId: 'e1',
      minutes: 30,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const existing: StudyTask[] = [
      {
        ...base,
        id: 'done',
        date: '2026-11-02',
        kind: 'learn',
        topicId: 'a',
        status: 'done',
        doneAt: now - 86_400_000,
      },
      { ...base, id: 'old', date: '2026-11-02', kind: 'learn', topicId: 'b', status: 'pending' },
      {
        ...base,
        id: 'pinned',
        date: '2026-11-05',
        kind: 'learn',
        topicId: 'c',
        status: 'pending',
        pinned: true,
      },
      {
        ...base,
        id: 'future',
        date: '2026-11-04',
        kind: 'review',
        topicId: 'a',
        status: 'pending',
      },
    ]
    const drafts = [
      {
        examId: 'e1',
        projectId: 'p1',
        date: today,
        kind: 'learn' as const,
        topicId: 'b',
        minutes: 30,
        order: 0,
      },
      {
        examId: 'e1',
        projectId: 'p1',
        date: today,
        kind: 'learn' as const,
        topicId: 'c',
        minutes: 30,
        order: 1,
      },
    ]
    const result = reconcileTasks(existing, drafts, today, now, () => 'new')
    expect(result.removeIds.sort()).toEqual(['future', 'old'])
    // The pinned topic is not planned twice.
    expect(result.add.map((task) => task.topicId)).toEqual(['b'])
    expect(pinnedMinutes(existing, today)).toEqual([{ date: '2026-11-05', minutes: 30 }])
    const progress = topicProgress(existing, 'e1')
    expect(progress.get('a')?.learnedOn).toBe('2026-11-02')
  })

  it('re-weights after a mock exam: a weak result raises that exam’s share and keeps first passes weak-first', () => {
    const before = suggestWeights([
      { examId: 'a', daysLeft: 14, difficulty: 0.5, mastery: 0.6, topicCount: 10 },
      { examId: 'b', daysLeft: 14, difficulty: 0.5, mastery: 0.6, topicCount: 10 },
    ])
    expect(before[0]!.share).toBe(before[1]!.share)
    const after = suggestWeights([
      { examId: 'a', daysLeft: 14, difficulty: 0.5, mastery: 0.6, topicCount: 10, mockPercent: 30 },
      { examId: 'b', daysLeft: 14, difficulty: 0.5, mastery: 0.6, topicCount: 10, mockPercent: 85 },
    ])
    expect(after[0]!.share).toBeGreaterThan(after[1]!.share)
    // Mastery that dropped after the mock moves a topic up the first-pass queue.
    const ex = exam({ topics: [topic('x', 0.8), topic('y', 0.5)] })
    const order1 = tasksOf(buildSchedule(input([ex]))).filter((t) => t.kind === 'learn')
    expect(order1[0]!.topicId).toBe('y')
    const updated = exam({ topics: [topic('x', 0.2), topic('y', 0.5)] })
    const order2 = tasksOf(buildSchedule(input([updated]))).filter((t) => t.kind === 'learn')
    expect(order2[0]!.topicId).toBe('x')
  })

  it('splits days between exams by weight and gives a closer exam more pull', () => {
    const topics = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => topic(`${prefix}${i}`, null))
    const a = exam({ id: 'a', weight: 75, topics: topics('a'), date: addDays(TODAY, 30) })
    const b = exam({ id: 'b', weight: 25, topics: topics('b'), date: addDays(TODAY, 30) })
    const first = buildSchedule(input([a, b])).days[0]!
    const minutesFor = (id: string) =>
      first.tasks
        .filter((task) => task.examId === id && task.kind === 'learn')
        .reduce((s, t) => s + t.minutes, 0)
    expect(minutesFor('a')).toBeGreaterThan(minutesFor('b'))
  })

  it('learn minutes grow as the mastery estimate falls', () => {
    expect(learnMinutes({ mastery: 0.1 })).toBeGreaterThan(learnMinutes({ mastery: 0.9 }))
    expect(learnMinutes({ mastery: null })).toBe(40)
  })
})
