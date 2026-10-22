/**
 * 小题 ⇄ 教授答案对应: say, for every sub-part of ONE homework question, which
 * excerpts of the professor's confirmed answer cover it — `direct` (a
 * solution written for that sub-part), `indirect` (content elsewhere in the
 * answer that establishes it) or `none`. A sub-part's solution written under
 * another sub-part's heading is `direct` (misplaced), not an alternative
 * method, unless it clearly solves the same sub-part twice. The model only
 * locates; it never solves.
 *
 * The reply is checked locally (`entities/homework/professorMap.ts`
 * `validateProfessorMap`): labels must be the question's sub-parts, every
 * excerpt must occur verbatim in the answer, and `direct` / `indirect`
 * follow where the excerpts actually are. The checked map is then given to
 * the answer-based hints (`homework-question/v5`), the walkthrough
 * (`homework-walkthrough/v9`) and the comparison (`walkthrough-compare/v2`)
 * through `professorMapBlock`.
 */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'professor-answer-map' as const

export function buildSystemPrompt(): string {
  return [
    'You map a professor’s confirmed answer onto the sub-parts of ONE university homework question. You only locate content; do not solve, judge or rewrite anything.',
    'Return strictly valid JSON:',
    '{"subparts":[{"label":"a","coverage":"direct|indirect|none","quotes":["..."],"note":"..."}]}',
    '"subparts": exactly one entry per sub-part listed in the user message, in that order, with the label exactly as listed (a letter such as "a", or a number such as "1").',
    'Read the WHOLE professor answer before deciding. Its headings do not always match the question: the answer may restate the question first; a sub-part’s solution may be MISPLACED under another sub-part’s heading — a nested label that equals one of the question’s sub-parts (e.g. "(a) This is true because …" inside the solution under (b)) usually IS the solution of that sub-part, written in the wrong place. Treat such nested labels as alternative methods of the enclosing sub-part only when their content clearly solves that same sub-part twice. The LOCAL SEGMENTATION list (a hint) shows each piece with the label it carries and the heading it is written under.',
    'coverage — "direct": the answer contains a solution written for this sub-part, wherever it is placed (also under another sub-part’s heading — say so in "note"). "indirect": no solution is written for this sub-part, but other content (written for another sub-part) establishes what it asks; say where in "note". "none": no part of the answer covers it — including a sub-part the professor explicitly leaves to the student ("I leave the first part to you"). A line that only restates the question is not a solution.',
    '"quotes": 1 to 3 excerpts copied EXACTLY from the professor answer (same words, symbols and order; whitespace may differ) that cover the sub-part, each at most 300 characters; to cover a longer passage write its beginning and its end joined by " … ". Never quote the restated question. Empty for "none".',
    '"note": one short sentence in English (e.g. "Method 1 inside (b) writes W as a span, which shows (a)."); may be empty.',
    'No prose outside JSON and no Markdown fence.',
    securityFooter(),
  ].join('\n')
}

export interface ProfessorMapSegmentHint {
  id: string
  /** e.g. `the professor's (a), written under the heading of (b)` or `(c)`. */
  where: string
  /** The first words of the segment. */
  start: string
  restatedOnly?: boolean
}

export interface ProfessorMapUserInput {
  question: string
  parts: Array<{ label: string; text: string }>
  /** Cleaned of extraction artifacts (`cleanProfessorAnswerText`). */
  professorAnswer: string
  segments: ProfessorMapSegmentHint[]
}

const ANSWER_CHARS = 16_000

function partName(label: string): string {
  return /^\d+$/.test(label) ? `${label}.` : `(${label})`
}

