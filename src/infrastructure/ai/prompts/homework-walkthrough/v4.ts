/**
 * v4 of the homework walkthrough prompts.
 *
 * Adds, on top of v3:
 *  - the fixed step format and emphasis rules (`{ steps: true }` on the
 *    question and sub-part system prompts): one row-operation step is written
 *    as one line naming the operation, followed by the resulting matrix, so
 *    the page can show it as a step card and check it element by element;
 *    terms are bold only where they first appear, at most two key results per
 *    paragraph are bold, never whole sentences;
 *  - the 普通版 / 详细版 variant request: the missing level of a section (or
 *    of one sub-part) is written FROM the existing one, keeping its
 *    conclusion, notation and step order and changing only how much is shown.
 *
 * Without those options every prompt is byte-identical to v3 (and so to v2 /
 * v1), and section hashes keep `CACHE_VERSION = 'v1'`: existing walkthroughs
 * are not marked out of date.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import * as V1 from './v1'
import * as V3 from './v3'

export * from './v3'
export const VERSION = 'v4' as const

/** How one row-operation step is written, so the page can recognise it. */
export const STEP_FORMAT_RULE =
  'Write every row-reduction step as its own line that starts with the operation(s) of that step, e.g. "作 $R_3 \\to R_3 - 3R_1 - 2R_2$：" (in English: "Apply $R_3 \\to R_3 - 3R_1 - 2R_2$:"), several operations of one step separated by commas inside separate $…$, followed on the next line by the complete resulting matrix as its own display formula $$…$$. The operations of one line are applied together to the matrix shown just before. Put any explanation of why the step is chosen in the sentence before that line.'

/** Weight is used sparingly so it still points at something. */
export const EMPHASIS_RULE =
  'Bold (**…**) a technical term only where it first appears in the section; bold at most two key results per paragraph (e.g. **the system has no solution**); never bold a whole sentence.'

/** At the end of every sub-part, its final answer. */
export const FINAL_ANSWER_RULE =
  'End every sub-part with its final answer in \\boxed{…} (a short display formula or one sentence).'

export type WalkthroughLevel = 'standard' | 'detailed'

/** Append rules just before the security footer (the last line). */
function beforeFooter(prompt: string, rules: string[]): string {
  const footer = securityFooter()
  const index = prompt.lastIndexOf(footer)
  if (index < 0) return [prompt, ...rules].join('\n')
  return `${prompt.slice(0, index)}${rules.join('\n')}\n${prompt.slice(index)}`
}

export function buildQuestionSystemPrompt(options: {
  linearSystems: boolean
  analysis?: boolean
  /** v4: the fixed step format, emphasis and final-answer rules. */
  steps?: boolean
}): string {
  const base = V3.buildQuestionSystemPrompt({
    linearSystems: options.linearSystems,
    ...(options.analysis ? { analysis: true } : {}),
  })
  return options.steps
    ? beforeFooter(base, [STEP_FORMAT_RULE, EMPHASIS_RULE, FINAL_ANSWER_RULE])
    : base
}

export function buildPartSystemPrompt(options: {
  linearSystems: boolean
  punctuation?: boolean
  /** v4: the fixed step format, emphasis and final-answer rules. */
  steps?: boolean
}): string {
  const base = V3.buildPartSystemPrompt({
    linearSystems: options.linearSystems,
    ...(options.punctuation ? { punctuation: true } : {}),
  })
  return options.steps
    ? beforeFooter(base, [STEP_FORMAT_RULE, EMPHASIS_RULE, FINAL_ANSWER_RULE])
    : base
}

// --- 普通版 / 详细版 ----------------------------------------------------------

const LEVEL_RULES: Record<WalkthroughLevel, string> = {
  detailed:
    'Write the DETAILED VERSION: expand every step the existing version shows in one go. For a row operation write each changed entry as its own small calculation (e.g. third column: $1 - 3\\cdot 2 - 2\\cdot 0 = -5$) and show the complete matrix after every operation; write fractions out, bring them to a common denominator and reduce them explicitly; in any other kind of question fill in every skipped algebraic or numerical step the same way.',
  standard:
    'Write the STANDARD VERSION: keep every step and result of the existing version but leave out the element-by-element calculations, so each step is its operation followed by the resulting matrix or expression.',
}

/**
 * Write one section (or one sub-part) at the other level of detail, from the
 * version that already exists.
 */
