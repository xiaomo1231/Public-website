/**
 * v9 of the homework walkthrough prompts: the checked 小题 ⇄ 教授答案 map.
 *
 * v6's alignment rules said labels such as (a)/(b) inside one professor
 * solution "may name alternative methods" — but in real answers a nested
 * label that equals a question sub-part is usually that sub-part's own
 * solution, written under another sub-part's heading. v9:
 *  - `alignProfessor`: the mapping rule reads nested labels as misplaced
 *    sub-part solutions (alternative methods only when the same sub-part is
 *    clearly solved twice).
 *  - `professorMap` (system prompts: `true`; user prompts: the entries,
 *    checked locally in `entities/homework/professorMap.ts`): the map block
 *    goes right after the professor answer (shared by every sub-part
 *    request, so providers' prefix caches still hit), and the "not solved by
 *    the professor" rule becomes: follow `direct`, build on and name the
 *    source of `indirect`, only `none` opens with 「教授答案未给出此小题的解答」.
 *
 * Without `alignProfessor` (no professor answer) every prompt is v8's, word
 * for word. `CACHE_VERSION` stays `'v1'`; the hash of a section WITH a
 * professor answer carries `PROFESSOR_ALIGN_VERSION` (`align-v2` with these
 * rules) and the student's map edits, so only those sections are offered
 * for an update.
 */
import {
  professorMapBlock,
  professorMapRules,
  type ProfessorMapPromptEntry,
} from '../professor-answer-map/v1'
import * as V8 from './v8'

export * from './v8'
export const VERSION = 'v9' as const

const V6_MAPPING_START = '- Read the WHOLE professor answer and map its content to the sub-parts'
const V6_UNSOLVED_START = '- For a sub-part no part of the professor answer covers'

export const ALIGN_MAPPING_V9 =
  '- Read the WHOLE professor answer and map its content to the sub-parts by meaning, not only by headings: a sub-part’s solution may be written under ANOTHER sub-part’s heading — a nested label that equals one of the question’s sub-parts (e.g. "(a) This is true because …" inside the solution under (b)) is usually that sub-part’s own solution, misplaced, and is followed as that sub-part’s solution; read nested labels as alternative methods only when they clearly solve the same sub-part twice.'

/** v6's alignment lines with v9's mapping rule (and, with a map, the map rules). */
function revise(prompt: string, map: boolean): string {
  const lines = prompt.split('\n')
  const mapping = lines.findIndex((line) => line.startsWith(V6_MAPPING_START))
  if (mapping < 0) return prompt
  lines[mapping] = ALIGN_MAPPING_V9
  if (map) {
    const unsolved = lines.findIndex((line) => line.startsWith(V6_UNSOLVED_START))
    if (unsolved >= 0) lines.splice(unsolved, 1, ...professorMapRules())
    else lines.splice(mapping + 1, 0, ...professorMapRules())
  }
  return lines.join('\n')
}

type MapOption = {
  /** v9: a checked professor-answer map is in the user prompt. */
  professorMap?: boolean
}

export function buildQuestionSystemPrompt(
  options: Parameters<typeof V8.buildQuestionSystemPrompt>[0] & MapOption,
): string {
  const { professorMap, ...rest } = options
  const base = V8.buildQuestionSystemPrompt(rest)
  return rest.alignProfessor ? revise(base, Boolean(professorMap)) : base
}

export function buildPartSystemPrompt(
  options: Parameters<typeof V8.buildPartSystemPrompt>[0] & MapOption,
): string {
  const { professorMap, ...rest } = options
  const base = V8.buildPartSystemPrompt(rest)
  return rest.alignProfessor ? revise(base, Boolean(professorMap)) : base
}

export function buildVariantSystemPrompt(
  options: Parameters<typeof V8.buildVariantSystemPrompt>[0] & MapOption,
): string {
  const { professorMap, ...rest } = options
  const base = V8.buildVariantSystemPrompt(rest)
  return rest.alignProfessor ? revise(base, Boolean(professorMap)) : base
}

type MapInput = {
  /** v9: the checked map (sent only with a professor answer). */
  professorMap?: ProfessorMapPromptEntry[]
}

const ANSWER_END = '\n=== END CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION ==='

/** The map block right after the professor answer block. */
function withMap(prompt: string, map: ProfessorMapPromptEntry[] | undefined): string {
  if (!map?.length) return prompt
  const at = prompt.indexOf(ANSWER_END)
  if (at < 0) return prompt
  const cut = at + ANSWER_END.length
  return `${prompt.slice(0, cut)}\n${professorMapBlock(map)}${prompt.slice(cut)}`
}

export function buildQuestionUserPrompt(
  input: Parameters<typeof V8.buildQuestionUserPrompt>[0] & MapInput,
): string {
  const { professorMap, ...rest } = input
  return withMap(V8.buildQuestionUserPrompt(rest), professorMap)
}

export function buildPartUserPrompt(
  input: Parameters<typeof V8.buildPartUserPrompt>[0] & MapInput,
): string {
  const { professorMap, ...rest } = input
  return withMap(V8.buildPartUserPrompt(rest), professorMap)
}

export function buildVariantUserPrompt(
  input: Parameters<typeof V8.buildVariantUserPrompt>[0] & MapInput,
): string {
  const { professorMap, ...rest } = input
  return withMap(V8.buildVariantUserPrompt(rest), professorMap)
}
