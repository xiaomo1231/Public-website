/**
 * mock-paper v2: v1 plus figure groups. Several questions of a past paper may
 * share ONE figure (economics: three multiple-choice questions on one
 * supply-and-demand graph). When the app has drawn the shared figure for such
 * a group (`figureGroup.figure`, the figure engine's text description), the
 * user prompt gives it to the writer: write this question about that figure,
 * asking something the other questions of the group do not.
 *
 * Without `figureGroup`, or without a drawn figure, the prompts are v1's
 * byte for byte (the question is written as an ordinary one). The system
 * prompt, the reply and the review are v1's. Not cached.
 */
import * as V1 from './v1'
import { untrustedContentWrapper } from '../security'

export * from './v1'
export const VERSION = 'v2' as const

export interface MockFigureGroupInput {
  /** 0-based position of this question in the group. */
  position: number
  size: number
  /** Printed numbers of the group's questions, in order ("3", "4", "5"). */
  labels: string[]
  /** The drawn figure as text (axes, curves, labelled points); absent ⇒ no figure. */
  figure?: string
  /** What the group's other questions already ask (stems / prompts, clipped). */
  siblings?: string[]
}

export interface MockPaperInput extends V1.MockPaperInput {
  figureGroup?: MockFigureGroupInput
}

function figureBlock(group: MockFigureGroupInput, figure: string): string {
  const numbers = group.labels.length ? ` (questions ${group.labels.join(', ')})` : ''
  return [
    untrustedContentWrapper('SHARED FIGURE', figure),
    `FIGURE GROUP: this is question ${group.position + 1} of ${group.size}${numbers} that all refer to the SHARED FIGURE above, printed once before them. Write this question about that figure exactly as described (its curves, labels, points and numbers); refer to it as "the figure" and do not describe or redraw it in the stem. Ask about a different reading of the figure than the other questions of the group.`,
    group.siblings?.length
      ? untrustedContentWrapper('OTHER QUESTIONS OF THE GROUP', group.siblings.join('\n\n'))
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildUserPrompt(input: MockPaperInput): string {
  const { figureGroup, ...rest } = input
  const base = V1.buildUserPrompt(rest)
  const figure = figureGroup?.figure?.trim()
  if (!figureGroup || !figure) return base
  return [base, figureBlock(figureGroup, figure)].join('\n\n')
}
