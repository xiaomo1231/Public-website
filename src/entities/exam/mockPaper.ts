import { walkthroughSubparts } from '@/entities/homework/splitQuestion'
import type { PracticePart } from '@/entities/homework/practice/types'
import { classifyExamQuestion, type ExamQuestionKind } from './analysis'
import { parseQuestionMarks } from './marks'
import { detectFigureGroups } from './figureGroups'

/**
 * AI 模拟卷 (planning, local and pure): a mock paper written by the platform
 * in the style of the professor's past paper. It never predicts the real
 * exam; everything it says about marks and answers is 平台拟定.
 *
 * - **Structure** mirrors one past paper (`mirrorStructure`): the number of
 *   questions, each question's type, sub-parts and marks, and the time
 *   allowed. A different question count keeps the paper's type mix.
 * - **Topics** come from the exam scope (or the student's focus topics),
 *   weighted by their share of past-paper marks and by how weak the student
 *   is on them (`allocateTopics`).
 * - **Difficulty** follows the study plan (`defaultDifficulty`): foundation
 *   early, medium mid-way, the past paper's level near the exam; the last AI
 *   mock's result moves it one step up or down.
 */

export type MockDifficulty = 'foundation' | 'medium' | 'exam' | 'above'

export const MOCK_DIFFICULTIES: readonly MockDifficulty[] = [
  'foundation',
  'medium',
  'exam',
  'above',
]

/** One answerable part of a slot: its label (`a`, `b` …; '' when none) and printed marks. */
export interface MockSlotPart {
  label: string
  marks?: number
}

/** One question position of the paper (copied from the past paper). */
export interface MockSlotSpec {
  /** Closed id `s1`, `s2` … (also the review id). */
  id: string
  index: number
  /** Printed number (`1`, `2` …). */
  label: string
  kind: ExamQuestionKind
  /** Marks for the whole question, when the past paper states them. */
  marks?: number
  /** Sub-parts with their marks; empty when the question has none. */
  parts: MockSlotPart[]
  /** Multiple choice: how many options the past paper's question had. */
  optionCount?: number
  /** The past paper's question at this position (a style reference only). */
  templateQuestionId?: string
  /**
   * Several questions of the paper share ONE figure (e.g. three multiple
   * choice on one supply-and-demand graph; `detectFigureGroups`). Grouped
   * slots get the same topic; when a figure engine draws the shared figure
   * (`AiMockInfo.figures`), each question is written about it. Without one
   * they are written as ordinary questions.
   */
  figureGroup?: MockFigureGroup
}

/** What a figure engine is asked to draw: one figure for one figure group. */
export interface MockFigureRequest {
  groupId: string
  topic: { id: string; name: string }
  /** The group's slots, in order (with their parts, marks and option counts). */
  slots: Array<Pick<MockSlotSpec, 'id' | 'label' | 'kind' | 'parts' | 'marks' | 'optionCount'>>
  language: MockLanguage
  /** The course subject (an engine draws only the figures of its subject). */
  subject?: string
}

/**
 * Draws the shared figure of a figure group (e.g. a market diagram), or
 * returns null when it cannot. Optional: without an engine the group's
 * questions are written as ordinary questions.
 */
export type MockFigureEngine = (request: MockFigureRequest) => Promise<MockFigureSpec | null>

/** A slot's place in a figure group. */
export interface MockFigureGroup {
  /** `g1`, `g2` … (unique within the paper). */
  id: string
  /** 0-based position in the group. */
  position: number
  size: number
}

/**
 * A figure drawn for a figure group by a figure engine (e.g. a market
 * diagram). `kind` and `spec` belong to the engine; `description` is the
 * text the question writer is given (axes, curves, labelled points).
 */
export interface MockFigureSpec {
  kind: string
  spec: unknown
  description: string
}

export interface PaperStructure {
  templateSetId: string
  templateTitle: string
  slots: MockSlotSpec[]
  /** Time allowed, from the paper (or the student's earlier choice). */
  minutes?: number
  /** Sum of the question marks when every question states them. */
  totalMarks?: number
  hasFormulaSheet: boolean
  kindMix: Partial<Record<ExamQuestionKind, number>>
}

export interface TemplateQuestion {
  id: string
  number?: string
  prompt: string
  /** 留作检验 (independent): never used, not even for the structure. */
  heldOut?: boolean
}