export function buildUserPrompt(input: ProfessorMapUserInput): string {
  const segments = input.segments
    .map(
      (segment) =>
        `${segment.id}: ${segment.where}${segment.restatedOnly ? ' — restated question only' : ''} — starts "${segment.start}"`,
    )
    .join('\n')
  const answer =
    input.professorAnswer.length > ANSWER_CHARS
      ? `${input.professorAnswer.slice(0, ANSWER_CHARS)}\n…`
      : input.professorAnswer
  return [
    `Sub-parts of the question: ${input.parts.map((part) => partName(part.label)).join(', ')}. Use the labels ${input.parts.map((part) => `"${part.label}"`).join(', ')}.`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    untrustedContentWrapper('CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION', answer),
    untrustedContentWrapper(
      'LOCAL SEGMENTATION OF THE PROFESSOR ANSWER (a hint; may be wrong)',
      segments,
    ),
    'Return JSON only.',
  ].join('\n')
}

export interface RawProfessorMapEntry {
  label: string
  coverage: string
  quotes: string[]
  note?: string
}

/** Shape check only; `validateProfessorMap` decides what is kept. */
export function normalizeMapReply(raw: unknown): RawProfessorMapEntry[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const list = (raw as Record<string, unknown>).subparts
  if (!Array.isArray(list)) return null
  const out: RawProfessorMapEntry[] = []
  for (const value of list.slice(0, 30)) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const label =
      typeof item.label === 'number'
        ? String(item.label)
        : typeof item.label === 'string'
          ? item.label
          : ''
    const coverage = typeof item.coverage === 'string' ? item.coverage.trim().toLowerCase() : ''
    const quotes = Array.isArray(item.quotes)
      ? item.quotes.filter((quote): quote is string => typeof quote === 'string')
      : typeof item.quotes === 'string'
        ? [item.quotes]
        : []
    const note = typeof item.note === 'string' ? item.note : undefined
    out.push({ label, coverage, quotes, ...(note ? { note } : {}) })
  }
  return out
}

// --- The checked map, as the writing prompts show it ----------------------------

export interface ProfessorMapPromptEntry {
  label: string
  coverage: 'direct' | 'indirect' | 'none'
  quotes: string[]
  /** Where the excerpt is, in words (e.g. "the professor's (a), written under the heading of (b)"). */
  from?: string
  note?: string
}

export const MAP_BLOCK_LABEL =
  'PROFESSOR ANSWER MAP (every excerpt below was checked to occur in the professor answer)'

/** The checked map as one wrapped block (the excerpts are document text). */
export function professorMapBlock(entries: readonly ProfessorMapPromptEntry[]): string {
  const lines: string[] = []
  for (const entry of entries) {
    const head = `${partName(entry.label)} ${entry.coverage}${entry.from ? ` — from ${entry.from}` : ''}${entry.note ? ` — ${entry.note}` : ''}`
    lines.push(head)
    for (const quote of entry.quotes) lines.push(`  > ${quote.replace(/\s*\n\s*/g, ' ')}`)
  }
  return untrustedContentWrapper(MAP_BLOCK_LABEL, lines.join('\n'))
}

/** The rules that go with the map, for a writer of hints / solutions / a walkthrough. */
export function professorMapRules(): string[] {
  return [
    'A PROFESSOR ANSWER MAP is given in the user message. It was checked against the professor answer and is authoritative: it says, for each sub-part, which excerpts of the professor answer cover it — "direct" (the professor’s solution for that sub-part), "indirect" (content written for another sub-part that establishes it) or "none" (the professor answer does not cover it). Sub-parts missing from the map are mapped by meaning.',
    '- "direct": follow that excerpt (method, steps, notation, answer form) — also when the map says it is written under another sub-part’s heading (the professor placed it there; it is still this sub-part’s solution).',
    '- "indirect": build this sub-part on that excerpt — the same method and result — and say in one short line where it comes from, e.g. "教授在 (b) 的解答中把 W 写成 span{…}，由此可知 W 是子空间。" when writing Chinese or "The professor shows this in the solution of (b): W is written as a span, so it is a subspace." when writing English. Never say the professor gave no solution for an "indirect" sub-part.',
    '- "none" ONLY: write it yourself and start it with one short line saying the professor answer gives no solution for it (e.g. "教授答案未给出此小题的解答，以下为讲解。" / "The professor’s answer gives no solution for this part; this is our own explanation.").',
  ]
}
