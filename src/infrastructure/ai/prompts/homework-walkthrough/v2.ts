/**
 * v2 of the homework walkthrough prompts.
 *
 * Adds, on top of v1:
 *  - an optional `revision` block on the question-section and frame prompts
 *    (the student asked to rewrite one section, optionally with suggestions;
 *    the model sees the current version). Without a revision block every
 *    prompt is byte-identical to v1, so cached sections keep their hashes —
 *    see `CACHE_VERSION`.
 *  - sub-part prompts for long multipart questions, which are written one
 *    sub-part per request and joined locally.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import * as V1 from './v1'

export const VERSION = 'v2' as const
/**
 * The version folded into section input hashes. A section written without a
 * revision is produced by exactly the v1 prompts, so it stays `v1` and no
 * cached walkthrough is marked out of date by the upgrade.
 */
export const CACHE_VERSION = 'v1' as const

export type {
  NormalizedFrame,
  NormalizedQuestionSection,
  RawLinearSystem,
  WalkthroughFrameInput,
  WalkthroughFrameQuestion,
  WalkthroughPromptLanguage,
  WalkthroughQuestionInput,
} from './v1'
export {
  buildFrameSystemPrompt,
  buildQuestionSystemPrompt,
  normalizeFrame,
  normalizeQuestionSection,
} from './v1'

/** How much of the current version a revision request carries. */
const REVISION_CURRENT_CHARS = 12_000
const MAX_SUGGESTION_CHARS = 1_000

export interface SectionRevision {
  /** The section as it reads now (conclusion first for a question). */
  current?: { conclusion?: string; body: string }
  /** What the student asked to change; optional. */
  suggestion?: string
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value
}

function currentText(current: NonNullable<SectionRevision['current']>): string {
  return clip(
    [current.conclusion?.trim() ? `Conclusion: ${current.conclusion.trim()}` : '', current.body]
      .filter(Boolean)
      .join('\n\n'),
    REVISION_CURRENT_CHARS,
  )
}

/** The revision block: current version, student request, and the rule for using them. */
function revisionBlock(revision: SectionRevision, what: string): string {
  const suggestion = revision.suggestion?.trim().slice(0, MAX_SUGGESTION_CHARS)
  return [
    `The student asked for ${what} to be rewritten.`,
    revision.current?.body.trim()
      ? untrustedContentWrapper('CURRENT VERSION OF THIS SECTION', currentText(revision.current))
      : '',
    suggestion ? untrustedContentWrapper('STUDENT REVISION REQUEST', suggestion) : '',
    suggestion
      ? 'Revise the section following the student’s request where it is sound (more detail, different notation, an added explanation…). Keep every result mathematically correct and consistent with the question and, when given, the professor answer; if the request would make the work wrong, keep the correct work and say briefly why. Return the complete revised section, not only the changes.'
      : 'Write a fresh, clearer version of the section: re-check every step, keep every correct result, and return the complete section.',
  ]
    .filter(Boolean)
    .join('\n')
}

// --- One question -----------------------------------------------------------

export interface WalkthroughQuestionInputV2 extends V1.WalkthroughQuestionInput {
  revision?: SectionRevision
}

export function buildQuestionUserPrompt(input: WalkthroughQuestionInputV2): string {
  const { revision, ...rest } = input
  const base = V1.buildQuestionUserPrompt(rest)
  if (!revision) return base
  return insertBeforeReturn(base, revisionBlock(revision, 'this question’s section'))
}

// --- Opening and summary ----------------------------------------------------

export interface FrameRevision extends SectionRevision {
  /** The one field to rewrite; the other may come back unchanged. */
  target: 'overview' | 'summary'
}

export interface WalkthroughFrameInputV2 extends V1.WalkthroughFrameInput {
  revision?: FrameRevision
}

export function buildFrameUserPrompt(input: WalkthroughFrameInputV2): string {
  const { revision, ...rest } = input
  const base = V1.buildFrameUserPrompt(rest)
  if (!revision) return base
  const field = revision.target === 'overview' ? '"overview"' : '"summary" (with "suggestions")'
  return insertBeforeReturn(
    base,
    [
      revisionBlock(revision, `only the ${field} part`),
      `Rewrite only ${field}. Still return the full JSON object; the other field may be returned unchanged.`,
    ].join('\n'),
  )
}

function insertBeforeReturn(prompt: string, block: string): string {
  const tail = '\nReturn JSON only.'
  return prompt.endsWith(tail)
    ? `${prompt.slice(0, -tail.length)}\n${block}${tail}`
    : `${prompt}\n${block}`
}

// --- One sub-part of a long multipart question -------------------------------

