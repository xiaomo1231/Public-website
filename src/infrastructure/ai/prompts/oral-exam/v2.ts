/**
 * oral-exam v2: v1's prompts with the professor-habits block moved right after
 * the language line, before the drawn topic. The topics of one oral exam are
 * written one request each; the language line and the habits are the same
 * for all of them, so later requests share that prefix (providers' automatic
 * prefix caches). The words are v1's; only the place of the block changes.
 * v1 is kept unchanged.
 */
import * as V1 from './v1'
import { professorStyleSection } from '../question-style/v1'

export * from './v1'
export const VERSION = 'v2' as const

export function buildUserPrompt(input: V1.OralExamInput): string {
  const { professorHabits, ...rest } = input
  const base = V1.buildUserPrompt(rest)
  if (!professorHabits) return base
  const at = base.indexOf('\n')
  const section = professorStyleSection(professorHabits)
  return at < 0 ? `${base}\n${section}` : `${base.slice(0, at)}\n${section}${base.slice(at)}`
}
