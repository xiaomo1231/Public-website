import { buildAIServices } from '@/services/aiServices'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import { buildWalkthroughContext } from '@/services/walkthroughContext'
import type { NoteDisplay, WalkthroughNote } from '@/entities/homework/walkthrough'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { toast } from '@/features/toast/toastStore'
import { t } from '@/i18n'
import {
  clampCard,
  clampRect,
  DEFAULT_WINDOW_SIZE,
  enterOriginNear,
  rectNearAnchor,
  useFloatingQA,
  windowMode,
  type CompactCard,
  type FloatingPassage,
  type FloatingQAWindow,
} from './floatingQAStore'

/**
 * What the floating question windows do: ask (with the earlier turns, so a
 * follow-up is understood), save as a note (automatically once the first
 * answer arrives), keep a saved note up to date — its turns and how / where it
 * is shown — and bring saved notes back where they were left.
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

/** A window's name: its saved title, else the quoted passage. */
export function windowTitle(
  window: Pick<FloatingQAWindow, 'title' | 'passage'>,
  translate: typeof t = t,
): string {
  if (window.title) return window.title
  const quote = window.passage.quote.replace(/\s+/g, ' ').trim()
  return quote
    ? `“${quote.length > 28 ? `${quote.slice(0, 27)}…` : quote}”`
    : translate('walkthroughQA.title')
}

export function openPassage(
  passage: FloatingPassage,
  start: 'explain' | 'ask',
  anchor: { left: number; top: number; width: number; height: number },
): string {
  const rect = rectNearAnchor(anchor)
  return useFloatingQA
    .getState()
    .open({ passage, turns: [], rect, start, enterOrigin: enterOriginNear(rect, anchor) })
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
    ...(note.cardSize ? { cardSize: note.cardSize } : {}),
  })
}

/** The request of each window waiting for an answer, so 停止 can abort it. */
const inFlight = new Map<string, AbortController>()

/**
 * Stop the answer a window is waiting for. Nothing is saved for it — no turn,
 * no error — and the question is returned so it can be asked again.
 */
export function stopInWindow(id: string): string | undefined {
  const controller = inFlight.get(id)
  if (!controller) return undefined
  inFlight.delete(id)
  controller.abort()
  const win = useFloatingQA.getState().windows.find((item) => item.id === id)
  const question = win?.pending
  if (win) useFloatingQA.getState().update(id, { pending: undefined, error: undefined })
  return question
}

/** Whether a window is waiting for an answer that can be stopped. */
export function isAskingInWindow(id: string): boolean {
  return inFlight.has(id)
}

export async function askInWindow(id: string, question: string): Promise<void> {
  const store = useFloatingQA.getState()
  const win = store.windows.find((item) => item.id === id)
  const text = question.trim()
  if (!win || win.pending || !text) return
  store.update(id, { pending: text, error: undefined, start: undefined })
  const controller = new AbortController()
  inFlight.set(id, controller)
  try {
    const services = await buildAIServices()
    if (!services) {
      useFloatingQA.getState().update(id, { pending: undefined, error: t('translate.noProvider') })
      return
    }
    const { passage } = win
    // The whole section as written (with its matrices and equations), not only
    // the paragraph around the selection. Local and fast.
    const surroundingContext = await buildWalkthroughContext({
      setId: passage.setId,
      sectionId: passage.sectionId,
      quote: passage.quote,
      surrounding: passage.surrounding,
    })
    if (controller.signal.aborted) return
    const { answer } = await services.contextualTutor.ask({
      projectId: passage.projectId,
      contextKind: 'walkthrough',
      topicTitle: passage.setTitle,
      sectionHeading: passage.sectionTitle,
      selectedText: passage.latex ?? passage.quote,
      surroundingContext,
      question: text,
      language: passage.language,
      history: win.turns.map((turn) => ({ question: turn.question, answer: turn.answer })),
      signal: controller.signal,
    })
    // Stopped while the answer was arriving: it is dropped, nothing is saved.
    if (controller.signal.aborted) return
    const turn = { question: text, answer, at: Date.now() }
    const current = useFloatingQA.getState().windows.find((item) => item.id === id)
    if (current)
      useFloatingQA.getState().update(id, { pending: undefined, turns: [...current.turns, turn] })
    // Saving is not part of the answer: a failed write is reported, the answer stays.
    try {
      // A saved conversation keeps saving, even if its window was closed meanwhile.
      const noteId = current?.noteId ?? win.noteId
      if (noteId) {
        await notes().appendTurn(noteId, turn)
        notifyNoteChanges()
      } else if (current) {
        // The first answer: kept as a note right away, so a reload keeps it.
        await saveWindow(id)
      }
    } catch (err) {
      reportWriteFailure(err)
    }
  } catch (err) {
    // A stop is not a failure: `stopInWindow` already cleared the window.
    if (controller.signal.aborted) return
    useFloatingQA.getState().update(id, { pending: undefined, error: friendlyAIError(err) })
  } finally {
    if (inFlight.get(id) === controller) inFlight.delete(id)
  }
}

/** Saves in progress, so a click on 保存 during the automatic save makes no second note. */
const saving = new Map<string, Promise<WalkthroughNote | null>>()

/** Save a window as a note (once; later calls while saving share the same save). */
export function saveWindow(id: string): Promise<WalkthroughNote | null> {
  const running = saving.get(id)
  if (running) return running
  const save = createNote(id).finally(() => saving.delete(id))
  saving.set(id, save)
  return save
}

async function createNote(id: string): Promise<WalkthroughNote | null> {
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
    ...(win.cardSize ? { cardSize: win.cardSize } : {}),
    display: displayOf(win),
    titleFromQuote: win.turns[0]?.question === t('contextual.explainQuestion'),
  })
  // The window may have moved / changed while saving: the display sync writes
  // its current state (it watches windows with a note).
  useFloatingQA.getState().update(id, { noteId: note.id, title: note.title })
  notifyNoteChanges()
  return note
}

