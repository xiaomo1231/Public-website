import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { HomeworkWalkthrough, WalkthroughSection } from '@/entities/homework/walkthrough'
import type { HomeworkQuestion } from '@/entities/homework/types'

/** Upper bound for the context sent with one walkthrough question. */
export const WALKTHROUGH_CONTEXT_CHARS = 6000

export interface WalkthroughContextInput {
  setId: string
  sectionId: string
  /** The selected text (plain); used to centre a long section on the passage. */
  quote: string
  /** The paragraph around the selection, used when nothing better is stored. */
  surrounding: string
}

/**
 * The context for a question asked about a walkthrough passage: the question's
 * own wording and the whole section as written (Markdown with its LaTeX), not
 * only the paragraph around the selection. Formulas, matrices and equations
 * are rendered as separate blocks, so the paragraph alone would leave the
 * model guessing ("the fourth column" of which matrix?).
 *
 * A section longer than the budget is cut to a window around the passage.
 * Falls back to the paragraph when the walkthrough row is gone.
 */
export async function buildWalkthroughContext(
  input: WalkthroughContextInput,
  db: AppDatabase = getDb(),
): Promise<string> {
  const rows = await db
    .table<HomeworkWalkthrough, string>('homeworkWalkthroughs')
    .where('setId')
    .equals(input.setId)
    .toArray()
  const section = pickSection(rows, input.sectionId)
  if (!section) return input.surrounding

  const parts: string[] = []
  if (section.questionId) {
    const question = await db
      .table<HomeworkQuestion, string>('homeworkQuestions')
      .get(section.questionId)
    if (question?.prompt) parts.push(`Question:\n${question.prompt.trim()}`)
  }
  if (section.conclusion) parts.push(`Conclusion:\n${section.conclusion.trim()}`)
  const header = parts.join('\n\n')
  const budget = Math.max(1000, WALKTHROUGH_CONTEXT_CHARS - header.length)
  const body = windowAround(section.body, input.quote, budget)
  return [header, `Walkthrough section:\n${body}`].filter(Boolean).join('\n\n')
}

/** The ready section with this id, from the most recently updated walkthrough. */
function pickSection(
  rows: HomeworkWalkthrough[],
  sectionId: string,
): WalkthroughSection | undefined {
  const sorted = [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  for (const row of sorted) {
    const section = row.sections.find((item) => item.id === sectionId && item.status === 'ready')
    if (section) return section
  }
  return undefined
}

/**
 * At most `budget` characters of `text`, centred on the first occurrence of
 * `quote` (compared without whitespace and markup differences); the start of
 * the text when the quote is not found.
 */
export function windowAround(text: string, quote: string, budget: number): string {
  if (text.length <= budget) return text
  const at = locate(text, quote)
  const start = Math.max(0, Math.min(text.length - budget, at - Math.floor(budget / 2)))
  const slice = text.slice(start, start + budget)
  return `${start > 0 ? '…' : ''}${slice}${start + budget < text.length ? '…' : ''}`
}

function locate(text: string, quote: string): number {
  const probe = quote.replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!probe) return 0
  const direct = text.indexOf(probe)
  if (direct >= 0) return direct
  // Rendered text loses Markdown emphasis; try the longest plain run instead.
  const run = probe.split(/[^\p{L}\p{N}]+/u).sort((a, b) => b.length - a.length)[0] ?? ''
  if (run.length >= 2) {
    const loose = text.indexOf(run)
    if (loose >= 0) return loose
  }
  return 0
}
