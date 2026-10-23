import { addDays, dayTypeOf, daysBetween, minutesOn } from './calendar'
import type { DayType, PlanSuggestion, StudyCalendar, StudyTaskKind } from './types'

/**
 * The local study scheduler (no AI). Pure and deterministic: the same inputs
 * always give the same days. It lays out, between today and each exam:
 *
 * - **First pass** of every topic in the exam's scope, weakest first:
 *   priority = marks share × (1 − mastery) + open mistakes + habits emphasis.
 *   Topics already mastered *and* confirmed by enough practice are not
 *   re-taught; they only get an occasional review when time is left.
 * - **Spaced reviews** of each topic +1 / +3 / +7 days after its first pass,
 *   merged with mistake re-tests and review cards that are due.
 * - **Professor mock papers** around T−14 and T−7, then an AI mock slot (T−5).
 * - **Final days** (the last 3 before an exam): weak spots and mistakes only,
 *   no new material.
 * - Every study day ends with a short practice block on that day's topics.
 * - The review files picked for an exam (复习资料) and the topics of its
 *   generated 复习提纲 sit in the first-pass queue among the topics.
 *
 * A day is never filled past its minutes. What does not fit is reported with
 * suggested trade-offs. Exams share each day by their weight (the sliders)
 * scaled up as the exam gets close.
 */

export const REVIEW_OFFSETS = [1, 3, 7] as const
export const FINAL_DAYS = 3
export const MOCK_OFFSETS = [14, 7, 10, 4, 12, 5] as const
export const AI_MOCK_OFFSET = 5
export const AI_MOCK_MINUTES = 45
export const REVIEW_MINUTES = 10
export const LEARN_MIN_MINUTES = 15
export const LEARN_MAX_MINUTES = 60
export const LEARN_BASE_MINUTES = 40
/** Mastery at or above this with enough attempts = confirmed: no first pass. */
export const CONFIRMED_MASTERY = 0.85
export const CONFIRMED_ATTEMPTS = 5
/** Queue priority of a 复习提纲 topic / a picked review file (topics are ~0.5–2). */
export const REVIEW_SHEET_PRIORITY = 0.9
export const REVIEW_MATERIAL_PRIORITY = 0.7

export interface SchedulerTopic {
  id: string
  name: string
  /** Share of past-paper marks (0–1) within the exam; absent = unknown (equal). */
  marksShare?: number
  /** 0–1 estimate; null without practice. */
  mastery: number | null
  openMistakes: number
  /** 0–1 from the professor's question habits. */
  emphasis?: number
  /** Mastered and confirmed by practice: no first pass. */
  confirmed?: boolean
  /** Day the first pass was done. */
  learnedOn?: string
  /** Spaced reviews already done since the first pass. */
  reviewsDone?: number
  /** The student skipped this topic's first pass. */
  skipped?: boolean
}

export interface SchedulerMaterial {
  id: string
  title: string
  minutes: number
  /** Already done (a mock submitted after the plan started, a set finished…). */
  done?: boolean
}

export interface SchedulerExam {
  id: string
  projectId: string
  name: string
  /** Exam day `YYYY-MM-DD`. */
  date: string
  /** Share of study time, 0–100 (the sliders). */
  weight: number
  topics: SchedulerTopic[]
  /** Professor mock / past papers. */
  mocks: SchedulerMaterial[]
  /** Homework and professor practice sets picked as materials. */
  sets: Array<SchedulerMaterial & { kind: 'homework' | 'practice_set' }>
  /** Review files picked as materials (复习资料：文件名 / 文件夹), `id` = document id. */
  reviewDocs?: SchedulerMaterial[]
  /** Topics of the generated 复习提纲 to read (`id` = `review:<examId>:<sectionId>`). */
  reviewSheets?: SchedulerMaterial[]
  /** Plan a slot for an AI mock paper (to generate; see `aiMock`). */
  aiMockSlot?: boolean
  /**
   * The AI 模拟卷 for this exam: a generated paper to take (its set id), or
   * the generate task (`ai-mock:<examId>`). Replaces `aiMockSlot`; nothing is
   * planned once it is `done`.
   */
  aiMock?: SchedulerMaterial
  /** Mistake re-tests due now. */
  mistakesDue: number
  /** Active mistakes in the exam's course. */
  openMistakes: number
  /** Review cards due now. */
  cardsDue: number
  /** Vocabulary words due (language courses). */
  vocabDue?: number
}

