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
  /**
   * The heading names the block *and* says what it is about
   * (`## Example 2: Solving a 3×3 system`, `## 定义 1.2（行阶梯形）`). The
   * heading's own text is then kept as the block's title (it may contain
   * maths), and the localised block label is shown as a small kicker.
   */
  titled?: boolean
}

/**
 * Heading text that identifies each block, in both teaching languages. The
 * lesson is written in the tutor language, which may differ from the UI
 * language, so both are matched.
 */
const KEYWORDS: Record<TeachingBlockKind, string[]> = {
  definition: ['definition', 'definitions', '定义', '概念定义'],
  keyIdea: [
    'key idea',
    'key ideas',
    'key concept',
    'key concepts',
    'core idea',
    'main idea',
    'main ideas',
    'big idea',
    '核心概念',
    '关键概念',
    '核心思想',
    '关键思想',
    '关键要点',
    '要点',
  ],
  example: ['example', 'examples', '示例', '例子', '例题', '举例', '例'],
  workedExample: [
    'worked example',
    'worked examples',
    'worked-out example',
    'step-by-step example',
    '详细示例',
    '解题示例',
    '例题解析',
    '例题详解',
    '典型例题',
  ],
  important: ['important', 'important note', '重要提示', '重要', '重点'],
  warning: ['warning', 'warnings', 'caution', '警告', '注意'],
  note: [
    'note',
    'notes',
    'remark',
    'remarks',
    'tip',
    'tips',
    '备注',
    '说明',
    '注',
    '提示',
    '小贴士',
  ],
  commonMistake: [
    'common mistake',
    'common mistakes',
    'common error',
    'common errors',
    'pitfall',
    'pitfalls',
    'common misconception',
    'common misconceptions',
    '常见错误',
    '常见误区',
    '常见误解',
    '易错点',
  ],
  explanation: ['explanation', 'explanations', '解释', '讲解', '说明'],
  intuition: [
    'intuition',
    'intuition behind it',
    'why it works',
    'why it matters',
    '直观理解',
    '直觉',
    '直观',
  ],
  summary: [
    'summary',
    'summaries',
    'key takeaway',
    'key takeaways',
    'takeaways',
    'recap',
    'in summary',
    '总结',
    '小结',
    '本节小结',
  ],
  overview: ['overview', 'introduction', '概述', '导览', '引言', '概览'],
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

/** Keywords longest first, so `worked example` wins over `example`. */
const PREFIXES: Array<[string, TeachingBlockKind]> = [...LOOKUP.entries()].sort(
  (a, b) => b[0].length - a[0].length,
)

/**
 * What may follow a keyword for the heading to still be that block:
 * a number (`Example 2`, `例1`), punctuation (`Definition:`, `定义（…）`,
 * `Example — …`) or, after a Latin keyword, a space and more words
 * (`Examples of linear systems`). A CJK keyword followed directly by another
 * character is a different word (`定义域` is "domain", not a definition).
 */
const AFTER_KEYWORD = /^(?:\s*[0-9０-９]|\s*[:：(（[【—–\-·.,，、|])/
const AFTER_LATIN_KEYWORD = /^\s+\S/

/** `1. Overview`, `2) Example`, `一、定义`, `第 3 节 小结` → the words after the numbering. */
function stripLeadingNumbering(text: string): string {
  return text.replace(/^(?:\d+(?:\.\d+)*[.)、]?|[一二三四五六七八九十]+[、.．])\s*/, '').trim()
}

/** Identify the teaching block a heading introduces, if any. */
export function classifyTeachingBlock(heading: string): TeachingBlockSpec | undefined {
  const normalized = normalizeHeadingText(heading)
  if (!normalized) return undefined
  const exact = LOOKUP.get(normalized) ?? LOOKUP.get(stripLeadingNumbering(normalized))
  if (exact) return { kind: exact, ...SPECS[exact] }

  // `Example 2: Solving a system`, `定义 1.2（行阶梯形）`: the block is
  // recognised and the heading keeps its own words as the title.
  const text = stripLeadingNumbering(normalized)
  for (const [keyword, kind] of PREFIXES) {
    // Only the boxed blocks: a plain section heading ("Summary of the row
    // operations") already reads correctly as the heading it is.
    if (!SPECS[kind].boxed) continue
    if (!text.startsWith(keyword) || text.length === keyword.length) continue
    const rest = text.slice(keyword.length)
    const latin = /[a-z]$/.test(keyword)
    if (AFTER_KEYWORD.test(rest) || (latin && AFTER_LATIN_KEYWORD.test(rest))) {
      return { kind, ...SPECS[kind], titled: true }
    }
  }
  return undefined
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
  return text
    .trim()
    .replace(/[：:]\s*$/, '')
    .trim()
}
