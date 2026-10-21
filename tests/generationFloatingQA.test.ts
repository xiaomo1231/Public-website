import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { AbortedError } from '@/infrastructure/ai/errors'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'

const ask = vi.fn(
  (input: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      input.signal?.addEventListener('abort', () => reject(new AbortedError()))
    }),
)
vi.mock('@/services/aiServices', () => ({
  buildAIServices: async () => ({ contextualTutor: { ask } }),
}))

const { askInWindow, isAskingInWindow, openPassage, stopInWindow } =
  await import('@/features/homework/floatingQA')
const { useFloatingQA } = await import('@/features/homework/floatingQAStore')

describe('stopping a floating question', () => {
  it('aborts the request and saves neither an answer nor an error', async () => {
    const id = openPassage(
      {
        projectId: 'p',
        setId: 's',
        setTitle: 'HW',
        sectionId: 'q:1',
        sectionTitle: '1',
        quote: 'x',
        anchor: { text: 'x', prefix: '', suffix: '' },
        surrounding: 'x',
        language: 'en',
      },
      'ask',
      { left: 0, top: 0, width: 10, height: 10 },
    )
    const asking = askInWindow(id, 'Why?')
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    expect(isAskingInWindow(id)).toBe(true)
    expect(stopInWindow(id)).toBe('Why?')
    await asking
    const win = useFloatingQA.getState().windows.find((item) => item.id === id)!
    expect(win.pending).toBeUndefined()
    expect(win.error).toBeUndefined()
    expect(win.turns).toEqual([])
    expect(isAskingInWindow(id)).toBe(false)
  })

  it('sends the whole stored section (with its matrices) as context', async () => {
    const db = new AppDatabase()
    setDbForTesting(db)
    await db.homeworkWalkthroughs.put({
      id: 's2:en',
      projectId: 'p',
      setId: 's2',
      language: 'en',
      createdAt: 1,
      updatedAt: 1,
      sections: [
        {
          id: 'q:1',
          kind: 'question',
          title: '1',
          body: String.raw`Reduce $$\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}$$ by rows.`,
          status: 'ready',
          inputHash: 'h',
          generatedAt: 1,
        },
      ],
    })
    ask.mockClear()
    const id = openPassage(
      {
        projectId: 'p',
        setId: 's2',
        setTitle: 'HW',
        sectionId: 'q:1',
        sectionTitle: '1',
        quote: 'by rows',
        anchor: { text: 'by rows', prefix: '', suffix: '' },
        surrounding: 'Reduce by rows.',
        language: 'en',
      },
      'ask',
      { left: 0, top: 0, width: 10, height: 10 },
    )
    const asking = askInWindow(id, 'Which row?')
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    const input = ask.mock.calls[0]![0] as unknown as { surroundingContext: string }
    expect(input.surroundingContext).toContain('1 & 2 & 3')
    stopInWindow(id)
    await asking
    db.close()
  })
})
