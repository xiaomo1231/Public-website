import type { HomeworkQuestion } from '@/entities/homework/types'
import { questionMarketFigure } from '@/entities/econ/partAnswers'
import { MarketQuestionFigure } from './MarketQuestionFigure'

/**
 * The diagram of a homework / mock-exam question, when it has one: the shared
 * figure of an AI mock paper's figure group, or the market of its first graph
 * part. Nothing for any other question.
 */
export function QuestionMarketFigure({
  question,
}: {
  question: Pick<HomeworkQuestion, 'marketFigure' | 'practice'>
}): JSX.Element | null {
  const figure = questionMarketFigure(question)
  return figure ? <MarketQuestionFigure figure={figure} /> : null
}
