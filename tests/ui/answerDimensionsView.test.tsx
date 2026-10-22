import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnswerDimensionsView } from '@/widgets/quiz/AnswerDimensionsView'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'
import { setUILanguage } from '@/i18n'

const question: Question = {
  id: 'q',
  projectId: 'p',
  knowledgePoint: 'g',
  type: 'numeric',
  difficulty: 'basic',
  prompt: 'g?',
  correctAnswer: '9.81',
  unit: 'm/s^2',
  sigFigs: 3,
  hints: [],
  sourceRefs: [],
  promptVersion: 'v9',
  createdAt: 0,
}

describe('value · unit · significant figures in the result', () => {
  beforeEach(() => setUILanguage('zh-CN'))

  it('shows each dimension and the rule with its source', () => {
    const evaluation = evaluateDeterministic(question, '9.810 m/s^2')
    render(<AnswerDimensionsView evaluation={evaluation} />)
    expect(screen.getByText('要求 3 位，提交 4 位')).toBeInTheDocument()
    expect(screen.getByText(/有效数字评分规则：仅提示，不扣分（平台拟定规则）/)).toBeInTheDocument()
    expect(screen.getByText(/本题不扣分/)).toBeInTheDocument()
  })

  it('names a professor rule and the deduction', () => {
    const evaluation = evaluateDeterministic(question, '9.8 m/s^2', {
      sigFigPolicy: { mode: 'deduct', percent: 50, source: 'professor' },
    })
    render(<AnswerDimensionsView evaluation={evaluation} />)
    expect(screen.getByText(/扣 50%（教授规则）/)).toBeInTheDocument()
    expect(screen.getByText(/本题已按规则扣 50%/)).toBeInTheDocument()
  })

  it('renders nothing for answers without dimensions', () => {
    const { container } = render(
      <AnswerDimensionsView evaluation={{ dimensions: undefined } as never} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