const OPTION_LINE = /(?:^|\n|\s)[(（]?([A-F])[.)）]\s+\S/g

function optionCount(prompt: string): number {
  return new Set([...prompt.matchAll(OPTION_LINE)].map((match) => match[1])).size
}

/** The past paper's structure, question by question (held-out questions are left out). */
export function mirrorStructure(input: {
  setId: string
  title: string
  minutes?: number
  hasFormulaSheet: boolean
  questions: readonly TemplateQuestion[]
  /** The professor's habit "several questions share one figure" (looser grouping). */
  figureGroups?: boolean
}): PaperStructure {
  const slots: MockSlotSpec[] = []
  const prompts: string[] = []
  for (const question of input.questions) {
    if (question.heldOut || !question.prompt.trim()) continue
    prompts.push(question.prompt)
    const marks = parseQuestionMarks(question.prompt)
    const subparts = walkthroughSubparts(question.prompt)
    const kind = classifyExamQuestion(question.prompt)
    const index = slots.length
    const partMarks = new Map(marks.parts.map((part) => [part.label ?? '', part.marks]))
    slots.push({
      id: `s${index + 1}`,
      index,
      label: question.number?.trim() || String(index + 1),
      kind: subparts.length >= 2 && kind === 'multiple_choice' ? 'calculation' : kind,
      ...(marks.total !== undefined ? { marks: marks.total } : {}),
      parts: subparts.map((part) => ({
        label: part.label,
        ...(partMarks.has(part.label) ? { marks: partMarks.get(part.label)! } : {}),
      })),
      ...(kind === 'multiple_choice' && subparts.length < 2
        ? { optionCount: Math.min(6, Math.max(4, optionCount(question.prompt))) }
        : {}),
      templateQuestionId: question.id,
    })
  }
  const groups = detectFigureGroups(
    slots.map((slot, index) => ({
      label: slot.label,
      prompt: prompts[index]!,
      multipleChoice: slot.kind === 'multiple_choice',
    })),
    { loose: Boolean(input.figureGroups) },
  )
  groups.forEach((members, group) => {
    members.forEach((index, position) => {
      slots[index] = {
        ...slots[index]!,
        figureGroup: { id: `g${group + 1}`, position, size: members.length },
      }
    })
  })
  return finishStructure({ ...input, slots })
}

/**
 * Figure groups after slots were picked or repeated: consecutive slots of the
 * same source group stay a group (renumbered); a lone member is ungrouped.
 */
function regroup(slots: MockSlotSpec[]): MockSlotSpec[] {
  const out: MockSlotSpec[] = []
  let count = 0
  let index = 0
  while (index < slots.length) {
    const source = slots[index]!.figureGroup?.id
    let end = index + 1
    if (source) {
      while (
        end < slots.length &&
        slots[end]!.figureGroup?.id === source &&
        slots[end]!.figureGroup!.position > slots[end - 1]!.figureGroup!.position
      )
        end++
    }
    const run = slots.slice(index, end)
    if (source && run.length >= 2) {
      count++
      run.forEach((slot, position) =>
        out.push({ ...slot, figureGroup: { id: `g${count}`, position, size: run.length } }),
      )
    } else {
      for (const slot of run) {
        const { figureGroup: _group, ...rest } = slot
        void _group
        out.push(rest)
      }
    }
    index = end
  }
  return out
}

function finishStructure(input: {
  setId: string
  title: string
  minutes?: number
  hasFormulaSheet: boolean
  slots: MockSlotSpec[]
}): PaperStructure {
  const kindMix: PaperStructure['kindMix'] = {}
  for (const slot of input.slots) kindMix[slot.kind] = (kindMix[slot.kind] ?? 0) + 1
  const allMarked = input.slots.length > 0 && input.slots.every((slot) => slot.marks !== undefined)
  return {
    templateSetId: input.setId,
    templateTitle: input.title,
    slots: input.slots,
    ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
    ...(allMarked
      ? { totalMarks: input.slots.reduce((sum, slot) => sum + (slot.marks ?? 0), 0) }
      : {}),
    hasFormulaSheet: input.hasFormulaSheet,
    kindMix,
  }
}

export const MIN_MOCK_QUESTIONS = 1
export const MAX_MOCK_QUESTIONS = 40

