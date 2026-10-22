import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnswerImages } from '@/widgets/handwriting/AnswerImages'
import type { HomeworkAnswerImageService } from '@/services/homeworkAnswerImageService'
import type { HomeworkAnswerImage } from '@/entities/homework/answerImages'

function image(id: string, order: number): HomeworkAnswerImage {
  return {
    id,
    projectId: 'p1',
    setId: 's1',
    questionId: 'q1',
    mimeType: 'image/png',
    bytes: new Uint8Array([1, 2]).buffer,
    order,
    source: 'upload',
    createdAt: 1,
  }
}

describe('AnswerImages', () => {
  it('lists thumbnails with reorder / remove controls and opens the pen board', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    let images = [image('a', 0), image('b', 1)]
    const service = {
      list: vi.fn(async () => images),
      add: vi.fn(),
      remove: vi.fn(async (_q: string, id: string) => {
        images = images.filter((item) => item.id !== id)
      }),
      move: vi.fn(async () => {
        images = [images[1]!, images[0]!]
      }),
    } as unknown as HomeworkAnswerImageService
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AnswerImages questionId="q1" service={service} onChange={onChange} />)

    expect(await screen.findAllByRole('img', { name: /answer image/i })).toHaveLength(2)
    expect(onChange).toHaveBeenLastCalledWith(images)
    expect(screen.getByRole('button', { name: 'Move image 1 earlier' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Move image 2 earlier' }))
    expect(service.move).toHaveBeenCalledWith('q1', 'b', -1)
    await user.click(screen.getByRole('button', { name: 'Remove image 1' }))
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: /answer image/i })).toHaveLength(1),
    )

    await user.click(screen.getByRole('button', { name: 'Pen board' }))
    const canvas = await screen.findByRole('img', { name: /writing area, page 1 of 1/i })
    expect(canvas).toHaveClass('touch-none')
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
    // Nothing written yet: saving is not possible.
    expect(screen.getByRole('button', { name: 'Save as answer images' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add page' }))
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument()
  })
})
