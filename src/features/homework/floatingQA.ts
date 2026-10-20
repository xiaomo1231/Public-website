import { buildAIServices } from '@/services/aiServices'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import {
  clampRect,
  DEFAULT_WINDOW_SIZE,
  rectNearAnchor,
  useFloatingQA,
  type FloatingPassage,
} from './floatingQAStore'

/**
 * What the floating question windows do: ask (with the earlier turns, so a
 * follow-up is understood), save as a note, keep a saved note up to date, and
 * reopen a saved note where it was left.
 */

const noteListeners = new Set<() => void>()

/** The page re-reads its notes when one is saved, changed or deleted. */
export function subscribeNoteChanges(listener: () => void): () => void {
  noteListeners.add(listener)
  return () => noteListeners.delete(listener)
}

export function notifyNoteChanges(): void {
  for (const listener of noteListeners) listener()
}

const notes = () => new WalkthroughNoteService()

export function openPassage(
  passage: FloatingPassage,
  start: 'explain' | 'ask',
  anchor: { left: number; top: number; width: number; height: number },
): string {
  return useFloatingQA.getState().open({ passage, turns: [], rect: rectNearAnchor(anchor), start })
}

/** Bring a saved note back, in the window it already has or where it was left. */
export function openNote(note: WalkthroughNote, setTitle: string, language: 'zh' | 'en'): string {
  const store = useFloatingQA.getState()
  const existing = store.windows.find((window) => window.noteId === note.id)
  if (existing) {
    store.focus(existing.id)
    return existing.id
  }
  const fallback = {
    x: Math.round(window.innerWidth - DEFAULT_WINDOW_SIZE.width - 32),
    y: 96,
    ...DEFAULT_WINDOW_SIZE,
  }
  return store.open({
    passage: {
      projectId: note.projectId,
      setId: note.setId,
      setTitle,
      sectionId: note.sectionId,
      sectionTitle: note.sectionTitle,
      quote: note.quote,
      ...(note.latex ? { latex: note.latex } : {}),
      anchor: note.anchor,
      surrounding: note.surrounding,
      language,
    },
    turns: note.turns,
    noteId: note.id,
    title: note.title,
    rect: clampRect(note.rect ?? fallback),
  })
}

export async function askInWindow(id: string, question: string): Promise<void> {
  const store = useFloatingQA.getState()
  const win = store.windows.find((item) => item.id === id)
  const text = question.trim()
  if (!win || win.pending || !text) return
  store.update(id, { pending: text, error: undefined, start: undefined })
  try {
    const services = await buildAIServices()
    if (!services) {
      useFloatingQA.getState().update(id, { pending: undefined, error: t('translate.noProvider') })
      return
    }
    const { passage } = win
    const { answer } = await services.contextualTutor.ask({
      projectId: passage.projectId,
      contextKind: 'walkthrough',
      topicTitle: passage.setTitle,
      sectionHeading: passage.sectionTitle,
      selectedText: passage.latex ?? passage.quote,
      surroundingContext: passage.surrounding,
      question: text,
      language: passage.language,
      history: win.turns.map((turn) => ({ question: turn.question, answer: turn.answer })),
    })
    const turn = { question: text, answer, at: Date.now() }
    const current = useFloatingQA.getState().windows.find((item) => item.id === id)
    if (current) useFloatingQA.getState().update(id, { pending: undefined, turns: [...current.turns, turn] })
    // A saved conversation keeps saving, even if its window was closed meanwhile.
    const noteId = current?.noteId ?? win.noteId
    if (noteId) {
      await notes().appendTurn(noteId, turn)
      notifyNoteChanges()
    }
  } catch (err) {
    useFloatingQA.getState().update(id, { pending: undefined, error: friendlyAIError(err) })
  }
}

export async function saveWindow(id: string): Promise<WalkthroughNote | null> {
  const win = useFloatingQA.getState().windows.find((item) => item.id === id)
  if (!win || win.noteId || win.turns.length === 0) return null
  const { passage } = win
  const note = await notes().create({
    setId: passage.setId,
    sectionId: passage.sectionId,
    sectionTitle: passage.sectionTitle,
    quote: passage.quote,
    ...(passage.latex ? { latex: passage.latex } : {}),
    anchor: passage.anchor,
    surrounding: passage.surrounding,
    turns: win.turns,
    rect: win.rect,
    titleFromQuote: win.turns[0]?.question === t('contextual.explainQuestion'),
  })
  useFloatingQA.getState().update(id, { noteId: note.id, title: note.title })
  notifyNoteChanges()
  return note
}

export async function renameNote(noteId: string, title: string): Promise<WalkthroughNote> {
  const note = await notes().rename(noteId, title)
  const store = useFloatingQA.getState()
  for (const window of store.windows) if (window.noteId === noteId) store.update(window.id, { title: note.title })
  notifyNoteChanges()
  return note
}

export async function deleteNote(noteId: string): Promise<void> {
  await notes().delete(noteId)
  const store = useFloatingQA.getState()
  for (const window of store.windows) if (window.noteId === noteId) store.close(window.id)
  notifyNoteChanges()
}

export function addNoteToCards(noteId: string): Promise<number> {
  return notes().addToReviewCards(noteId)
}

/** After a drag or resize: remember the place of a saved note's window. */
export async function persistWindowRect(id: string): Promise<void> {
  const win = useFloatingQA.getState().windows.find((item) => item.id === id)
  if (win?.noteId) await notes().saveRect(win.noteId, win.rect)
}