/**
 * The structure with another number of questions. Fewer: evenly spaced
 * questions of the paper (its type mix kept); more: the paper's questions
 * again, in order. Questions are numbered 1…n once the count changes.
 */
export function resizeStructure(structure: PaperStructure, count: number): PaperStructure {
  const n = Math.max(MIN_MOCK_QUESTIONS, Math.min(MAX_MOCK_QUESTIONS, Math.round(count)))
  const source = structure.slots
  if (source.length === 0 || n === source.length) return structure
  const picked =
    n < source.length
      ? Array.from({ length: n }, (_, i) => source[Math.floor((i * source.length) / n)]!)
      : Array.from({ length: n }, (_, i) => source[i % source.length]!)
  const slots = regroup(
    picked.map((slot, index) => ({
      ...slot,
      id: `s${index + 1}`,
      index,
      label: String(index + 1),
    })),
  )
  const minutes =
    structure.minutes !== undefined
      ? Math.max(5, Math.round((structure.minutes * n) / source.length / 5) * 5)
      : undefined
  return finishStructure({
    setId: structure.templateSetId,
    title: structure.templateTitle,
    hasFormulaSheet: structure.hasFormulaSheet,
    slots,
    ...(minutes !== undefined ? { minutes } : {}),
  })
}

// --- Difficulty ---------------------------------------------------------------

export type DifficultyReason =
  'no_exam' | 'early' | 'middle' | 'late' | 'near_exam' | 'last_high' | 'last_low'

export interface PreviousMock {
  difficulty: MockDifficulty
  /** Platform-estimated share right (0–1); null when not checked. */
  fraction: number | null
  at: number
}

const DAY = 86_400_000
/** Days before the exam from which a mock is written at the exam's level. */
export const NEAR_EXAM_DAYS = 7
/** A last mock at or above this moves the next one up a step; below `LOW` down a step. */
export const HIGH_RESULT = 0.8
export const LOW_RESULT = 0.5

function step(level: MockDifficulty, delta: number): MockDifficulty {
  const index = MOCK_DIFFICULTIES.indexOf(level) + delta
  return MOCK_DIFFICULTIES[Math.max(0, Math.min(MOCK_DIFFICULTIES.length - 1, index))]!
}

/**
 * The default difficulty of the next AI mock paper: by where the student is
 * in the plan (planned from `planStartedAt` to `examAt`), then one step up
 * after a strong last AI mock (≥ 80%) or down after a weak one (< 50%).
 */
export function defaultDifficulty(input: {
  now: number
  examAt?: number
  planStartedAt?: number
  previous?: readonly PreviousMock[]
}): { difficulty: MockDifficulty; reasons: DifficultyReason[] } {
  const reasons: DifficultyReason[] = []
  let level: MockDifficulty
  if (input.examAt === undefined || input.examAt <= input.now) {
    level = 'medium'
    reasons.push('no_exam')
  } else {
    const daysLeft = (input.examAt - input.now) / DAY
    const start = Math.min(input.planStartedAt ?? input.now, input.now)
    const total = Math.max(1, (input.examAt - start) / DAY)
    const elapsed = 1 - daysLeft / total
    if (daysLeft <= NEAR_EXAM_DAYS) {
      level = 'exam'
      reasons.push('near_exam')
    } else if (elapsed < 0.4) {
      level = 'foundation'
      reasons.push('early')
    } else if (elapsed < 0.75) {
      level = 'medium'
      reasons.push('middle')
    } else {
      level = 'exam'
      reasons.push('late')
    }
  }
  const last = [...(input.previous ?? [])]
    .filter((item) => item.fraction !== null)
    .sort((a, b) => b.at - a.at)[0]
  if (last && last.fraction !== null) {
    // The result shifts from the level that paper was written at.
    const base = MOCK_DIFFICULTIES.indexOf(last.difficulty) >= 0 ? last.difficulty : level
    if (last.fraction >= HIGH_RESULT) {
      const next = step(base, 1)
      if (MOCK_DIFFICULTIES.indexOf(next) > MOCK_DIFFICULTIES.indexOf(level)) level = next
      reasons.push('last_high')
    } else if (last.fraction < LOW_RESULT) {
      const next = step(base, -1)
      if (MOCK_DIFFICULTIES.indexOf(next) < MOCK_DIFFICULTIES.indexOf(level)) level = next
      reasons.push('last_low')
    }
  }
  return { difficulty: level, reasons }
}

