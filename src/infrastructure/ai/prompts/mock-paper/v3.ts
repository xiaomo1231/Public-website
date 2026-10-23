/**
 * mock-paper v3: economics graph questions. `buildSystemPrompt({ economics:
 * true })` adds the `{"type":"market", …}` check of practice-generate v4 (a
 * supply-and-demand diagram the app draws and solves; the stated answer is
 * recomputed and replaced when it disagrees). Without it the prompts are
 * v2's word for word. The user prompt, the reply and the review are v2's.
 * v2 is kept unchanged. Not cached.
 */
import * as V2 from './v2'
import { withMarketCheck } from '../practice-generate/v4'

export * from './v2'
export const VERSION = 'v3' as const

export function buildSystemPrompt(
  options: { sigFigs?: boolean; economics?: boolean } = {},
): string {
  const { economics, ...rest } = options
  const base = V2.buildSystemPrompt(rest)
  return economics ? withMarketCheck(base) : base
}