/** A task the student pinned to a day (moved by hand): its minutes are taken. */
export interface PinnedTask {
  date: string
  minutes: number
}

export interface ScheduleInput {
  today: string
  calendar: StudyCalendar
  exams: SchedulerExam[]
  pinned?: PinnedTask[]
}

export interface TaskDraft {
  examId: string
  projectId: string
  date: string
  kind: StudyTaskKind
  minutes: number
  topicId?: string
  topicNames?: string[]
  refId?: string
  title?: string
  order: number
}

export interface ScheduledDay {
  date: string
  type: DayType
  /** Minutes the calendar gives (pinned tasks included). */
  available: number
  /** Minutes used by planned tasks (pinned tasks not included). */
  used: number
  pinnedMinutes: number
  tasks: TaskDraft[]
}

export interface DroppedItem {
  examId: string
  kind: StudyTaskKind
  topicId?: string
  refId?: string
  label: string
  minutes: number
}

export interface ScheduleResult {
  days: ScheduledDay[]
  dropped: DroppedItem[]
  droppedMinutes: number
  suggestions: PlanSuggestion[]
}

/** Minutes for the first pass of a topic: more when the mastery estimate is low. */
export function learnMinutes(topic: Pick<SchedulerTopic, 'mastery'>): number {
  const factor = topic.mastery === null ? 1 : 0.6 + 0.8 * (1 - topic.mastery)
  const minutes = Math.round((LEARN_BASE_MINUTES * factor) / 5) * 5
  return Math.max(LEARN_MIN_MINUTES, Math.min(LEARN_MAX_MINUTES, minutes))
}

/** First-pass priority within an exam (higher first). */
export function topicPriority(topic: SchedulerTopic, topicCount: number): number {
  const share = topic.marksShare ?? 1 / Math.max(1, topicCount)
  const weakness = 1 - (topic.mastery ?? 0.5)
  return (
    share * Math.max(1, topicCount) * weakness +
    0.1 * Math.min(5, topic.openMistakes) +
    0.2 * Math.min(1, Math.max(0, topic.emphasis ?? 0))
  )
}

/** End-of-day practice length. */
export function dayPracticeMinutes(available: number): number {
  return available >= 60 ? 10 : 5
}

/** Extra pull of an exam on a day as it gets close. */
function closeness(daysLeft: number): number {
  if (daysLeft <= FINAL_DAYS) return 2
  if (daysLeft <= 7) return 1.4
  return 1
}

interface QueueItem {
  kind: 'learn' | 'homework' | 'practice_set' | 'review_material' | 'review_sheet'
  id: string
  label: string
  minutes: number
  priority: number
}

interface ExamState {
  exam: SchedulerExam
  queue: QueueItem[]
  /** Planned spaced reviews: date → topics. */
  reviews: Map<string, SchedulerTopic[]>
  /** Reviews whose day had no room, tried again on the next day. */
  carried: SchedulerTopic[]
  occasional: SchedulerTopic[]
  /** The final phase was reached with this queue left (reported once). */
  queueClosed: boolean
}

function byPriority(a: QueueItem, b: QueueItem): number {
  return b.priority - a.priority || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
}