/** How a window is shown, as stored on its note. */
export function displayOf(win: FloatingQAWindow): NoteDisplay {
  const mode = windowMode(win)
  if (mode !== 'compact' || !win.compact) return { mode }
  const { x, y, pinned, width, height, manual } = win.compact
  return {
    mode,
    card: {
      x,
      y,
      pinned,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(manual ? { manual } : {}),
    },
  }
}

/** A failed write is never silent. */
function reportWriteFailure(err: unknown): void {
  toast({
    variant: 'error',
    title: t('walkthroughQA.saveFailed'),
    description: friendlyAIError(err),
  })
}

// --- Keeping a note's display in step with its window -----------------------

/** What was last written per note (display + rect), so unchanged state is not rewritten. */
const writtenDisplay = new Map<string, string>()
const pendingDisplayWrites = new Map<string, ReturnType<typeof setTimeout>>()
/** Writes are grouped: a burst of moves / re-fits becomes one write. */
export const DISPLAY_WRITE_DELAY_MS = 200

function cancelDisplayWrite(noteId: string): void {
  const timer = pendingDisplayWrites.get(noteId)
  if (timer !== undefined) clearTimeout(timer)
  pendingDisplayWrites.delete(noteId)
}

function syncDisplays(windows: readonly FloatingQAWindow[]): void {
  for (const win of windows) {
    const noteId = win.noteId
    if (!noteId) continue
    const display = displayOf(win)
    const rect = win.rect
    const signature = JSON.stringify([display, rect])
    if (writtenDisplay.get(noteId) === signature) continue
    writtenDisplay.set(noteId, signature)
    cancelDisplayWrite(noteId)
    pendingDisplayWrites.set(
      noteId,
      setTimeout(() => {
        pendingDisplayWrites.delete(noteId)
        notes()
          .saveDisplay(noteId, display, rect)
          .catch((err: unknown) => {
            // Try again on the next change.
            writtenDisplay.delete(noteId)
            reportWriteFailure(err)
          })
      }, DISPLAY_WRITE_DELAY_MS),
    )
  }
}

let syncUsers = 0
let stopSync: (() => void) | undefined

/**
 * While a walkthrough is open: save how each saved note's window is shown
 * (full / card / tucked / dock, its place and pin) whenever that changes.
 * Windows that disappear because the page is left are not "closed" — only
 * `closeWindow` clears a note's display.
 */
export function installNoteDisplaySync(): () => void {
  syncUsers += 1
  if (syncUsers === 1) stopSync = useFloatingQA.subscribe((state) => syncDisplays(state.windows))
  syncDisplays(useFloatingQA.getState().windows)
  return () => {
    syncUsers -= 1
    if (syncUsers > 0) return
    stopSync?.()
    stopSync = undefined
  }
}

/**
 * Close a window. A saved note stays in 我的问答 (and its chip / mark) but no
 * longer comes back open after a reload.
 */
export function closeWindow(id: string): void {
  const win = useFloatingQA.getState().windows.find((item) => item.id === id)
  useFloatingQA.getState().close(id)
  const noteId = win?.noteId
  if (!noteId) return
  cancelDisplayWrite(noteId)
  writtenDisplay.delete(noteId)
  // The page re-reads its notes, so a closed one is not brought back as open.
  notes().saveDisplay(noteId, undefined).then(notifyNoteChanges, reportWriteFailure)
}

/**
 * After a reload: bring back the notes that were kept on the page, the way
 * they were shown (oldest first, so the latest is in front; the limits move
 * the extra ones to the dock). A card that followed the page goes back into
 * `cardLayer` at its content coordinates; without one it is pinned instead.
 * Notes already open are left alone.
 */
export function restoreNotes(
  list: readonly WalkthroughNote[],
  setTitle: string,
  language: 'zh' | 'en',
  cardLayer: HTMLElement | null,
): number {
  const store = useFloatingQA.getState()
  const open = new Set(store.windows.map((window) => window.noteId).filter(Boolean))
  const kept = list
    .filter((note) => note.display && !open.has(note.id))
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const note of kept) {
    const display = note.display!
    const id = openNote(note, setTitle, language)
    if (display.mode === 'compact' && display.card) {
      const saved = display.card
      const attached = !saved.pinned && cardLayer
      const card: CompactCard = clampCard(
        { ...saved, pinned: !attached },
        attached
          ? { width: cardLayer.clientWidth, height: cardLayer.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight },
      )
      // Restoring is not the learner's pin choice for new cards.
      const { cardPinned } = useFloatingQA.getState()
      store.compact(id, card)
      useFloatingQA.setState({ cardPinned })
    } else if (display.mode === 'tucked') {
      store.tuck(id)
    } else if (display.mode === 'minimized') {
      store.setMinimized(id, true)
    }
  }
  return kept.length
}

export async function renameNote(noteId: string, title: string): Promise<WalkthroughNote> {
  const note = await notes().rename(noteId, title)
  const store = useFloatingQA.getState()
  for (const window of store.windows)
    if (window.noteId === noteId) store.update(window.id, { title: note.title })
  notifyNoteChanges()
  return note
}

export async function deleteNote(noteId: string): Promise<void> {
  await notes().delete(noteId)
  cancelDisplayWrite(noteId)
  writtenDisplay.delete(noteId)
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

/** After resizing a card: remember a saved note's card size. */
export async function persistCardSize(id: string): Promise<void> {
  const win = useFloatingQA.getState().windows.find((item) => item.id === id)
  if (win?.noteId && win.cardSize) await notes().saveCardSize(win.noteId, win.cardSize)
}
