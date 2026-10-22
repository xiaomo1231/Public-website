import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuestionText } from '@/widgets/homework/QuestionText'
import { translationSourceHash } from '@/entities/homework/questionTranslation'

const translate = vi.hoisted(() => vi.fn())

vi.mock('@/services/questionTranslationService', () => ({
  buildQuestionTranslationService: async () => ({ translate, hasAI: () => true }),
}))

const PROMPT = '(a) Find the rank of $A$. (b) Use 3 rows.'

describe('原文 / 中文翻译', () => {
  it('asks for the translation on the first click, then switches without asking again', async () => {
    const user = userEvent.setup()
    translate.mockResolvedValueOnce({
      language: 'zh',
      sourceHash: translationSourceHash(PROMPT),
      promptVersion: 'question-translate/v1',
      text: '(a) 求 $A$ 的秩（rank）。(b) 用 3 行。',
      createdAt: 1,
    })
    render(<QuestionText question={{ id: 'qa', prompt: PROMPT }} />)
    const group = screen.getByRole('group', { name: /language/i })
    const [original, chinese] = within(group).getAllByRole('button')
    expect(original).toHaveAttribute('aria-pressed', 'true')
    expect(document.body.textContent).toContain('Find the rank')

    await user.click(chinese!)
    expect(chinese).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/求/)).toBeInTheDocument()
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate).toHaveBeenCalledWith(
      'qa',
      expect.objectContaining({ signal: expect.anything() }),
    )

    await user.click(original!)
    expect(document.body.textContent).toContain('Find the rank')
    await user.click(chinese!)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('shows an actionable error with a retry, and uses a cached translation directly', async () => {
    const user = userEvent.setup()
    translate.mockRejectedValueOnce(
      Object.assign(new Error('The translation changed a formula of the question.'), {
        code: 'TRANSLATION_CHANGED',
      }),
    )
    const { unmount } = render(<QuestionText question={{ id: 'qb', prompt: PROMPT }} />)
    await user.click(screen.getAllByRole('button')[1]!)
    expect(await screen.findByRole('alert')).toHaveTextContent(/formula/)
    translate.mockResolvedValueOnce({
      language: 'zh',
      sourceHash: translationSourceHash(PROMPT),
      promptVersion: 'question-translate/v1',
      text: '(a) 求秩。(b) 用 3 行。',
      createdAt: 1,
    })
    await user.click(screen.getByRole('button', { name: /again/i }))
    expect(await screen.findByText(/求秩/)).toBeInTheDocument()
    unmount()

    translate.mockClear()
    render(
      <QuestionText
        question={{
          id: 'qc',
          prompt: PROMPT,
          translation: {
            language: 'zh',
            sourceHash: translationSourceHash(PROMPT),
            promptVersion: 'question-translate/v1',
            text: '已缓存的译文 3。',
            createdAt: 1,
          },
        }}
      />,
    )
    await user.click(screen.getAllByRole('button')[1]!)
    expect(screen.getByText(/已缓存的译文/)).toBeInTheDocument()
    expect(translate).not.toHaveBeenCalled()
  })

  it('offers no toggle for a question that is already Chinese', () => {
    render(<QuestionText question={{ id: 'qd', prompt: '求矩阵 $A$ 的秩，并说明理由。' }} />)
    expect(screen.queryByRole('group')).toBeNull()
  })
})
