import { dayKey } from './calendar'
import { REVIEW_OFFSETS, type PinnedTask, type TaskDraft } from './scheduler'
import type { StudyTask } from './types'

/**
 * Re-planning keeps the student's history and choices and replaces the rest:
 * - done / skipped tasks stay (they are what the plan learns from);
 * - pending tasks the student moved to a day (`pinned`) stay on that day,
 *   unless that day has passed (then they roll forward like the others);
 * - every other pending task is replaced by the new schedule, so unfinished
 *   work rolls forward to the next days that have room.
 */

/** Identity of a task across re-plans (same exam, kind and subject). */
export function taskKey(task: Pick<StudyTask, 'examId' | 'kind' | 'topicId' | 'refId'>): string {
  return `${task.examId}|${task.kind}|${task.topicId ?? ''}|${task.refId ?? ''}`
}

export interface Reconciled {
  removeIds: string[]
  /** New tasks, and kept pending tasks with refreshed minutes / order. */
  add: StudyTask[]
}

export function reconcileTasks(
  existing: readonly StudyTask[],
  drafts: readonly TaskDraft[],
  today: string,
  now: number,
  newId: () => string = () => crypto.randomUUID(),
): Reconciled {
  const removeIds: string[] = []
  const keptPinned = new Set<string>()
  const handledToday = new Set<string>()
  // Unpinned pending tasks, by key + day: a draft that matches one keeps its
  // id (links and open forms stay valid across re-plans).
  const reusable = new Map<string, StudyTask[]>()
  for (const task of existing) {
    if (task.status !== 'pending') {
      if (task.date === today) handledToday.add(taskKey(task))
      continue
    }
    if (task.pinned && task.date >= today) {
      keptPinned.add(taskKey(task))
      continue
    }
    const slot = `${taskKey(task)}@${task.date}`
    reusable.set(slot, [...(reusable.get(slot) ?? []), task])
  }
  const add: StudyTask[] = []
  for (const draft of drafts) {
    const key = taskKey(draft)
    if (keptPinned.has(key)) continue
    if (draft.date === today && handledToday.has(key)) continue
    const same = reusable.get(`${key}@${draft.date}`)?.shift()
    if (same) {
      add.push({
        ...same,
        minutes: draft.minutes,
        order: draft.order,
        ...(draft.topicNames?.length ? { topicNames: draft.topicNames } : {}),
        ...(draft.title ? { title: draft.title } : {}),
        updatedAt: now,
      })
      continue
    }
    add.push({
      id: newId(),
      projectId: draft.projectId,
      examId: draft.examId,
      date: draft.date,
      kind: draft.kind,
      ...(draft.topicId ? { topicId: draft.topicId } : {}),
      ...(draft.topicNames?.length ? { topicNames: draft.topicNames } : {}),
      ...(draft.refId ? { refId: draft.refId } : {}),
      ...(draft.title ? { title: draft.title } : {}),
      minutes: draft.minutes,
      order: draft.order,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
  }
  for (const left of reusable.values()) removeIds.push(...left.map((task) => task.id))
  return { removeIds, add }
}

/** Minutes the scheduler must leave alone: pinned tasks ahead, and today's finished work. */
export function pinnedMinutes(tasks: readonly StudyTask[], today: string): PinnedTask[] {
  return tasks
    .filter(
      (task) =>
        (task.status === 'pending' && task.pinned && task.date >= today) ||
        (task.status === 'done' && task.date === today),
    )
    .map((task) => ({ date: task.date, minutes: task.minutes }))
}

export interface TopicProgress {
  learnedOn?: string
  reviewsDone: number
  skipped: boolean
}

/** What the student already did for an exam's topics, from finished tasks. */
export function topicProgress(
  tasks: readonly StudyTask[],
  examId: string,
): Map<string, TopicProgress> {
  const out = new Map<string, TopicProgress>()
  const mine = tasks
    .filter((task) => task.examId === examId && task.topicId && task.status !== 'pending')
    .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0) || a.date.localeCompare(b.date))
  for (const task of mine) {
    const id = task.topicId!
    const entry = out.get(id) ?? { reviewsDone: 0, skipped: false }
    const day = task.doneAt ? dayKey(task.doneAt) : task.date
    if (task.kind === 'learn') {
      if (task.status === 'done') entry.learnedOn ??= day
      else entry.skipped = true
    } else if (task.kind === 'review' && task.status === 'done' && entry.learnedOn) {
      entry.reviewsDone = Math.min(REVIEW_OFFSETS.length, entry.reviewsDone + 1)
    }
    out.set(id, entry)
  }
  return out
}

/** Material ids (sets, mock papers, the AI mock slot) whose task was finished or skipped. */
export function handledMaterials(tasks: readonly StudyTask[], examId: string): Set<string> {
  return new Set(
    tasks
      .filter((task) => task.examId === examId && task.refId && task.status !== 'pending')
      .map((task) => task.refId!),
  )
}