// --- Topics -------------------------------------------------------------------

export interface MockTopicInput {
  id: string
  name: string
  /** Share of past-paper marks within the scope (0–1); absent = unknown. */
  marksShare?: number
  /** 0–1 estimate from practice; null without practice. */
  mastery: number | null
}

/** How much a topic should weigh in the paper: its past-paper marks, more when weak. */
export function topicWeight(topic: MockTopicInput, count: number): number {
  const share = topic.marksShare ?? 1 / Math.max(1, count)
  const weakness = 1.25 - (topic.mastery ?? 0.5)
  return Math.max(0.02, share) * weakness
}

/**
 * One course topic per slot, so that each topic's marks follow its weight
 * (largest deficit first, the biggest questions placed first). Focus topics,
 * when given, replace the scope. Deterministic.
 */
export function allocateTopics(
  slots: readonly Pick<MockSlotSpec, 'id' | 'marks' | 'figureGroup'>[],
  topics: readonly MockTopicInput[],
  focusIds: readonly string[] = [],
): Map<string, MockTopicInput> {
  const focus = new Set(focusIds)
  const pool = focus.size > 0 ? topics.filter((topic) => focus.has(topic.id)) : [...topics]
  const out = new Map<string, MockTopicInput>()
  if (pool.length === 0 || slots.length === 0) return out
  const weights = pool.map((topic) => topicWeight(topic, pool.length))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  // A figure group is one unit (one figure, one topic) with the marks of its members.
  const units: Array<{ ids: string[]; marks: number }> = []
  const byGroup = new Map<string, { ids: string[]; marks: number }>()
  for (const slot of slots) {
    const key = slot.figureGroup?.id
    const existing = key ? byGroup.get(key) : undefined
    if (existing) {
      existing.ids.push(slot.id)
      existing.marks += slot.marks ?? 1
      continue
    }
    const unit = { ids: [slot.id], marks: slot.marks ?? 1 }
    units.push(unit)
    if (key) byGroup.set(key, unit)
  }
  const size = (unit: { marks: number }) => unit.marks
  const total = units.reduce((sum, unit) => sum + size(unit), 0)
  const target = weights.map((weight) => (weight / weightSum) * total)
  const given = pool.map(() => 0)
  const order = units
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => size(b.slot) - size(a.slot) || a.index - b.index)
  for (const { slot } of order) {
    let best = 0
    for (let i = 1; i < pool.length; i++) {
      const deficit = target[i]! - given[i]!
      const bestDeficit = target[best]! - given[best]!
      if (
        deficit > bestDeficit + 1e-9 ||
        (Math.abs(deficit - bestDeficit) <= 1e-9 && pool[i]!.name < pool[best]!.name)
      )
        best = i
    }
    given[best]! += size(slot)
    for (const id of slot.ids) out.set(id, pool[best]!)
  }
  return out
}

// --- The stored paper ---------------------------------------------------------------

/**
 * `pending` — to be written (again: `rejected` says why the last one failed);
 * `written` — passed the local checks, waiting for the AI review;
 * `passed`  — reviewed and saved as a question (`questionId`);
 * `dropped` — failed twice (`dropReason`): the paper is missing this question;
 * `failed`  — the request failed (`error`); 重试 writes it again.
 */
export type MockSlotStatus = 'pending' | 'written' | 'passed' | 'dropped' | 'failed'

export interface MockCandidate {
  /** The question as printed (stem, parts with marks, options). */
  prompt: string
  parts: PracticePart[]
  /** 平台拟定 marking scheme, `(a) …` prefixed for sub-parts. */
  scheme: string[]
  /** Worked reference solution (Markdown). */
  solution: string
}

export interface MockSlotState extends MockSlotSpec {
  topicIds: string[]
  topicNames: string[]
  difficulty: MockDifficulty
  status: MockSlotStatus
  /** Writes so far (a slot is written at most twice). */
  attempts: number
  rejected?: string
  error?: string
  dropReason?: string
  candidate?: MockCandidate
  questionId?: string
}

