/**
 * The answer text of a multi-part practice question (`(a) …\n(b) …`) read and
 * rewritten one part at a time, so a graph part's structured answer can live
 * in the same draft the other parts are typed in (and graded with
 * `checkPracticeAnswer`). A single-part question's draft is its answer.
 */
import { walkthroughSubparts } from '@/entities/homework/splitQuestion'
import type { PracticeGrader } from '@/entities/homework/practice/types'
import type { MarketFigure } from './graphQuestion'

export function readPartAnswers(
  draft: string,
  labels: ReadonlyArray<string | undefined>,
): string[] {
  if (labels.length <= 1) return [draft]
  const found = walkthroughSubparts(draft)
  return labels.map((label) => found.find((part) => part.label === label)?.text ?? '')
}

export function writePartAnswer(
  draft: string,
  labels: ReadonlyArray<string | undefined>,
  index: number,
  value: string,
): string {
  if (labels.length <= 1) return value
  const answers = readPartAnswers(draft, labels)
  answers[index] = value
  return labels
    .map((label, i) => `(${label ?? String.fromCharCode(97 + i)}) ${answers[i] ?? ''}`.trimEnd())
    .join('\n')
}

export type PartLike = { label?: string; grader: PracticeGrader }

/** Whether a practice question has graph parts (shown with this widget). */
export function hasMarketParts(parts: readonly PartLike[] | undefined): boolean {
  return !!parts?.some((part) => part.grader.kind === 'market')
}

/** Every part is a graph part: the draft is fully written by this widget. */
export function onlyMarketParts(parts: readonly PartLike[] | undefined): boolean {
  return !!parts?.length && parts.every((part) => part.grader.kind === 'market')
}

/** The diagram printed with a homework / mock-exam question: its shared figure or its first graph part's. */
export function questionMarketFigure(question: {
  marketFigure?: { figure: MarketFigure }
  practice?: { parts: readonly PartLike[] }
}): MarketFigure | null {
  if (question.marketFigure) return question.marketFigure.figure
  const part = question.practice?.parts.find((item) => item.grader.kind === 'market')
  return part?.grader.kind === 'market' ? part.grader.question.figure : null
}

/**
 * In a list of questions, the label of the question whose figure this one
 * shares (the same figure group, printed once before the group's first
 * question); null when it prints its own (or none).
 */
export function sharedFigureLabel(
  questions: ReadonlyArray<{
    question: { number?: string; marketFigure?: { groupId?: string } }
  }>,
  index: number,
): string | null {
  const group = questions[index]?.question.marketFigure?.groupId
  if (!group) return null
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = questions[i]!.question
    if (item.marketFigure?.groupId !== group) break
    if (i === 0 || questions[i - 1]!.question.marketFigure?.groupId !== group)
      return item.number ?? String(i + 1)
  }
  return null
}
