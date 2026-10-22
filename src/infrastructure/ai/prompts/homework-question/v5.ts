/**
 * v5 of the homework-question prompt: the checked 小题 ⇄ 教授答案 map.
 *
 * v4 told the model to map the professor answer to the sub-parts by meaning
 * and suggested that labels inside one solution may name "two ways". With
 * real answers (a sub-part's solution written under another sub-part's
 * heading) models still opened that sub-part with 「教授答案未给出此小题的解答」.
 * v5:
 *  - With a professor answer, the mapping rule reads nested labels as what
 *    they usually are: a sub-part's solution misplaced under another
 *    heading (alternative methods only when the same sub-part is clearly
 *    solved twice).
 *  - With `professorMap` (checked locally, `entities/homework/professorMap.ts`)
 *    the user prompt carries the per-sub-part excerpts and the system prompt
 *    says: follow `direct`, build on and name the source of `indirect`, and
 *    only `none` opens with the "not in the professor answer" line.
 *
 * Without a professor answer every prompt is byte-identical to v4 (and v3).
 */
import { securityFooter } from '../security'
import {
  professorMapBlock,
  professorMapRules,
  type ProfessorMapPromptEntry,
} from '../professor-answer-map/v1'
import * as V4 from './v4'

export const VERSION = 'v5' as const
export const PROMPT_KIND = 'homework-question' as const

export type HomeworkQuestionMode = V4.HomeworkQuestionMode
export type HomeworkQuestionOutput = V4.HomeworkQuestionOutput

export interface HomeworkQuestionInput extends V4.HomeworkQuestionInput {
  /** v5: the checked sub-part ↔ professor-excerpt map (whole question). */
  professorMap?: ProfessorMapPromptEntry[]
}

/** v4's mapping line, superseded whenever there is a professor answer. */
const V4_MAPPING_START = '  - Read the WHOLE professor answer and map its content to the sub-parts'
const V4_UNSOLVED_START = '  - For a sub-part the professor left to the student'

export const MAPPING_RULE =
  '  - Read the WHOLE professor answer and map its content to the sub-parts of the question by meaning, not only by headings: a sub-part’s solution may be written under ANOTHER sub-part’s heading — a nested label that equals one of the question’s sub-parts (e.g. "(a) …" inside the solution under (b)) is usually that sub-part’s own solution, misplaced; read it as alternative methods only when it clearly solves the same sub-part twice. A label may also be skipped, repeated, out of order or mistyped (e.g. a reference to a part that does not exist). Follow the intended meaning and add one short note on an obvious typo.'

export function buildSystemPrompt(
  mode: HomeworkQuestionMode = 'combined',
  compact = false,
  hasProfessorAnswer = false,
  hasMap = false,
): string {
  const base = V4.buildSystemPrompt(mode, compact, hasProfessorAnswer)
  if (!hasProfessorAnswer) return base
  const lines = base.split('\n')
  const mapping = lines.findIndex((line) => line.startsWith(V4_MAPPING_START))
  if (mapping >= 0) lines[mapping] = MAPPING_RULE
  if (hasMap) {
    const unsolved = lines.findIndex((line) => line.startsWith(V4_UNSOLVED_START))
    const rules = professorMapRules().map((rule) => `  ${rule}`)
    if (unsolved >= 0) lines.splice(unsolved, 1, ...rules)
    else {
      const footer = lines.lastIndexOf(securityFooter().split('\n')[0]!)
      lines.splice(footer < 0 ? lines.length : footer, 0, ...rules)
    }
  }
  return lines.join('\n')
}

export function buildUserPrompt(input: HomeworkQuestionInput): string {
  const { professorMap, ...rest } = input
  const base = V4.buildUserPrompt(rest)
  if (!input.professorAnswer?.trim() || !professorMap?.length) return base
  const block = professorMapBlock(professorMap)
  // Right after the professor answer (before the notes and the sub-part line).
  const at = base.indexOf('\n=== END PROFESSOR ANSWER FOR THIS QUESTION')
  const cut = at < 0 ? -1 : base.indexOf('\n', at + 1)
  if (at < 0) return `${base}\n${block}`
  if (cut < 0) return `${base}\n${block}`
  return `${base.slice(0, cut)}\n${block}${base.slice(cut)}`
}
