/**
 * question-style v2: v1 with five more habit categories that matter for
 * university chemistry and physics exams:
 *   options    — conventions of the choice options (a final "None of the
 *                options are correct" choice, A–F);
 *   marks      — marks shown per question / sub-part;
 *   data_sheet — the students work with a provided data / formula sheet;
 *   sig_figs   — how strictly significant figures are graded;
 *   context    — context stories, including details not needed for the answer.
 * Question generators follow these explicitly (`professorConventions`). The
 * user prompt and the output are v1's. v1 is kept unchanged.
 */
import * as V1 from './v1'

export * from './v1'
export const VERSION = 'v2' as const

const AFTER = '  difficulty — level and progression within a question or an assignment.'

const ADDED = [
  '  options — conventions of the answer options: how many there are, and whether the last one is always "None of the options are correct" (quote such a final option verbatim);',
  '  marks — how many marks each question or sub-part carries and whether they are shown;',
  '  data_sheet — whether students are given a data / formula sheet (constants, molar masses, equations) that the questions rely on instead of stating them;',
  '  sig_figs — how significant figures are required or graded (e.g. "answers must have 3 significant figures", deductions for wrong significant figures);',
  '  context — whether questions are set in a context story, including details that are not needed for the answer.',
]

export function buildSystemPrompt(): string {
  const base = V1.buildSystemPrompt()
  return base.includes(AFTER) ? base.replace(AFTER, [AFTER, ...ADDED].join('\n')) : base
}
