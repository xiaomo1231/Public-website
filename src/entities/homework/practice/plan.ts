import type { HomeworkQuestion } from '../types'
import type { LinearSystemCheck, WalkthroughSection } from '../walkthrough'
import { walkthroughSubparts } from '../splitQuestion'
import type { SolutionKind } from '@/infrastructure/math/rref'
import { systemFromRrefLatex } from './linearSystem'
import { isAmbiguousLegacyCheck } from '../walkthroughChecks'
import {
  MAX_PRACTICE_QUESTIONS,
  type PracticeMode,
  type PracticeSlot,
  type PracticeSlotPart,
} from './types'

/**
 * What the practice set will contain, decided locally before any request.
 *
 * 完整版: one slot per question of the assignment, with the same sub-parts.
 * A question whose every sub-part is a linear system the walkthrough already
 * row-reduced (its local RREF checks give the shape and solution type) is
 * built locally; everything else is written by the AI.
 *
 * 精简版: one slot per category of the walkthrough summary (its table rows or
 * headings; the key points when it has none), plus one integrative slot (two
 * when there are more than three categories). Linear-system knowledge points
 * of a linear-algebra course are built locally.
 */

export interface SummaryKnowledge {
  /** Kinds / categories, e.g. the first column of the summary table. */
  categories: Array<{ name: string; questions: string }>
  /** Bullet points and bold ideas worth remembering. */
  keyPoints: string[]
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const plain = (text: string): string =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Categories and key points of a walkthrough summary (Markdown). */
export function summaryKnowledge(summary: string | undefined): SummaryKnowledge {
  const categories: SummaryKnowledge['categories'] = []
  const keyPoints: string[] = []
  if (!summary) return { categories, keyPoints }
  const lines = summary.split('\n')
  let tableRow = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('|')) {
      if (/^\|?[\s:|-]+\|?$/.test(line)) continue
      tableRow += 1
      // The first row of a table is its header.
      if (tableRow === 1) continue
      const cells = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => plain(cell))
      const name = cells[0] ?? ''
      if (name && !categories.some((item) => item.name === name))
        categories.push({ name: clip(name, 120), questions: clip(cells.slice(1).join(' · '), 120) })
      continue
    }
    tableRow = 0
    const heading = /^#{2,4}\s+(.+)$/.exec(line)
    if (heading) {
      const name = plain(heading[1]!)
      if (name && !categories.some((item) => item.name === name))
        categories.push({ name: clip(name, 120), questions: '' })
      continue
    }
    const bullet = /^(?:[-*+]|\d+[.)、])\s+(.+)$/.exec(line)
    if (bullet) {
      const point = clip(plain(bullet[1]!), 160)
      if (point && !keyPoints.includes(point)) keyPoints.push(point)
    }
  }
  if (keyPoints.length === 0) {
    for (const match of summary.matchAll(/\*\*([^*\n]{2,80})\*\*/g)) {
      const point = plain(match[1]!)
      if (!keyPoints.includes(point)) keyPoints.push(point)
    }
  }
  return { categories, keyPoints: keyPoints.slice(0, 12) }
}

/** How many questions 精简版 asks: one per category + 1–2 integrative ones. */
export function compactCount(knowledge: SummaryKnowledge, fallback: number): number {
  const base = compactBase(knowledge, fallback).length
  return Math.min(MAX_PRACTICE_QUESTIONS, base + integrativeCount(base))
}

const integrativeCount = (base: number): number => (base <= 1 ? 0 : base <= 3 ? 1 : 2)

function compactBase(knowledge: SummaryKnowledge, fallback: number): string[] {
  if (knowledge.categories.length > 0) return knowledge.categories.map((item) => item.name)
  if (knowledge.keyPoints.length > 0) return knowledge.keyPoints.slice(0, 6)
  return Array.from({ length: Math.max(1, Math.min(fallback, 5)) }, () => '')
}

const LINEAR_SYSTEM_TEXT =
  /(线性方程组|增广|行阶梯|RREF|row[- ]?reduc|echelon|augmented|linear system|system of (linear )?equations|高斯|gauss|free variable|自由变量|无解|唯一解|无穷多解|inconsistent|consistent)/i

/** The solution type a knowledge point is about, read from its words. */
export function solutionKindFromText(text: string): SolutionKind {
  if (/(无解|不相容|no solution|inconsistent)/i.test(text)) return 'none'
  if (/(无穷|无限|自由变量|infinite|infinitely|free variable|parametric|参数)/i.test(text))
    return 'infinite'
  return 'unique'
}

export interface PlanInput {
  mode: PracticeMode
  questions: readonly HomeworkQuestion[]
  /** `questionLabel` of each question, same order. */
  labels: readonly string[]
  /** Ready walkthrough sections by question id (their local RREF checks). */
  sections: ReadonlyMap<string, WalkthroughSection>
  /** The walkthrough summary (Markdown) and its suggestions. */
  summary?: string
  linearAlgebra: boolean
}

