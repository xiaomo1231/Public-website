/**
 * 讲解末尾「做练习题」: write new practice questions for the slots of a
 * practice set that have no local template (every subject except the linear
 * systems of linear algebra, which are built locally).
 *
 * One request covers several slots. Each answer that can be recomputed comes
 * with a `check` (a linear system's augmented matrix, a numeric expression, a
 * chemical equation); the app recomputes it and drops the question when the
 * stated answer disagrees, and stores the locally computed answer otherwise.
 */
import { asArray, asRecord, asTrimmedString } from '../../validation'
import { securityFooter, untrustedContentWrapper } from '../security'
import { NOTATION_RULES } from '../homework-walkthrough/v1'
import { professorStyleSection } from '../question-style/v1'

export const VERSION = 'v1' as const

export type PracticePromptLanguage = 'zh' | 'en'

export interface PracticeSlotInput {
  /** Closed slot id (`s1`) the reply must echo. */
  id: string
  mode: 'full' | 'compact'
  /** Full: the original question (clipped) the new one mirrors. */
  original?: string
  /** Full: the sub-part labels the new question must have, in order ([] = none). */
  partLabels: string[]
  /** Full: solution type each part must keep (`none` / `unique` / `infinite` / ''). */
  partSolutions?: string[]
  /** Compact: the knowledge points to test (several for an integrative question). */
  knowledgePoints: string[]
  integrative?: boolean
  /** A previous attempt failed review for this reason (write a different one). */
  rejected?: string
  /**
   * 错题跟进: what the new question must exercise (the student's earlier error,
   * e.g. units or significant figures). Absent: the prompt is unchanged.
   */
  focus?: string
}

export function buildSystemPrompt(): string {
  return [
    'You write NEW practice questions for a university course, based on a homework assignment a student has just studied with a full walkthrough.',
    'Return strictly valid JSON: {"questions":[{"slot":"s1","stem":"...","parts":[{"label":"a","prompt":"...","answer":"...","solution":"...","check":null}]}]}',
    'Write exactly one question per SLOT, echoing its id in "slot". Never invent slot ids.',
    'Mode "full": mirror the ORIGINAL question one-to-one — the same number of sub-parts with the same labels, the same task and answer type in each sub-part, the same solution type (e.g. a system with no / a unique / infinitely many solutions stays so), similar difficulty; change the numbers, functions, names and context. Never copy the original numbers.',
    'Mode "compact": one question testing the listed KNOWLEDGE POINTS; an integrative question combines all of them in one task (sub-parts allowed). Same level as the assignment.',
    'When a slot has "rejected", the previous question was rejected for that reason: write a different question that avoids it.',
    '"stem": the shared statement ("" when there are no sub-parts). "prompt": the sub-part task (the whole question when there are no sub-parts; then omit "label"). Questions must be self-contained, unambiguous and solvable with the course methods.',
    '"answer": the short final answer only (a value with unit, an expression, a set of values, "no solution", an equation). "solution": a concise worked solution in Markdown (key steps only).',
    '"check": lets the app recompute the answer. Use exactly one of:',
    '  {"type":"linear_system","augmented":[["1","2","3"],["0","1","-1/2"]],"solution":"none|unique|infinite"} for every linear system (rows of strings: integers or fractions; the last column is the right-hand side; keep the entries small);',
    '  {"type":"numeric","expression":"(12.5*3)/2","unit":"m/s"} when the answer is one number: a plain arithmetic expression (numbers, + - * / ^, sqrt, sin, cos, exp, log, pi, e; no variables) that evaluates to it, and the unit in the answer if any ("" when none);',
    '  {"type":"chem_equation","equation":"2H2 + O2 -> 2H2O"} when the answer is a balanced chemical equation;',
    '  null otherwise (proofs, explanations, symbolic results, several values).',
    'The "answer" must agree with the "check" (it is recomputed; a disagreeing question is discarded).',
    ...NOTATION_RULES,
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export interface PracticeGenerateInput {
  language: PracticePromptLanguage
  /** The walkthrough summary's categories and key points (clipped). */
  keyPoints: string
  slots: PracticeSlotInput[]
  /**
   * 教授出题习惯 (`buildHabitsBlock`), when the profile is on and not empty.
   * Absent: the prompt is byte-identical to before (no version change).
   */
  professorHabits?: string
}

export function buildUserPrompt(input: PracticeGenerateInput): string {
  const slots = input.slots.map((slot) => {
    const lines = [`SLOT ${slot.id} (mode: ${slot.mode}${slot.integrative ? ', integrative' : ''})`]
    if (slot.original) lines.push(untrustedContentWrapper(`ORIGINAL ${slot.id}`, slot.original))
    lines.push(
      slot.partLabels.length
        ? `Sub-parts: ${slot.partLabels.map((label) => `(${label})`).join(' ')}`
        : 'Sub-parts: none',
    )
    const solutions = (slot.partSolutions ?? []).filter(Boolean)
    if (solutions.length)
      lines.push(
        `Solution types to keep: ${(slot.partSolutions ?? [])
          .map(
            (kind, index) =>
              `${slot.partLabels[index] ? `(${slot.partLabels[index]}) ` : ''}${kind || 'any'}`,
          )
          .join(', ')}`,
      )
    if (slot.knowledgePoints.length)
      lines.push(`Knowledge points: ${slot.knowledgePoints.join('; ')}`)
    if (slot.rejected) lines.push(`Rejected before: ${slot.rejected}`)
    if (slot.focus) lines.push(`Focus: ${slot.focus}`)
    return lines.join('\n')
  })
  return [
    input.language === 'zh'
      ? 'Write every question, answer and solution in Simplified Chinese (mathematical notation unchanged).'
      : 'Write every question, answer and solution in English.',
    input.keyPoints
      ? untrustedContentWrapper('KNOWLEDGE POINTS OF THE ASSIGNMENT', input.keyPoints)
      : '',
    ...slots,
    input.professorHabits ? professorStyleSection(input.professorHabits) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface GeneratedPracticePart {
  label?: string
  prompt: string
  answer: string
  solution: string
  check: Record<string, unknown> | null
}

export interface GeneratedPracticeQuestion {
  slot: string
  stem: string
  parts: GeneratedPracticePart[]
}

/** Only questions for the given slot ids; parts without a prompt are dropped. */
export function normalizeOutput(
  raw: unknown,
  slotIds: ReadonlySet<string>,
): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = []
  for (const item of asArray(asRecord(raw)?.questions)) {
    const row = asRecord(item)
    if (!row) continue
    const slot = asTrimmedString(row.slot)
    if (!slotIds.has(slot) || out.some((question) => question.slot === slot)) continue
    const parts: GeneratedPracticePart[] = []
    for (const rawPart of asArray(row.parts)) {
      const part = asRecord(rawPart)
      if (!part) continue
      const prompt = asTrimmedString(part.prompt)
      if (!prompt) continue
      const label = asTrimmedString(part.label)
        .replace(/[()（）]/g, '')
        .toLowerCase()
      parts.push({
        ...(label ? { label } : {}),
        prompt,
        answer: asTrimmedString(part.answer),
        solution: asTrimmedString(part.solution),
        check: asRecord(part.check),
      })
    }
    if (parts.length === 0) continue
    out.push({ slot, stem: asTrimmedString(row.stem), parts })
  }
  return out
}
