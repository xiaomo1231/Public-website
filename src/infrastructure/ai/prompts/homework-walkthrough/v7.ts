/**
 * v7 of the homework walkthrough prompts: the sub-part user prompts are
 * ordered for providers' automatic prefix caches.
 *
 * A question written part by part (and its 详细版 written part by part) sends
 * one request per sub-part, each with the same question, source passages,
 * professor answer and previous solution. v6 named the sub-part in the second
 * line, before those blocks, so sibling requests shared almost no prefix. v7
 * moves that line after the shared blocks; the words are v6's, only their
 * place changes. Every other prompt is v6's, word for word, and
 * `CACHE_VERSION` stays `'v1'` — section hashes do not change, so no ready
 * section is offered for an update.
 */
import * as V6 from './v6'

export * from './v6'
export const VERSION = 'v7' as const

/** Wrapped blocks every sub-part of a question shares, last one first. */
const SHARED_BLOCKS = [
  'PREVIOUS AI WORKED SOLUTION (UNVERIFIED)',
  'CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION',
  'QUESTION SOURCE PASSAGES',
  'HOMEWORK QUESTION',
]

/** Move `line` from where it is to just after the last shared block. */
function afterSharedBlocks(prompt: string, line: string): string {
  const at = prompt.indexOf(`\n${line}\n`)
  if (at < 0) return prompt
  const without = prompt.slice(0, at) + prompt.slice(at + line.length + 1)
  for (const label of SHARED_BLOCKS) {
    const marker = `\n=== END ${label} ===`
    const end = without.lastIndexOf(marker)
    if (end >= 0) {
      const cut = end + marker.length
      return `${without.slice(0, cut)}\n${line}${without.slice(cut)}`
    }
  }
  return prompt
}

export function buildPartUserPrompt(input: Parameters<typeof V6.buildPartUserPrompt>[0]): string {
  const line = `This request is for question ${input.label}, sub-part (${input.part}) only. The question's sub-parts are ${input.parts.map((part) => `(${part})`).join(', ')}. Write ONLY the part for (${input.part}).`
  return afterSharedBlocks(V6.buildPartUserPrompt(input), line)
}

export function buildVariantUserPrompt(
  input: Parameters<typeof V6.buildVariantUserPrompt>[0],
): string {
  const base = V6.buildVariantUserPrompt(input)
  if (!input.part) return base
  const line = `This request is for question ${input.label}, sub-part (${input.part})${input.heading ? ` "${input.heading}"` : ''} only.`
  return afterSharedBlocks(base, line)
}
