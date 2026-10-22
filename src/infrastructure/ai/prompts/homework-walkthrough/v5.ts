/**
 * v5 of the homework walkthrough prompts.
 *
 * Adds, on top of v4: the opening (必须掌握的工具) and the summary are written
 * by two separate, smaller requests instead of one, and each can cover only a
 * group of the questions. A group too long for one reply is split further and
 * the pieces are merged locally (`entities/homework/walkthroughFrame.ts`), so
 * both parts come back structured: the opening as a list of tools, the
 * summary as kinds / ideas / suggestions.
 *
 * Question and sub-part prompts are unchanged (byte-identical to v4), and
 * section hashes keep `CACHE_VERSION = 'v1'`: ready openings and summaries
 * are not marked out of date by the upgrade.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import * as V1 from './v1'
import * as V2 from './v2'
import * as V3 from './v3'

export * from './v4'
export const VERSION = 'v5' as const

export type FramePart = 'overview' | 'summary'

const MAX_TEXT = 40_000

function overviewSystemPrompt(): string {
  return [
    'You are writing the opening and the closing of a complete, document-style walkthrough of a university homework assignment — in this request ONLY the opening (the tools the assignment relies on). The worked sections for each question are already written; you see each question with its conclusion and the key points of its section.',
    'Return strictly valid JSON: {"status":"ready","intro":"...","tools":[{"name":"...","body":"..."}]}',
    '"intro": one or two sentences on what these questions practise (may be empty).',
    '"tools": the definitions, rules, standard procedures and how to read a result that the questions rely on — one entry per tool, in the order a reader needs them, so the reader can follow every section. "name" is a short title without Markdown heading marks; "body" is Markdown: short numbered lists and, when it helps, a small table (for example "what the result looks like | conclusion"). Do not solve the questions here.',
    'Keep it compact: at most eight tools, each body a few short lines. Never use # headings inside a body.',
    ...V1.NOTATION_RULES,
    V3.PUNCTUATION_RULE,
    'Base everything on the questions and conclusions given; never invent a question, result or citation.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

function summarySystemPrompt(): string {
  return [
    'You are writing the opening and the closing of a complete, document-style walkthrough of a university homework assignment — in this request ONLY the closing summary. The worked sections for each question are already written; you see each question with its conclusion and the key points of its section.',
    'Return strictly valid JSON: {"status":"ready","kinds":[{"name":"...","questions":["..."],"note":"..."}],"ideas":["..."],"suggestions":["..."]}',
    '"kinds": when the questions fall into kinds (by result or by method), one entry per kind — "name" names the kind, "questions" lists the labels of THIS assignment’s questions of that kind exactly as given, "note" is one short line on how to recognise it. An empty list when they do not fall into kinds.',
    '"ideas": the two or three ideas most worth remembering, one or two Markdown sentences each.',
    '"suggestions": two to four concrete review actions, each naming a question by its label and saying why to redo it (e.g. "Close the answers and redo 2(a): the typical no-solution case").',
    'Never use # headings inside a field.',
    ...V1.NOTATION_RULES,
    V3.PUNCTUATION_RULE,
    'Base everything on the questions and conclusions given; never invent a question, result or citation.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export function buildFramePartSystemPrompt(options: { part: FramePart }): string {
  return options.part === 'overview' ? overviewSystemPrompt() : summarySystemPrompt()
}

export interface FramePartGroup {
  /** 1-based position of this group. */
  index: number
  count: number
}

