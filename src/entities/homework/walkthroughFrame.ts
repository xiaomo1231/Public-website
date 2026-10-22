/**
 * The opening (必须掌握的工具) and summary of a walkthrough, written in pieces.
 *
 * Each part is its own request; when a part is too long for one reply it is
 * asked for one group of questions at a time and the pieces are merged here:
 * the opening's tools by name (first wording kept), the summary's kinds by
 * name (question labels united), ideas and suggestions without repeats.
 * Pure functions, so the merge is testable on its own.
 */
import type {
  FrameKind,
  FrameTool,
  NormalizedOverviewPart,
  NormalizedSummaryPart,
} from '@/infrastructure/ai/prompts/homework-walkthrough/v5'
import type { WalkthroughLanguage } from './walkthrough'

const MAX_TOOLS = 16
const MAX_IDEAS = 4
const MAX_SUGGESTIONS = 6

/** Name / sentence key that ignores case, spacing, punctuation and maths delimiters. */
export function frameKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s$*_`#.,;:!?，。；：！？、（）()[\]【】「」"'“”‘’-]+/g, '')
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (k && seen.has(k)) continue
    if (k) seen.add(k)
    out.push(item)
  }
  return out
}

export function mergeOverviews(pieces: NormalizedOverviewPart[]): NormalizedOverviewPart {
  const intro = uniqueBy(pieces.map((piece) => piece.intro).filter(Boolean), frameKey).join('\n\n')
  const tools: FrameTool[] = []
  const byName = new Map<string, FrameTool>()
  for (const tool of pieces.flatMap((piece) => piece.tools)) {
    const key = frameKey(tool.name || tool.body)
    const existing = key ? byName.get(key) : undefined
    if (existing) {
      // The same tool from another group: keep the fuller explanation.
      if (tool.body.length > existing.body.length) existing.body = tool.body
      continue
    }
    const copy = { ...tool }
    if (key) byName.set(key, copy)
    tools.push(copy)
  }
  return { intro, tools: tools.slice(0, MAX_TOOLS) }
}

export function mergeSummaries(pieces: NormalizedSummaryPart[]): NormalizedSummaryPart {
  const kinds: FrameKind[] = []
  const byName = new Map<string, FrameKind>()
  for (const kind of pieces.flatMap((piece) => piece.kinds)) {
    const key = frameKey(kind.name)
    const existing = byName.get(key)
    if (existing) {
      for (const label of kind.questions)
        if (!existing.questions.includes(label)) existing.questions.push(label)
      if (!existing.note && kind.note) existing.note = kind.note
      continue
    }
    const copy = { ...kind, questions: [...kind.questions] }
    byName.set(key, copy)
    kinds.push(copy)
  }
  return {
    text: uniqueBy(pieces.map((piece) => piece.text).filter(Boolean), frameKey).join('\n\n'),
    kinds,
    ideas: uniqueBy(
      pieces.flatMap((piece) => piece.ideas),
      frameKey,
    ).slice(0, MAX_IDEAS),
    suggestions: uniqueBy(
      pieces.flatMap((piece) => piece.suggestions),
      frameKey,
    ).slice(0, MAX_SUGGESTIONS),
  }
}

const HEADINGS = {
  zh: { kind: '类型', questions: '题目', note: '怎么认出', ideas: '最值得记住的' },
  en: {
    kind: 'Kind',
    questions: 'Questions',
    note: 'How to recognise it',
    ideas: 'Worth remembering',
  },
} as const

function headings(language: WalkthroughLanguage) {
  // 跟随考试语言 (`exam:<code>`) writes in a non-Chinese exam language.
  return language === 'en' || language.startsWith('exam:') ? HEADINGS.en : HEADINGS.zh
}

function cell(value: string): string {
  return value.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()
}

/** The opening as Markdown: intro, then one `###` per tool. */
export function renderOverview(overview: NormalizedOverviewPart): string {
  const tools = overview.tools.map((tool) =>
    tool.name ? `### ${tool.name}\n\n${tool.body}`.trim() : tool.body,
  )
  return [overview.intro, ...tools].filter(Boolean).join('\n\n')
}

/** The summary as Markdown (kinds table + ideas) and its review suggestions. */
export function renderSummary(
  summary: NormalizedSummaryPart,
  language: WalkthroughLanguage,
): { body: string; suggestions: string[] } {
  const h = headings(language)
  const blocks: string[] = []
  if (summary.text) blocks.push(summary.text)
  if (summary.kinds.length > 0) {
    const withNotes = summary.kinds.some((kind) => kind.note)
    const header = withNotes
      ? `| ${h.kind} | ${h.questions} | ${h.note} |\n|---|---|---|`
      : `| ${h.kind} | ${h.questions} |\n|---|---|`
    const rows = summary.kinds.map((kind) =>
      withNotes
        ? `| ${cell(kind.name)} | ${cell(kind.questions.join(', '))} | ${cell(kind.note)} |`
        : `| ${cell(kind.name)} | ${cell(kind.questions.join(', '))} |`,
    )
    blocks.push([header, ...rows].join('\n'))
  }
  if (summary.ideas.length > 0)
    blocks.push(
      [`### ${h.ideas}`, '', ...summary.ideas.map((idea, i) => `${i + 1}. ${idea}`)].join('\n'),
    )
  return { body: blocks.join('\n\n'), suggestions: summary.suggestions }
}

/** Split `items` into two halves (the first one larger). */
export function halves<T>(items: readonly T[]): [T[], T[]] {
  const middle = Math.ceil(items.length / 2)
  return [items.slice(0, middle), items.slice(middle)]
}
