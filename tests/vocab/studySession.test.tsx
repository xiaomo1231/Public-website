import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudySession } from '@/widgets/vocab/StudySession'
import type { SessionItem } from '@/entities/vocab/types'
import type { VocabService } from '@/services/vocabService'

function fakeService() {
  const grade = vi.fn(async () => ({}))
  const service = {
    grade,
    previewIntervals: vi.fn(async () => ({ 1: 60000, 2: 360000, 3: 600000, 4: 8 * 86400000 })),
    details: vi.fn(async () => ({ view: {}, roots: [['sub-', 'prefix', 'under', ['subway']]] })),
  } as unknown as VocabService
  return { service, grade }
}

const view = (word: string, meaning: string, sentence?: string) => ({
  word,
  phonetic: 'x',
  meanings: [meaning],
  tags: [],
  ...(sentence ? { context: { text: sentence, page: 3 } } : {}),
})

describe('study session', () => {
  it('reveals a new word and rates it with the shown intervals', async () => {
    const { service, grade } = fakeService()
    const items: SessionItem[] = [{ view: view('bursa', 'n. 滑膜囊'), kind: 'new', mode: 'learn' }]
    const onExit = vi.fn()
    render(<StudySession items={items} bookId="exam:cet4" service={service} onExit={onExit} />)
    expect(screen.getByText('bursa')).toBeInTheDocument()
    expect(screen.queryByText('n. 滑膜囊')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show meaning' }))
    expect(screen.getByText('n. 滑膜囊')).toBeInTheDocument()
    expect(await screen.findByText('8 d')).toBeInTheDocument()
    expect(screen.getByText('sub-')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Good/ }))
    await waitFor(() =>
      expect(grade).toHaveBeenCalledWith('bursa', 3, 'learn', { bookId: 'exam:cet4' }),
    )
    expect(await screen.findByText('Session finished')).toBeInTheDocument()
  })

  it('grades spelling by itself and brings a misspelled word back once', async () => {
    const { service, grade } = fakeService()
    const items: SessionItem[] = [
      { view: view('tendon', 'n. 肌腱'), kind: 'review', mode: 'spell' },
      { view: view('ligament', 'n. 韧带'), kind: 'review', mode: 'spell' },
    ]
    render(<StudySession items={items} bookId={null} service={service} onExit={() => undefined} />)
    // The word itself is hidden while spelling.
    expect(screen.queryByText('tendon')).toBeNull()
    const input = screen.getByLabelText('Type the English word')
    fireEvent.change(input, { target: { value: 'Tendon' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByText('Correct')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(grade).toHaveBeenCalledWith('tendon', 3, 'spell', { correct: true }))

    fireEvent.change(await screen.findByLabelText('Type the English word'), {
      target: { value: 'ligamant' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('One letter off')).toBeInTheDocument()
    expect(screen.getByText('ligament')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(grade).toHaveBeenCalledWith('ligament', 2, 'spell', { correct: false }),
    )

    // A near miss is rated Hard, not forgotten, so it does not come back today.
    expect(await screen.findByText('Session finished')).toBeInTheDocument()
  })

  it('brings a forgotten word back in the same session', async () => {
    const { service, grade } = fakeService()
    render(
      <StudySession
        items={[
          {
            view: view('labrum', 'n. 唇', 'The glenoid labrum deepens the cavity.'),
            kind: 'review',
            mode: 'cloze',
          },
        ]}
        bookId={null}
        service={service}
        onExit={() => undefined}
      />,
    )
    expect(screen.getByText('The glenoid _____ deepens the cavity.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Don't know" }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(grade).toHaveBeenCalledWith('labrum', 1, 'cloze', { correct: false }),
    )
    // Back as recognition: the word is shown, the meaning hidden.
    expect(await screen.findByText('labrum')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show meaning' })).toBeInTheDocument()
  })
})