function initialState(exam: SchedulerExam, today: string): ExamState {
  const n = exam.topics.length
  const queue: QueueItem[] = []
  const reviews = new Map<string, SchedulerTopic[]>()
  const carried: SchedulerTopic[] = []
  const occasional: SchedulerTopic[] = []
  for (const topic of exam.topics) {
    if (topic.learnedOn) {
      // Reviews of a topic learned before today: done ones skipped, missed
      // ones are due now.
      const done = topic.reviewsDone ?? 0
      REVIEW_OFFSETS.forEach((offset, i) => {
        if (i < done) return
        const due = addDays(topic.learnedOn!, offset)
        if (due < today) carried.push(topic)
        else reviews.set(due, [...(reviews.get(due) ?? []), topic])
      })
      continue
    }
    if (topic.skipped) continue
    if (topic.confirmed) {
      occasional.push(topic)
      continue
    }
    queue.push({
      kind: 'learn',
      id: topic.id,
      label: topic.name,
      minutes: learnMinutes(topic),
      priority: topicPriority(topic, n),
    })
  }
  for (const set of exam.sets) {
    if (set.done) continue
    // Homework and practice sets sit among the topics at average priority.
    queue.push({
      kind: set.kind,
      id: set.id,
      label: set.title,
      minutes: set.minutes,
      priority: 0.8,
    })
  }
  // The review sheet is short and sums the exam up: read before the files.
  for (const sheet of exam.reviewSheets ?? []) {
    if (sheet.done) continue
    queue.push({
      kind: 'review_sheet',
      id: sheet.id,
      label: sheet.title,
      minutes: sheet.minutes,
      priority: REVIEW_SHEET_PRIORITY,
    })
  }
  for (const doc of exam.reviewDocs ?? []) {
    if (doc.done) continue
    queue.push({
      kind: 'review_material',
      id: doc.id,
      label: doc.title,
      minutes: doc.minutes,
      priority: REVIEW_MATERIAL_PRIORITY,
    })
  }
  queue.sort(byPriority)
  // Duplicated carried reviews (several missed for one topic) count once.
  const uniqueCarried = carried.filter(
    (topic, i) => carried.findIndex((other) => other.id === topic.id) === i,
  )
  return { exam, queue, reviews, carried: uniqueCarried, occasional, queueClosed: false }
}

