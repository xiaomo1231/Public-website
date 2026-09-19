import {
  AlertTriangle,
  BookMarked,
  Info,
  Lightbulb,
  ListChecks,
  OctagonAlert,
  PencilLine,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '@/i18n'

/**
 * Teaching-block recognition.
 *
 * The lesson prompt asks the model to structure its output with real Markdown
 * headings (`## Definition`), and this module maps those headings onto the
 * semantic teaching blocks the UI knows how to present.
 *
 * Two block families:
 *
 *   - `boxed: true`  — a formal teaching block (Definition, Example, …) gets a
 *     restrained bordered container so it stands apart from running prose.
 *   - `boxed: false` — an ordinary structural section (Explanation, Summary, …)
 *     stays a plain heading. Boxing everything would turn the page into a
 *     dashboard, which is exactly what we are trying to avoid.
 */

export type TeachingBlockKind =
  | 'definition'
  | 'keyIdea'
  | 'example'
  | 'workedExample'
  | 'important'
  | 'warning'
  | 'note'
  | 'commonMistake'
  | 'explanation'
  | 'intuition'
  | 'summary'
  | 'overview'

export interface TeachingBlockSpec {
  kind: TeachingBlockKind
  /** Render as a bordered semantic block rather than a plain heading. */
  boxed: boolean
  /** Localised label — a block type is UI chrome, not lesson content. */
  labelKey: TranslationKey
  icon: LucideIcon
}

/**
 * Heading text that identifies each block, in both teaching languages. The
 * lesson is written in the tutor language, which may differ from the UI
 * language, so both are matched.
 */
const KEYWORDS: Record<TeachingBlockKind, string[]> = {
  definition: ['definition', 'definitions', '定义', '概念定义'],
  keyIdea: ['key idea', 'key ideas', 'key concept', 'key concepts', 'core idea', '核心概念', '关键概念', '要点'],
  example: ['example', 'examples', '示例', '例子', '例题', '举例'],
  workedExample: ['worked example', 'worked examples', '详细示例', '解题示例', '例题解析'],
  important: ['important', 'important note', '重要提示', '重要', '重点'],
  warning: ['warning', 'warnings', 'caution', '警告', '注意'],
  note: ['note', 'notes', 'remark', 'remarks', '备注', '说明', '注'],
  commonMistake: [
    'common mistake',
    'common mistakes',
    'common error',
    'common errors',
    'pitfall',
    'pitfalls',
    '常见错误',
    '常见误区',
    '易错点',
  ],
  explanation: ['explanation', 'explanations', '解释', '讲解', '说明'],
  intuition: ['intuition', 'intuition behind it', '直观理解', '直觉', '直观'],
  summary: ['summary', 'summaries', '总结', '小结'],
  overview: ['overview', '概述', '导览'],
}

const SPECS: Record<TeachingBlockKind, Omit<TeachingBlockSpec, 'kind'>> = {
  definition: { boxed: true, labelKey: 'teach.definition', icon: BookMarked },
  keyIdea: { boxed: true, labelKey: 'teach.keyIdea', icon: Lightbulb },
  example: { boxed: true, labelKey: 'teach.example', icon: PencilLine },
  workedExample: { boxed: true, labelKey: 'teach.workedExample', icon: ListChecks },
  important: { boxed: true, labelKey: 'teach.important', icon: AlertTriangle },
  warning: { boxed: true, labelKey: 'teach.warning', icon: AlertTriangle },
  note: { boxed: true, labelKey: 'teach.note', icon: Info },
  commonMistake: { boxed: true, labelKey: 'teach.commonMistake', icon: OctagonAlert },
  explanation: { boxed: false, labelKey: 'teach.explanation', icon: Info },
  intuition: { boxed: false, labelKey: 'teach.intuition', icon: Lightbulb },
  summary: { boxed: false, labelKey: 'teach.summary', icon: Info },
  overview: { boxed: false, labelKey: 'teach.overview', icon: Info },
}

/**
 * Normalise a heading for matching: drop emphasis markers, heading hashes, a
 * trailing colon and collapse whitespace, then lowercase.
 */
export function normalizeHeadingText(heading: string): string {
  return heading
    .replace(/[#*_`]/g, ' ')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const LOOKUP: Map<string, TeachingBlockKind> = (() => {
  const map = new Map<string, TeachingBlockKind>()
  for (const [kind, keywords] of Object.entries(KEYWORDS) as [TeachingBlockKind, string[]][]) {
    for (const keyword of keywords) map.set(keyword, kind)
  }
  return map
})()

/** Identify the teaching block a heading introduces, if any. */
export function classifyTeachingBlock(heading: string): TeachingBlockSpec | undefined {
  const normalized = normalizeHeadingText(heading)
  if (!normalized) return undefined
  const kind = LOOKUP.get(normalized)
  if (!kind) return undefined
  return { kind, ...SPECS[kind] }
}

/**
 * True when a paragraph is really a heading the model wrote as bold text, e.g.
 * `**Intuition:**`. The prompt forbids this, but older cached lessons and the
 * occasional model slip still produce it — showing it as a literal `**…**`
 * paragraph would look broken, so it is promoted instead.
 */
export function asPseudoHeading(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes('\n')) return undefined
  const match = /^\*\*(.+?)\*\*:?$/.exec(trimmed)
  if (!match) return undefined
  const inner = stripTrailingColon(match[1] ?? '')
  if (!inner) return undefined
  return classifyTeachingBlock(inner) ? inner : undefined
}

/** `Intuition:` -> `Intuition` (handles both ASCII and full-width colons). */
export function stripTrailingColon(text: string): string {
  return text.trim().replace(/[：:]\s*$/, '').trim()
}
