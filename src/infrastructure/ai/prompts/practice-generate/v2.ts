/**
 * practice-generate v2: v1's prompts with the professor-habits block moved
 * before the slots. The language line, the assignment's knowledge points and
 * the habits are the same for every batch of one practice set, so later
 * batches share that prefix (providers' automatic prefix caches). The words
 * are v1's; only the place of the block changes. v1 is kept unchanged.
 */
import * as V1 from './v1'
import { professorStyleSection } from '../question-style/v1'

export * from './v1'
export const VERSION = 'v2' as const

const KEY_POINTS_END = '=== END KNOWLEDGE POINTS OF THE ASSIGNMENT ==='

export function buildUserPrompt(input: V1.PracticeGenerateInput): string {
  const { professorHabits, ...rest } = input
  const base = V1.buildUserPrompt(rest)
  if (!professorHabits) return base
  const keyPoints = base.indexOf(KEY_POINTS_END)
  const at = keyPoints >= 0 ? keyPoints + KEY_POINTS_END.length : base.indexOf('\n\n')
  const section = professorStyleSection(professorHabits)
  return at < 0 ? `${base}\n\n${section}` : `${base.slice(0, at)}\n\n${section}${base.slice(at)}`
}
