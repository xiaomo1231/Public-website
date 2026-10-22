/**
 * v2 of 与教授答案对照.
 *
 * v1 said labels inside one professor solution "may name alternative
 * methods ("two ways")". In real answers a nested label that equals a
 * question sub-part is usually that sub-part's own solution, misplaced under
 * another heading; v2 says so. With a checked 小题 ⇄ 教授答案 map
 * (`professorMap`, see `entities/homework/professorMap.ts`) the user prompt
 * carries it after the professor answer and the system prompt says
 * "not_in_professor" is only for a sub-part the map marks "none" (the local
 * check, `validateCompare`, enforces it too).
 *
 * The reply shape and `normalizeCompare` are v1's.
 */
import { untrustedContentWrapper } from '../security'
import { professorMapBlock, type ProfessorMapPromptEntry } from '../professor-answer-map/v1'
import * as V1 from './v1'

export * from './v1'
export const VERSION = 'v2' as const

const V1_MAPPING_START = 'Read the WHOLE professor answer and map its content'

const MAPPING_V2 =
  'Read the WHOLE professor answer and map its content to the question’s sub-parts by meaning, not only by headings: a sub-part’s solution may be written under ANOTHER sub-part’s heading — a nested label that equals one of the question’s sub-parts (e.g. "(a) …" inside the solution under (b)) is usually that sub-part’s own solution, misplaced; read nested labels as alternative methods only when they clearly solve the same sub-part twice. Compare each sub-part of the walkthrough with whatever part of the professor answer covers its content.'

const MAP_RULE =
  'A PROFESSOR ANSWER MAP is given in the user message (checked against the professor answer; authoritative). Use "not_in_professor" ONLY for a sub-part the map marks "none"; for a "direct" or "indirect" sub-part compare with the listed excerpts (and quote from them).'

export function buildSystemPrompt(options: { professorMap?: boolean } = {}): string {
  const lines = V1.buildSystemPrompt().split('\n')
  const mapping = lines.findIndex((line) => line.startsWith(V1_MAPPING_START))
  if (mapping >= 0) {
    lines[mapping] = MAPPING_V2
    if (options.professorMap) lines.splice(mapping + 1, 0, MAP_RULE)
  }
  return lines.join('\n')
}

export function buildUserPrompt(
  input: V1.CompareUserInput & { professorMap?: ProfessorMapPromptEntry[] },
): string {
  const { professorMap, ...rest } = input
  const base = V1.buildUserPrompt(rest)
  if (!professorMap?.length) return base
  const marker = untrustedContentWrapper('CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION', '')
    .split('\n')
    .pop()!
  const at = base.indexOf(`\n${marker}`)
  if (at < 0) return base
  const cut = at + marker.length + 1
  return `${base.slice(0, cut)}\n${professorMapBlock(professorMap)}${base.slice(cut)}`
}