function weakest(topics: SchedulerTopic[], count: number): SchedulerTopic[] {
  return [...topics]
    .sort(
      (a, b) =>
        (a.mastery ?? 0.5) - 0.05 * a.openMistakes - ((b.mastery ?? 0.5) - 0.05 * b.openMistakes) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, count)
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const { today, calendar } = input
  const exams = input.exams.filter((exam) => exam.date > today)
  const lastDay = exams.reduce((last, exam) => (exam.date > last ? exam.date : last), today)
  const dayCount = Math.max(0, daysBetween(today, lastDay))
  const pinnedBy = new Map<string, number>()
  for (const pin of input.pinned ?? [])
    pinnedBy.set(pin.date, (pinnedBy.get(pin.date) ?? 0) + Math.max(0, pin.minutes))

  const days: ScheduledDay[] = []
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(today, i)
    const available = minutesOn(calendar, date)
    days.push({
      date,
      type: dayTypeOf(calendar, date),
      available,
      used: 0,
      pinnedMinutes: pinnedBy.get(date) ?? 0,
      tasks: [],
    })
  }
  const dayIndex = new Map(days.map((day, i) => [day.date, i]))
  const free = (day: ScheduledDay) => Math.max(0, day.available - day.pinnedMinutes - day.used)
  const push = (day: ScheduledDay, task: Omit<TaskDraft, 'date' | 'order'>) => {
    day.tasks.push({ ...task, date: day.date, order: day.tasks.length })
    day.used += task.minutes
  }
  const dropped: DroppedItem[] = []

  // 1. Mock papers (and the AI mock slot) are placed first, near their targets.
  for (const exam of exams) {
    const offsets: Array<{ offset: number; item: SchedulerMaterial; kind: 'mock' | 'ai_mock' }> =
      exam.mocks
        .filter((mock) => !mock.done)
        .map((item, i) => ({
          offset: MOCK_OFFSETS[i % MOCK_OFFSETS.length]!,
          item,
          kind: 'mock' as const,
        }))
    if (exam.aiMock) {
      if (!exam.aiMock.done)
        offsets.push({ offset: AI_MOCK_OFFSET, item: exam.aiMock, kind: 'ai_mock' })
    } else if (exam.aiMockSlot) {
      offsets.push({
        offset: AI_MOCK_OFFSET,
        item: { id: `ai-mock:${exam.id}`, title: '', minutes: AI_MOCK_MINUTES },
        kind: 'ai_mock',
      })
    }
    const lastStudyDay = addDays(exam.date, -1)
    for (const { offset, item, kind } of offsets) {
      let target = addDays(exam.date, -offset)
      if (target < today) target = today
      const candidates = [0, -1, 1, -2, 2, -3, 3]
        .map((delta) => addDays(target, delta))
        .filter((date) => date >= today && date <= lastStudyDay)
      let chosen = candidates
        .map((date) => days[dayIndex.get(date) ?? -1])
        .find((day): day is ScheduledDay => !!day && free(day) >= item.minutes)
      if (!chosen) {
        // Anywhere before the exam with room, latest first.
        chosen = days
          .filter((day) => day.date <= lastStudyDay && free(day) >= item.minutes)
          .sort((a, b) => b.date.localeCompare(a.date))[0]
      }
      if (!chosen) {
        if (kind === 'mock')
          dropped.push({
            examId: exam.id,
            kind,
            refId: item.id,
            label: item.title,
            minutes: item.minutes,
          })
        continue
      }
      push(chosen, {
        examId: exam.id,
        projectId: exam.projectId,
        kind,
        minutes: item.minutes,
        refId: item.id,
        ...(item.title ? { title: item.title } : {}),
      })
    }
  }

  const states = exams.map((exam) => initialState(exam, today))
  let dueItemsPlaced = false

  for (const day of days) {
    const active = states.filter((state) => state.exam.date > day.date)
    if (active.length === 0) continue
    const studyDay = free(day) > 0
    const daysLeft = (state: ExamState) => daysBetween(day.date, state.exam.date)
    const factor = (state: ExamState) => Math.max(1, state.exam.weight) * closeness(daysLeft(state))
    const ordered = [...active].sort(
      (a, b) => factor(b) - factor(a) || a.exam.date.localeCompare(b.exam.date),
    )
    const topicTasks: Array<{ examId: string; projectId: string; topic: SchedulerTopic }> = []

    // Reviews that were due today but find no room move to the next day.
    const dueReviews = (state: ExamState): SchedulerTopic[] => {
      const list = [...state.carried, ...(state.reviews.get(day.date) ?? [])]
      state.carried = []
      return list.filter((topic, i) => list.findIndex((t) => t.id === topic.id) === i)
    }

    if (!studyDay) {
      for (const state of active) state.carried = dueReviews(state)
      // A day off in the final phase still closes the queue.
      for (const state of active)
        if (daysLeft(state) <= FINAL_DAYS && !state.queueClosed) closeQueue(state)
      continue
    }

    // Reserve the end-of-day practice block before anything else is placed.
    const practice = free(day) >= 20 ? dayPracticeMinutes(free(day)) : 0
    day.used += practice

    // 2. Due now: mistake re-tests, review cards, vocabulary, on the first
    //    study day only — future dues are not known yet; the next re-plan
    //    picks them up.
    if (!dueItemsPlaced) {
      dueItemsPlaced = true
      const seenProjects = new Set<string>()
      let vocabPlaced = false
      for (const state of ordered) {
        const exam = state.exam
        if (exam.mistakesDue > 0) {
          const minutes = Math.min(20, 4 * exam.mistakesDue)
          if (free(day) >= minutes)
            push(day, { examId: exam.id, projectId: exam.projectId, kind: 'mistakes', minutes })
        }
        if (exam.cardsDue > 0 && !seenProjects.has(exam.projectId)) {
          seenProjects.add(exam.projectId)
          const minutes = Math.max(5, Math.min(15, Math.ceil(exam.cardsDue / 2)))
          if (free(day) >= minutes)
            push(day, { examId: exam.id, projectId: exam.projectId, kind: 'cards', minutes })
        }
        if (!vocabPlaced && (exam.vocabDue ?? 0) > 0 && free(day) >= 10) {
          vocabPlaced = true
          push(day, { examId: exam.id, projectId: exam.projectId, kind: 'vocab', minutes: 10 })
        }
      }
    }

    // 3. Final days: weak spots and mistakes only.
    for (const state of ordered) {
      if (daysLeft(state) > FINAL_DAYS) continue
      if (!state.queueClosed) closeQueue(state)
      const exam = state.exam
      const hasMistakesToday = day.tasks.some(
        (task) => task.kind === 'mistakes' && task.examId === exam.id,
      )
      if (exam.openMistakes > 0 && !hasMistakesToday && free(day) >= 10) {
        push(day, {
          examId: exam.id,
          projectId: exam.projectId,
          kind: 'mistakes',
          minutes: Math.min(20, Math.max(10, 4 * Math.min(5, exam.openMistakes))),
        })
      }
      const weak = weakest(exam.topics, 3)
      const minutes = Math.min(40, free(day))
      if (weak.length > 0 && minutes >= 15) {
        push(day, {
          examId: exam.id,
          projectId: exam.projectId,
          kind: 'weak_spots',
          minutes: Math.floor(minutes / 5) * 5,
          topicId: weak[0]!.id,
          topicNames: weak.map((topic) => topic.name),
        })
        for (const topic of weak)
          topicTasks.push({ examId: exam.id, projectId: exam.projectId, topic })
      }
    }

    // 4. Spaced reviews due today.
    for (const state of ordered) {
      const due = dueReviews(state)
      const left: SchedulerTopic[] = []
      for (const topic of due) {
        if (free(day) >= REVIEW_MINUTES) {
          push(day, {
            examId: state.exam.id,
            projectId: state.exam.projectId,
            kind: 'review',
            minutes: REVIEW_MINUTES,
            topicId: topic.id,
            topicNames: [topic.name],
          })
          topicTasks.push({ examId: state.exam.id, projectId: state.exam.projectId, topic })
        } else left.push(topic)
      }
      state.carried = left
    }

    // 5. First passes: each exam gets its share of what is left, then any
    //    exam may use what the others did not.
    const learning = ordered.filter((state) => daysLeft(state) > FINAL_DAYS)
    const pool = free(day)
    const totalFactor = learning.reduce((sum, state) => sum + factor(state), 0)
    const quota = new Map(
      learning.map((state) => [
        state,
        totalFactor > 0 ? Math.floor((pool * factor(state)) / totalFactor) : 0,
      ]),
    )
    const take = (state: ExamState, limit: () => number): boolean => {
      // The head of the queue if it fits, else one of the next two that does.
      const at = state.queue.slice(0, 3).findIndex((item) => item.minutes <= limit())
      if (at < 0) return false
      const item = state.queue.splice(at, 1)[0]!
      const exam = state.exam
      if (item.kind === 'learn') {
        const topic = exam.topics.find((t) => t.id === item.id)!
        push(day, {
          examId: exam.id,
          projectId: exam.projectId,
          kind: 'learn',
          minutes: item.minutes,
          topicId: topic.id,
          topicNames: [topic.name],
        })
        topicTasks.push({ examId: exam.id, projectId: exam.projectId, topic })
        REVIEW_OFFSETS.forEach((offset) => {
          const due = addDays(day.date, offset)
          state.reviews.set(due, [...(state.reviews.get(due) ?? []), topic])
        })
      } else {
        push(day, {
          examId: exam.id,
          projectId: exam.projectId,
          kind: item.kind,
          minutes: item.minutes,
          refId: item.id,
          title: item.label,
        })
      }
      return true
    }
    for (const state of learning) {
      let own = quota.get(state) ?? 0
      while (own > 0 && state.queue.length > 0) {
        const before = day.used
        if (!take(state, () => Math.min(own, free(day)))) break
        own -= day.used - before
      }
    }
    for (const state of learning) {
      while (state.queue.length > 0 && take(state, () => free(day))) {
        /* fill the rest of the day */
      }
    }

    // 6. An occasional look at mastered topics when time is left.
    for (const state of learning) {
      if (state.occasional.length === 0 || free(day) < REVIEW_MINUTES) continue
      const topic = state.occasional.shift()!
      push(day, {
        examId: state.exam.id,
        projectId: state.exam.projectId,
        kind: 'review',
        minutes: REVIEW_MINUTES,
        topicId: topic.id,
        topicNames: [topic.name],
      })
      topicTasks.push({ examId: state.exam.id, projectId: state.exam.projectId, topic })
    }

    // 7. The day ends with practice on its topics (or gives the time back).
    day.used -= practice
    if (practice > 0 && topicTasks.length > 0) {
      const first = topicTasks[0]!
      const names = [...new Set(topicTasks.map((entry) => entry.topic.name))].slice(0, 4)
      push(day, {
        examId: first.examId,
        projectId: first.projectId,
        kind: 'day_practice',
        minutes: practice,
        topicId: first.topic.id,
        topicNames: names,
      })
    }
  }

  function closeQueue(state: ExamState): void {
    state.queueClosed = true
    for (const item of state.queue) {
      dropped.push({
        examId: state.exam.id,
        kind: item.kind,
        ...(item.kind === 'learn' ? { topicId: item.id } : { refId: item.id }),
        label: item.label,
        minutes: item.minutes,
      })
    }
    state.queue = []
  }
  // Exams whose final phase was never reached inside the horizon (an exam
  // tomorrow) still report what could not be learned.
  for (const state of states) if (!state.queueClosed && state.queue.length > 0) closeQueue(state)

  const droppedMinutes = dropped.reduce((sum, item) => sum + item.minutes, 0)
  return { days, dropped, droppedMinutes, suggestions: suggest(input, exams, days, dropped) }
}