export function planPractice(input: PlanInput): PracticeSlot[] {
  return input.mode === 'full' ? planFull(input) : planCompact(input)
}

function planFull(input: PlanInput): PracticeSlot[] {
  const knowledge = summaryKnowledge(input.summary)
  return input.questions.slice(0, MAX_PRACTICE_QUESTIONS).map((question, index) => {
    const label = input.labels[index] ?? String(index + 1)
    const subparts = walkthroughSubparts(question.prompt)
    const firstMarker = subparts.length
      ? question.prompt.search(/[(（]a[)）]/i)
      : question.prompt.length
    const stem = subparts.length ? question.prompt.slice(0, Math.max(0, firstMarker)).trim() : ''
    const checks = input.sections.get(question.id)?.checks ?? []
    const systems = systemsFor(checks, Math.max(1, subparts.length))
    const parts: PracticeSlotPart[] = (
      subparts.length ? subparts : [{ label: undefined, text: question.prompt }]
    ).map((part, partIndex) => {
      const system = systems?.[partIndex]
      return {
        ...(part.label ? { label: part.label } : {}),
        text: part.text,
        ...(system ? { template: 'linear_system' as const, system } : {}),
      }
    })
    const knowledgePoints = knowledge.categories
      .filter((item) => new RegExp(`(^|[^\\d])${escape(label)}([^\\d]|$)`).test(item.questions))
      .map((item) => item.name)
    return {
      id: `s${index + 1}`,
      mode: 'full',
      sourceQuestionId: question.id,
      sourceLabel: label,
      sourceText: question.prompt,
      ...(stem ? { sourceStem: stem } : {}),
      parts,
      knowledgePoints,
      local: parts.every((part) => part.template === 'linear_system'),
    }
  })
}

/**
 * The walkthrough's local RREF checks as system shapes, one per sub-part —
 * only when there is exactly one check per sub-part and every one parses.
 */
function systemsFor(
  checks: readonly LinearSystemCheck[],
  partCount: number,
): NonNullable<PracticeSlotPart['system']>[] | null {
  if (checks.length !== partCount) return null
  // A homogeneous test (A x = 0) or an old check that may have been one is no
  // shape for a constructed [A | b] system: the AI writes those parts.
  if (checks.some((check) => check.homogeneous || isAmbiguousLegacyCheck(check))) return null
  const systems = checks.map((check) => systemFromRrefLatex(check.computedRref, check.computedKind))
  return systems.every(Boolean) ? (systems as NonNullable<PracticeSlotPart['system']>[]) : null
}

function planCompact(input: PlanInput): PracticeSlot[] {
  const knowledge = summaryKnowledge(input.summary)
  const base = compactBase(knowledge, input.questions.length)
  const keyPoints = knowledge.keyPoints
  const slots: PracticeSlot[] = base.map((name, index) => {
    const points = name ? [name] : keyPoints.slice(index, index + 1)
    const text = points.join(' ')
    const local = input.linearAlgebra && LINEAR_SYSTEM_TEXT.test(text)
    const solution = solutionKindFromText(text)
    return {
      id: `s${index + 1}`,
      mode: 'compact',
      parts: [
        {
          text,
          ...(local
            ? {
                template: 'linear_system' as const,
                system: compactShape(solution, index),
              }
            : {}),
        },
      ],
      knowledgePoints: points.length ? points : [],
      local,
    }
  })
  const extra = Math.min(
    integrativeCount(base.length),
    Math.max(0, MAX_PRACTICE_QUESTIONS - slots.length),
  )
  const allLocal = slots.length > 0 && slots.every((slot) => slot.local)
  const named = base.filter(Boolean)
  for (let i = 0; i < extra; i += 1) {
    // Integrative questions combine several points (all of them, or halves).
    const points =
      extra === 1 || named.length < 4 ? named : named.filter((_, index) => index % extra === i)
    const kinds: SolutionKind[] = ['none', 'unique', 'infinite']
    slots.push({
      id: `s${slots.length + 1}`,
      mode: 'compact',
      integrative: true,
      parts: allLocal
        ? kinds.map((solution, partIndex) => ({
            label: String.fromCharCode(97 + partIndex),
            text: points.join('; '),
            template: 'linear_system' as const,
            system: compactShape(solution, partIndex + i),
          }))
        : [{ text: points.join('; ') }],
      knowledgePoints: points.length ? points : keyPoints.slice(0, 3),
      local: allLocal,
    })
  }
  return slots
}

/** A friendly default shape for a compact linear-system question. */
function compactShape(
  solution: SolutionKind,
  variant: number,
): NonNullable<PracticeSlotPart['system']> {
  if (solution === 'unique') return { rows: 3, vars: 3, solution, free: 0 }
  if (solution === 'none') return { rows: 3, vars: 3, solution, free: 0 }
  return variant % 2 === 0
    ? { rows: 3, vars: 4, solution, free: 1 }
    : { rows: 3, vars: 4, solution, free: 2 }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