export function buildVariantSystemPrompt(options: {
  linearSystems: boolean
  level: WalkthroughLevel
  /** One sub-part of a question written part by part. */
  part?: boolean
}): string {
  const what = options.part ? 'ONE sub-part of one question' : 'one question'
  return [
    `You are rewriting ${what} of a complete, document-style walkthrough of a university homework assignment at a different level of detail. The existing version is given; the reader switches between the two versions, so they must agree.`,
    'Return strictly valid JSON:',
    options.linearSystems
      ? '{"status":"ready","conclusion":"...","body":"...","linearSystems":[{"label":"(a)","augmented":[["1","2","3"]],"rref":[["1","0","-19/5"]],"solution":"none|unique|infinite"}]}'
      : '{"status":"ready","conclusion":"...","body":"..."}',
    'or {"status":"insufficient","reason":"specific missing information"}.',
    LEVEL_RULES[options.level],
    'Keep the conclusion, every result, the notation, the step order and the headings of the existing version exactly; change only how much of each step is shown. Do not add new methods or new parts.',
    '"conclusion": the same final answer as the existing version.',
    options.part
      ? '"body": Markdown for this sub-part only. Do not use #, ## or ### headings; use #### only where the existing version does.'
      : '"body": Markdown. Use the same "### (a) …" sub-headings as the existing version. Do not use # or ## headings.',
    ...V1.NOTATION_RULES,
    options.linearSystems
      ? '"linearSystems": for every linear system you row-reduce, give the full augmented matrix you start from and the final RREF you reached, as arrays of rows of strings (integers or fractions such as "-19/5"), and whether it has no, a unique or infinitely many solutions. Use an empty array when there is no row reduction. These are checked against your body, so they must match it exactly.'
      : '',
    STEP_FORMAT_RULE,
    EMPHASIS_RULE,
    V3.PUNCTUATION_RULE,
    'If the existing version contains a mistake, correct it and keep everything else consistent; never invent a condition, figure detail or citation.',
    'Do not grade the student. No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ]
    .filter(Boolean)
    .join('\n')
}

export interface WalkthroughVariantInput {
  label: string
  question: string
  sourceText: string
  language: V1.WalkthroughPromptLanguage
  level: WalkthroughLevel
  /** The version that exists (the other level). */
  existing: { conclusion?: string; body: string }
  /** Sub-part being rewritten, e.g. `b`, with its heading. */
  part?: string
  heading?: string
  professorAnswer?: string
  /** Rewriting this level again: its current text and the student's request. */
  revision?: { current?: { conclusion?: string; body: string }; suggestion?: string }
}

const EXISTING_CHARS = 16_000
const MAX_SUGGESTION_CHARS = 1_000

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value
}

function versionText(version: { conclusion?: string; body: string }): string {
  return clip(
    [version.conclusion?.trim() ? `Conclusion: ${version.conclusion.trim()}` : '', version.body]
      .filter(Boolean)
      .join('\n\n'),
    EXISTING_CHARS,
  )
}

export function buildVariantUserPrompt(input: WalkthroughVariantInput): string {
  const other = input.level === 'detailed' ? 'STANDARD' : 'DETAILED'
  const suggestion = input.revision?.suggestion?.trim().slice(0, MAX_SUGGESTION_CHARS)
  return [
    V1.languageRule(input.language),
    input.part
      ? `This request is for question ${input.label}, sub-part (${input.part})${input.heading ? ` "${input.heading}"` : ''} only.`
      : `This section is for question ${input.label}.`,
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
    untrustedContentWrapper(`EXISTING ${other} VERSION`, versionText(input.existing)),
    input.revision?.current?.body.trim()
      ? untrustedContentWrapper(
          `CURRENT ${input.level === 'detailed' ? 'DETAILED' : 'STANDARD'} VERSION TO REWRITE`,
          versionText(input.revision.current),
        )
      : '',
    suggestion ? untrustedContentWrapper('STUDENT REVISION REQUEST', suggestion) : '',
    suggestion
      ? 'Follow the student’s request where it is sound; keep every result correct and consistent with the existing version. Return the complete section.'
      : '',
    `Write the ${input.level === 'detailed' ? 'DETAILED' : 'STANDARD'} version now.`,
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export { normalizeQuestionSection as normalizeVariant } from './v1'
