import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setUILanguage } from '@/i18n'
import { QuestionOriginBadge } from '@/shared/ui/QuestionOriginBadge'
import { RubricSourceLabel } from '@/shared/ui/RubricSourceLabel'
import { ShortAnswerFeedback } from '@/widgets/quiz/ShortAnswerFeedback'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'

afterEach(() => setUILanguage('en'))

describe('QuestionOriginBadge', () => {
  it('labels 原题 / 改编题 / AI 新题 with an explanation', () => {
    setUILanguage('zh-CN')
    const { rerender, container } = render(<QuestionOriginBadge origin={{ kind: 'original' }} />)
    expect(screen.getByText('原题')).toBeInTheDocument()
    expect(container.querySelector('[data-origin="original"]')).toHaveAttribute('title')

    rerender(<QuestionOriginBadge origin={{ kind: 'adapted' }} />)
    expect(screen.getByText('改编题')).toBeInTheDocument()

    rerender(<QuestionOriginBadge origin={{ kind: 'ai', grounded: true }} />)
    expect(screen.getByText('AI 新题 · 依据教材')).toBeInTheDocument()

    rerender(<QuestionOriginBadge origin={{ kind: 'ai', grounded: false }} />)
    expect(screen.getByText('AI 新题 · 无教材出处')).toBeInTheDocument()
  })
})

describe('RubricSourceLabel', () => {
  it('names the professor standard and the platform points distinctly', () => {
    setUILanguage('zh-CN')
    const { rerender } = render(<RubricSourceLabel source="professor" />)
    expect(screen.getByText('教授评分标准')).toBeInTheDocument()
    rerender(<RubricSourceLabel source="platform" />)
    expect(screen.getByText('平台拟定的得分点（非教授标准）')).toBeInTheDocument()
  })

  it('short-answer feedback defaults to platform points', () => {
    setUILanguage('zh-CN')
    const evaluation: QuestionEvaluation = {
      isCorrect: false,
      method: 'rubric_ai',
      confidence: 0.8,
      score: { earned: 1, total: 2 },
      rubric: [
        { pointId: 'p1', text: 'Point one', covered: true },
        { pointId: 'p2', text: 'Point two', covered: false },
      ],
    }
    const { container, rerender } = render(<ShortAnswerFeedback evaluation={evaluation} />)
    expect(container.querySelector('[data-rubric-source="platform"]')).not.toBeNull()
    rerender(<ShortAnswerFeedback evaluation={evaluation} rubricSource="professor" />)
    expect(screen.getByText('教授评分标准')).toBeInTheDocument()
  })
})