function suggest(
  input: ScheduleInput,
  exams: SchedulerExam[],
  days: ScheduledDay[],
  dropped: DroppedItem[],
): PlanSuggestion[] {
  if (dropped.length === 0) return []
  const out: PlanSuggestion[] = []
  const droppedMinutes = dropped.reduce((sum, item) => sum + item.minutes, 0)
  const studyDays = days.filter((day) => day.available > 0).length
  out.push({
    kind: 'add_minutes',
    minutesPerDay: Math.ceil(droppedMinutes / Math.max(1, studyDays) / 5) * 5,
  })
  const offDays = days.filter((day) => day.available === 0).length
  if (offDays > 0) out.push({ kind: 'use_off_days', days: offDays })
  const short = new Set(dropped.map((item) => item.examId))
  const donor = exams.filter((exam) => !short.has(exam.id)).sort((a, b) => b.weight - a.weight)[0]
  if (donor) out.push({ kind: 'lower_weight', examId: donor.id })
  const nearlyMastered = dropped.filter((item) => {
    if (item.kind !== 'learn') return false
    const topic = input.exams
      .find((exam) => exam.id === item.examId)
      ?.topics.find((t) => t.id === item.topicId)
    return (topic?.mastery ?? 0) >= 0.7
  }).length
  if (nearlyMastered > 0) out.push({ kind: 'skip_mastered', topics: nearlyMastered })
  return out
}
