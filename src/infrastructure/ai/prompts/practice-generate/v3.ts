/**
 * practice-generate v3: significant figures and professor conventions.
 *  - `buildSystemPrompt({ sigFigs: true })` (chemistry / physics, or a
 *    professor who grades significant figures): the numeric check may carry
 *    `"sigFigs": n`, the number of significant figures the answer must have;
 *    the app judges value, unit and significant figures separately.
 *  - `professorConventions` in the user input: marks per sub-part, a data
 *    sheet, context stories (the same conventions as quiz-generator v9).
 * Without them the prompts are v2's word for word. v2 is kept unchanged.
 */
import * as V2 from './v2'

export * from './v2'
export const VERSION = 'v3' as const

export type PracticeConvention =
  'none_of_above' | 'marks_per_part' | 'data_sheet' | 'context_story' | 'sig_figs'

export interface PracticeGenerateInput extends V2.PracticeGenerateInput {
  professorConventions?: PracticeConvention[]
}

const NUMERIC_CHECK =
  '  {"type":"numeric","expression":"(12.5*3)/2","unit":"m/s"} when the answer is one number: a plain arithmetic expression (numbers, + - * / ^, sqrt, sin, cos, exp, log, pi, e; no variables) that evaluates to it, and the unit in the answer if any ("" when none);'

const SIG_FIGS =
  '  For an answer computed from measured data, add "sigFigs": the number of significant figures it must have (as many as the least precise datum for products and quotients, or as the question states); write "answer" with exactly that many significant figures. Omit it for exact or counted values.'

export function buildSystemPrompt(options: { sigFigs?: boolean } = {}): string {
  const base = V2.buildSystemPrompt()
  if (!options.sigFigs || !base.includes(NUMERIC_CHECK)) return base
  return base.replace(NUMERIC_CHECK, `${NUMERIC_CHECK}\n${SIG_FIGS}`)
}

const CONVENTION_LINES: Record<Exclude<PracticeConvention, 'none_of_above'>, string> = {
  marks_per_part:
    'Show the marks of each question or sub-part the way this professor does (e.g. "(2 marks)").',
  data_sheet:
    "This professor's students have a data / formula sheet: do not restate standard constants or formulas it contains.",
  context_story:
    'Like this professor, set calculation questions in a short realistic context that may include a detail not needed for the answer; the data needed must still be complete.',
  sig_figs:
    'This professor grades significant figures strictly: state the required significant figures for every answer computed from measured data and give "sigFigs" in its check.',
}

export function buildUserPrompt(input: PracticeGenerateInput): string {
  const { professorConventions, ...rest } = input
  const base = V2.buildUserPrompt(rest)
  const lines = (professorConventions ?? [])
    .filter(
      (convention): convention is Exclude<PracticeConvention, 'none_of_above'> =>
        convention !== 'none_of_above',
    )
    .map((convention) => `- ${CONVENTION_LINES[convention]}`)
  if (lines.length === 0) return base
  return `${base}\n\n${['PROFESSOR CONVENTIONS:', ...lines].join('\n')}`
}