export interface WalkthroughPartEarlier {
  label: string
  conclusion: string
  body: string
}

export interface WalkthroughPartInput extends V1.WalkthroughQuestionInput {
  /** The sub-part to write, e.g. `b`. */
  part: string
  /** Every sub-part of the question, in order. */
  parts: string[]
  /** Sub-parts already written (already truncated to a budget). */
  earlier: WalkthroughPartEarlier[]
  revision?: SectionRevision
}

export function buildPartSystemPrompt(options: { linearSystems: boolean }): string {
  return [
    'You are writing ONE sub-part of one question in a complete, document-style walkthrough of a university homework assignment. The question has several sub-parts; each is written in its own request and the page joins them in order.',
    'Return strictly valid JSON:',
    options.linearSystems
      ? '{"status":"ready","heading":"...","conclusion":"...","body":"...","linearSystems":[{"label":"(b)","augmented":[["1","2","3"]],"rref":[["1","0","-19/5"]],"solution":"none|unique|infinite"}]}'
      : '{"status":"ready","heading":"...","conclusion":"...","body":"..."}',
    'or {"status":"insufficient","reason":"specific missing information"}.',
    '"heading": a short title for this sub-part WITHOUT its label, e.g. "Is the system consistent?". The page shows the label.',
    '"conclusion": the final answer to this sub-part only, in one short line.',
    '"body": Markdown for this sub-part only: what is given and what is asked, the method and why it fits, every step of the work, how to read the result, and a quick check when one is possible. Do not repeat the other sub-parts; refer to an earlier result by its label instead of redoing it.',
    'Show each intermediate result the reader needs to follow the arithmetic — after every one or two operations, write the resulting matrix or expression.',
    'Keep the teaching voice short and concrete: say why a step is chosen rather than repeating textbook definitions.',
    'Do not use #, ## or ### headings; use #### only when this sub-part itself needs sub-headings.',
    'Keep notation and results consistent with the sub-parts already written.',
    ...V1.NOTATION_RULES,
    options.linearSystems
      ? '"linearSystems": for every linear system you row-reduce in this sub-part, give the full augmented matrix you start from and the final RREF you reached, as arrays of rows of strings (integers or fractions such as "-19/5"), and whether it has no, a unique or infinitely many solutions. Use an empty array when this sub-part has no row reduction. These are checked against your body, so they must match it exactly.'
      : '',
    'A confirmed professor answer is the reference for this question: follow its method and results for this sub-part, and never present your own added reasoning as the professor’s words.',
    'A previous AI solution is only a fallible aid. Check it; never copy an unsupported claim, and never invent a condition, figure detail or citation.',
    'If a necessary figure, symbol or value is unreadable and this sub-part cannot be derived reliably from the text, return status insufficient with a concrete reason instead of a guess.',
    'Do not grade the student. No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildPartUserPrompt(input: WalkthroughPartInput): string {
  const earlier = input.earlier
    .map((part) =>
      untrustedContentWrapper(
        `ALREADY WRITTEN (${part.label})`,
        [`Conclusion: ${part.conclusion}`, part.body].join('\n\n'),
      ),
    )
    .join('\n')
  return [
    V1.languageRule(input.language),
    `This request is for question ${input.label}, sub-part (${input.part}) only. The question's sub-parts are ${input.parts.map((part) => `(${part})`).join(', ')}. Write ONLY the part for (${input.part}).`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    input.sourceText.trim() && input.sourceText.trim() !== input.question.trim()
      ? untrustedContentWrapper('QUESTION SOURCE PASSAGES', input.sourceText)
      : '',
    input.professorAnswer?.trim()
      ? untrustedContentWrapper(
          'CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION',
          input.professorAnswer,
        )
      : '',
    input.previousSolution?.trim()
      ? untrustedContentWrapper('PREVIOUS AI WORKED SOLUTION (UNVERIFIED)', input.previousSolution)
      : '',
    earlier,
    input.revision ? revisionBlock(input.revision, `sub-part (${input.part})`) : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface NormalizedPart {
  status: 'ready'
  heading: string
  conclusion: string
  body: string
  linearSystems: V1.RawLinearSystem[]
}

export function normalizePart(
  raw: unknown,
): NormalizedPart | { status: 'insufficient'; reason: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const base = V1.normalizeQuestionSection(raw)
  if (!base) return null
  if (base.status === 'insufficient') return base
  const heading = typeof row.heading === 'string' ? row.heading.trim().slice(0, 200) : ''
  return {
    status: 'ready',
    heading,
    conclusion: base.conclusion,
    body: base.body,
    linearSystems: base.linearSystems,
  }
}
