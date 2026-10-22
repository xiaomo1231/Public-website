import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import { useToastStore } from '@/features/toast/toastStore'
import type { HomeworkSet } from '@/entities/homework/types'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'

const ask = vi.fn(async (input: { question: string }) => ({
  answer: `Answer to ${input.question}`,
}))
vi.mock('@/services/aiServices', () => ({
  buildAIServices: async () => ({ contextualTutor: { ask } }),
}))

const {
  askInWindow,
  closeWindow,
  deleteNote,
  installNoteDisplaySync,
  openPassage,
  restoreNotes,
  saveWindow,
  DISPLAY_WRITE_DELAY_MS,
} = await import('@/features/homework/floatingQA')
const { useFloatingQA, windowMode } = await import('@/features/homework/floatingQAStore')

const SET = 's1'
let db: AppDatabase
let stopSync: () => void

function passage(quote = 'subtract row 1') {
  return {
    projectId: 'p1',
    setId: SET,
    setTitle: 'HW',
    sectionId: 'q:1',
    sectionTitle: '1',
    quote,
    anchor: { text: quote, prefix: '', suffix: '' },
    surrounding: quote,
    language: 'en' as const,
  }
}

async function askNew(question = 'Why?'): Promise<string> {
  const id = openPassage(passage(), 'ask', { left: 0, top: 0, width: 10, height: 10 })
  await askInWindow(id, question)
  return id
}

function win(id: string) {
  return useFloatingQA.getState().windows.find((item) => item.id === id)!
}

async function stored(): Promise<WalkthroughNote[]> {
  return new WalkthroughNoteService(db).list(SET)
}

/** Let the grouped display write land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, DISPLAY_WRITE_DELAY_MS + 30))
}

/** A reload: the visit's windows are gone; the page restores from the database. */
async function reload(cardLayer: HTMLElement | null = null): Promise<void> {
  useFloatingQA.setState({ windows: [], nextZ: 1 })
  restoreNotes(await stored(), 'HW', 'en', cardLayer)
}

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  await db.homeworkSets.put({ id: SET, projectId: 'p1', title: 'HW' } as unknown as HomeworkSet)
  useFloatingQA.setState({ windows: [], nextZ: 1, cardPinned: true })
  useToastStore.setState({ toasts: [] })
  stopSync = installNoteDisplaySync()
})

afterEach(async () => {
  stopSync()
  await settle()
  db.close()
  setDbForTesting(null)
})

describe('Q&A kept on the page survives a reload', () => {
  it('saves a conversation once it has an answer, with its follow-ups', async () => {
    const id = await askNew('Why?')
    expect(win(id).noteId).toBeTruthy()
    await askInWindow(id, 'And row 3?')
    const [note] = await stored()
    expect(note!.turns.map((turn) => turn.question)).toEqual(['Why?', 'And row 3?'])
    expect(note!.display).toEqual({ mode: 'full' })
    // A click on 保存 now does nothing more.
    expect(await saveWindow(id)).toBeNull()
    expect(await stored()).toHaveLength(1)
  })

  it('brings a pinned card back at the same place with its turns', async () => {
    const id = await askNew()
    useFloatingQA.getState().compact(id, { x: 120, y: 90, pinned: true, width: 300, height: 180 })
    await settle()
    expect((await stored())[0]!.display).toMatchObject({
      mode: 'compact',
      card: { x: 120, y: 90, pinned: true, width: 300 },
    })

    await reload()
    const [restored] = useFloatingQA.getState().windows
    expect(windowMode(restored!)).toBe('compact')
    expect(restored!.compact).toMatchObject({ x: 120, y: 90, pinned: true, width: 300 })
    expect(restored!.turns).toHaveLength(1)
    expect(restored!.noteId).toBeTruthy()
  })

  it('puts a card that followed the page back into the card layer, in content coordinates', async () => {
    const id = await askNew()
    useFloatingQA.getState().compact(id, { x: 40, y: 1500, pinned: false, width: 300, height: 160 })
    await settle()
    const layer = document.createElement('div')
    Object.defineProperty(layer, 'clientWidth', { value: 800 })
    Object.defineProperty(layer, 'clientHeight', { value: 3000 })
    await reload(layer)
    const [restored] = useFloatingQA.getState().windows
    expect(restored!.compact).toMatchObject({ x: 40, y: 1500, pinned: false })
  })

  it('restores a conversation tucked into the text, and one in the dock', async () => {
    const tucked = await askNew('Tucked?')
    const docked = await askNew('Docked?')
    useFloatingQA.getState().tuck(tucked)
    useFloatingQA.getState().setMinimized(docked, true)
    await settle()
    await reload()
    const modes = useFloatingQA
      .getState()
      .windows.map((item) => [item.turns[0]!.question, windowMode(item)])
    expect(modes).toEqual(
      expect.arrayContaining([
        ['Tucked?', 'tucked'],
        ['Docked?', 'minimized'],
      ]),
    )
  })

  it('a closed note stays saved but does not come back open; delete removes it', async () => {
    const id = await askNew()
    const noteId = win(id).noteId!
    closeWindow(id)
    await settle()
    const [note] = await stored()
    expect(note!.display).toBeUndefined()
    await reload()
    expect(useFloatingQA.getState().windows).toHaveLength(0)

    await deleteNote(noteId)
    expect(await stored()).toHaveLength(0)
  })

  it('leaves old notes (no display) closed', async () => {
    await new WalkthroughNoteService(db).create({
      setId: SET,
      sectionId: 'q:1',
      sectionTitle: '1',
      quote: 'old',
      anchor: { text: 'old', prefix: '', suffix: '' },
      surrounding: 'old',
      turns: [{ question: 'Old?', answer: 'Yes.', at: 1 }],
    })
    await reload()
    expect(useFloatingQA.getState().windows).toHaveLength(0)
  })

  it('reports a failed write instead of losing it silently', async () => {
    const id = await askNew()
    const spy = vi
      .spyOn(WalkthroughNoteService.prototype, 'saveDisplay')
      .mockRejectedValue(new Error('QuotaExceededError'))
    useFloatingQA.getState().tuck(id)
    await settle()
    expect(useToastStore.getState().toasts.some((item) => item.variant === 'error')).toBe(true)
    spy.mockRestore()
  })
})