/** Why a default was chosen (shown to the student next to the value). */
export type DefaultReason =
  | { code: 'structure_from_paper'; paper: string; questions: number }
  | { code: 'minutes_from_paper'; minutes: number }
  | { code: 'minutes_default'; minutes: number }
  | { code: 'difficulty'; reason: DifficultyReason }
  | { code: 'topics_exam_scope'; exam: string; topics: number }
  | { code: 'topics_course'; topics: number }
  | { code: 'topics_weighted' }
  | { code: 'formula_sheet' }

export interface AiMockConfig {
  /** The past paper whose structure is mirrored. */
  templateSetId: string
  /** The planned exam this paper prepares for (学习计划). */
  examId?: string
  difficulty: MockDifficulty
  /** Topics to concentrate on; empty = the exam scope (or the whole course). */
  focusTopicIds: string[]
  /** A 考点清单 scope to draw topics from (instead of the exam's scope). */
  scope?: { documentId: string; scopeId: string }
  questionCount: number
  minutes: number
}

/** The paper's language: as the user's question language, or 跟随考试语言 `exam:<code>`. */
export type MockLanguage = 'zh' | 'zh_terms' | 'en' | `exam:${string}`

export interface AiMockInfo {
  config: AiMockConfig
  /** Why the defaults were what they were. */
  reasons: DefaultReason[]
  language: MockLanguage
  slots: MockSlotState[]
  /** The past paper had a formula / data sheet (shown again: the set shares its document). */
  hasFormulaSheet: boolean
  totalMarks?: number
  /** A run stopped by an account error (quota, key): what to fix. */
  error?: string
  generatedAt?: number
  /**
   * Shared figures of the figure groups, by group id (`g1`), when a figure
   * engine drew them. Absent ⇒ grouped slots are written as ordinary questions.
   */
  figures?: Record<string, MockFigureSpec>
}

export interface MockStructureReport {
  planned: number
  passed: number
  /** Slots without a question (dropped, failed or not written yet), in paper order. */
  missing: Array<{
    slotId: string
    label: string
    marks?: number
    status: MockSlotStatus
    reason?: string
  }>
  /** Marks of the questions the paper has / was planned with (when every slot states marks). */
  marks?: { present: number; planned: number }
}

export function structureReport(info: Pick<AiMockInfo, 'slots'>): MockStructureReport {
  const missing = info.slots
    .filter((slot) => slot.status !== 'passed')
    .map((slot) => ({
      slotId: slot.id,
      label: slot.label,
      ...(slot.marks !== undefined ? { marks: slot.marks } : {}),
      status: slot.status,
      ...(slot.dropReason || slot.error ? { reason: slot.dropReason ?? slot.error } : {}),
    }))
  const allMarked = info.slots.length > 0 && info.slots.every((slot) => slot.marks !== undefined)
  return {
    planned: info.slots.length,
    passed: info.slots.length - missing.length,
    missing,
    ...(allMarked
      ? {
          marks: {
            planned: info.slots.reduce((sum, slot) => sum + (slot.marks ?? 0), 0),
            present: info.slots
              .filter((slot) => slot.status === 'passed')
              .reduce((sum, slot) => sum + (slot.marks ?? 0), 0),
          },
        }
      : {}),
  }
}

// --- Estimate -----------------------------------------------------------------------

/** Questions per review request. */
export const MOCK_REVIEW_BATCH = 8
const WRITE_INPUT_TOKENS = 3_500
const WRITE_OUTPUT_TOKENS = 1_200
const REVIEW_INPUT_BASE = 2_500
const REVIEW_INPUT_PER_QUESTION = 500
const REVIEW_OUTPUT_PER_QUESTION = 60

export interface MockEstimate {
  /** Requests when every question passes first time. */
  requests: number
  /** At most (every question written twice and reviewed twice). */
  maxRequests: number
  inputTokens: number
  outputTokens: number
}

/** Requests and tokens before anything is sent (rough, labelled as an estimate). */
export function estimateMockPaper(questions: number): MockEstimate {
  const n = Math.max(0, Math.round(questions))
  const reviews = Math.ceil(n / MOCK_REVIEW_BATCH)
  return {
    requests: n + reviews,
    maxRequests: 2 * (n + reviews),
    inputTokens:
      n * WRITE_INPUT_TOKENS + reviews * REVIEW_INPUT_BASE + n * REVIEW_INPUT_PER_QUESTION,
    outputTokens: n * (WRITE_OUTPUT_TOKENS + REVIEW_OUTPUT_PER_QUESTION),
  }
}