export function buildFramePartUserPrompt(input: {
  title: string
  questions: V3.WalkthroughFrameKeyPointsQuestion[]
  language: V1.WalkthroughPromptLanguage
  part: FramePart
  /** Only some of the questions: the others are covered by separate requests. */
  group?: FramePartGroup
  revision?: V2.SectionRevision
}): string {
  const what = input.part === 'overview' ? 'the opening (tools)' : 'the closing summary'
  const blocks = input.questions.map(keyPointsBlock).join('\n\n')
  const labels = input.questions.map((question) => question.label).join(', ')
  return [
    V1.languageRule(input.language),
    `Assignment: ${input.title}`,
    blocks,
    input.group
      ? `This request covers only questions ${labels} (group ${input.group.index} of ${input.group.count}); the other questions are handled by separate requests and the results are merged. Write ${what} for these questions only and name only these labels.`
      : '',
    input.revision ? V2.revisionBlock(input.revision, what) : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

function keyPointsBlock(question: V3.WalkthroughFrameKeyPointsQuestion): string {
  return [
    `Question ${question.label}`,
    untrustedContentWrapper(`QUESTION ${question.label}`, question.question),
    untrustedContentWrapper(`CONCLUSION ${question.label}`, question.conclusion),
    question.keyPoints
      ? untrustedContentWrapper(`KEY POINTS ${question.label}`, question.keyPoints)
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// --- Normalisation ----------------------------------------------------------

export interface FrameTool {
  name: string
  body: string
}

export interface NormalizedOverviewPart {
  intro: string
  tools: FrameTool[]
}

export interface FrameKind {
  name: string
  questions: string[]
  note: string
}

export interface NormalizedSummaryPart {
  /** Free Markdown, when the model wrote the summary as text. */
  text: string
  kinds: FrameKind[]
  ideas: string[]
  suggestions: string[]
}

function str(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown, max: number, limit: number): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => str(item, max))
        .filter(Boolean)
        .slice(0, limit)
    : []
}

function readyObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  return row.status !== undefined && row.status !== 'ready' ? null : row
}

/**
 * Split Markdown at its `###` headings into tools; text before the first
 * heading is the intro. Used when the model wrote the opening as one text.
 */
export function toolsFromMarkdown(markdown: string): NormalizedOverviewPart {
  const lines = markdown.split('\n')
  const intro: string[] = []
  const tools: FrameTool[] = []
  for (const line of lines) {
    const heading = /^#{2,4}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) tools.push({ name: heading[1]!.trim(), body: '' })
    else if (tools.length > 0) tools[tools.length - 1]!.body += `${line}\n`
    else intro.push(line)
  }
  return {
    intro: intro.join('\n').trim(),
    tools: tools.map((tool) => ({ name: tool.name, body: tool.body.trim() })),
  }
}

/** The opening request's reply (also accepts a single `overview` text). */
export function normalizeOverviewPart(raw: unknown): NormalizedOverviewPart | null {
  const row = readyObject(raw)
  if (!row) return null
  const tools: FrameTool[] = Array.isArray(row.tools)
    ? row.tools
        .map((item) => {
          if (typeof item === 'string') return { name: '', body: str(item) }
          if (!item || typeof item !== 'object') return null
          const tool = item as Record<string, unknown>
          return {
            name: str(tool.name ?? tool.title, 200).replace(/^#+\s*/, ''),
            body: str(tool.body ?? tool.content),
          }
        })
        .filter((tool): tool is FrameTool => tool !== null && Boolean(tool.name || tool.body))
    : []
  const intro = str(row.intro)
  if (tools.length > 0) return { intro, tools }
  const overview = str(row.overview)
  if (overview) {
    const parsed = toolsFromMarkdown(overview)
    return { intro: [intro, parsed.intro].filter(Boolean).join('\n\n'), tools: parsed.tools }
  }
  return intro ? { intro, tools: [] } : null
}

/** The summary request's reply (also accepts a single `summary` text). */
export function normalizeSummaryPart(raw: unknown): NormalizedSummaryPart | null {
  const row = readyObject(raw)
  if (!row) return null
  const kinds: FrameKind[] = Array.isArray(row.kinds)
    ? row.kinds
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const kind = item as Record<string, unknown>
          const questions = Array.isArray(kind.questions)
            ? kind.questions
                .map((label) => (typeof label === 'number' ? String(label) : str(label, 40)))
                .filter(Boolean)
                .slice(0, 40)
            : []
          return { name: str(kind.name, 300), questions, note: str(kind.note, 600) }
        })
        .filter((kind): kind is FrameKind => kind !== null && Boolean(kind.name))
        .slice(0, 12)
    : []
  const ideas = strings(row.ideas, 1_200, 6)
  const suggestions = strings(row.suggestions, 600, 6)
  const text = str(row.summary ?? row.text)
  if (kinds.length === 0 && ideas.length === 0 && !text) return null
  return { text, kinds, ideas, suggestions }
}
