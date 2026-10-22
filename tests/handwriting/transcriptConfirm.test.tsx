import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptConfirmPanel, type TranscriptItem } from '@/widgets/exam/TranscriptConfirmPanel'
import type { HomeworkAnswerImage } from '@/entities/homework/answerImages'
import { t } from '@/i18n'

function image(id: string): HomeworkAnswerImage {
  return {
    id,
    projectId: 'p1',
    setId: 's1',
    questionId: 'q1',
    mimeType: 'image/png',
    bytes: new Uint8Array([1, 2]).buffer,
    order: 0,
    source: 'pen',
    createdAt: 1,
    examAttemptId: 'a1',
  }
}

describe('TranscriptConfirmPanel', () => {
  it('shows the original next to the transcript and blocks confirming while [?] remain', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const onConfirm = vi.fn(async () => undefined)
    const onRecognize = vi.fn()
    const item: TranscriptItem = {
      questionId: 'q1',
      number: '1',
      images: [image('i1')],
      imageKey: 'i1',
      transcript: {
        questionId: 'q1',
        imageKey: 'i1',
        status: 'recognized',
        provider: 'vision-llm',
        recognizedText: 'x = [?:2]',
        regions: [{ text: 'x = [?:2]', confidence: 0.4 }],
      },
    }
    const user = userEvent.setup()
    render(
      <TranscriptConfirmPanel
        items={[item]}
        busy={false}
        onConfirm={onConfirm}
        onRecognize={onRecognize}
      />,
    )

    // The handwriting is shown beside the text.
    expect(screen.getByAltText(t('transcript.originalAlt', { n: 1, number: '1' }))).toBeTruthy()
    const confirm = screen.getByRole('button', { name: t('transcript.confirm') })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(t('transcript.unclear', { count: 1 }))).toBeTruthy()
    // Low-confidence lines are listed for checking.
    expect(screen.getByText(t('transcript.lowConfidence'))).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: t('transcript.acceptGuesses', { count: 1 }) }),
    )
    const area = screen.getByLabelText(t('transcript.textLabel')) as HTMLTextAreaElement
    expect(area.value).toBe('x = 2')
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('q1', 'x = 2')

    await user.click(screen.getByRole('button', { name: t('transcript.recognizeAgain') }))
    expect(onRecognize).toHaveBeenCalledWith(['q1'])
  })
})
