import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, Layers, Loader2, Maximize2 } from 'lucide-react'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import { useFloatingQA } from '@/features/homework/floatingQAStore'
import { addNoteToCards, saveWindow, windowTitle } from '@/features/homework/floatingQA'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { computeSelectionPopupPosition, type PopupAnchor } from '@/shared/lib/popupPosition'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

export type PassageHoverSubject =
  { kind: 'window'; windowId: string } | { kind: 'note'; note: WalkthroughNote }

export interface PassageHoverCardProps {
  subject: PassageHoverSubject
  anchor: PopupAnchor
  /** Open the full window for this conversation. */
  onExpand: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}

/**
 * The conversation of a marked passage, shown while the pointer is over the
 * passage (a tucked conversation or a saved note): the latest question and
 * answer, with Open window and Save / Review cards.
 */
export function PassageHoverCard({
  subject,
  anchor,
  onExpand,
  onPointerEnter,
  onPointerLeave,
}: PassageHoverCardProps): JSX.Element | null {
  const { t } = useTranslation()
  // A saved note whose window is open shows the window's (newest) turns.
  const win = useFloatingQA((state) =>
    state.windows.find((window) =>
      subject.kind === 'window'
        ? window.id === subject.windowId
        : window.noteId === subject.note.id,
    ),
  )
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{
    left: number
    top: number
    maxHeight?: number
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const next = computeSelectionPopupPosition({
      anchor,
      popupWidth: element.offsetWidth,
      popupHeight: element.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    setPosition((previous) =>
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.maxHeight === next.maxHeight
        ? previous
        : {
            left: next.left,
            top: next.top,
            ...(next.maxHeight ? { maxHeight: next.maxHeight } : {}),
          },
    )
  }, [anchor, win?.turns.length, win?.pending])

  const source = win ?? (subject.kind === 'note' ? subject.note : null)
  if (!source) return null
  const turns = source.turns
  const latest = turns[turns.length - 1]
  const pending = win?.pending
  const noteId = win?.noteId ?? (subject.kind === 'note' ? subject.note.id : undefined)
  const title = win ? windowTitle(win, t) : subject.kind === 'note' ? subject.note.title : ''

  async function save(): Promise<void> {
    if (!win) return
    setBusy(true)
    try {
      const note = await saveWindow(win.id)
      if (note) toast({ variant: 'success', title: t('walkthroughQA.saved') })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('walkthroughQA.saveFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function addToCards(): Promise<void> {
    if (!noteId) return
    setBusy(true)
    try {
      const added = await addNoteToCards(noteId)
      toast({
        variant: added > 0 ? 'success' : 'info',
        title:
          added > 0
            ? t('walkthroughQA.cardsAdded', { count: added })
            : t('walkthroughQA.cardsNone'),
      })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('walkthroughQA.cardsFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-passage-hover-card
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        ...(position?.maxHeight ? { maxHeight: position.maxHeight } : {}),
        visibility: position ? undefined : 'hidden',
      }}
      // Above the dock (z-44), below dialogs (z-50).
      className="fixed z-[45] flex w-[min(22rem,calc(100vw-1rem))] animate-pop-in flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl lecture:rounded-2xl lecture:border-input lecture:shadow-lift lab:rounded-none lab:border-input lab:shadow-lift"
    >
      <p
        className="truncate border-b px-3 py-1.5 text-xs font-medium text-muted-foreground lecture:border-b-0 lecture:pt-2.5 lecture:font-heading lab:bg-background lab:font-mono lab:text-[11px]"
        title={title}
      >
        {title}
      </p>
      <div className="max-h-[320px] min-h-0 space-y-2 overflow-y-auto px-3 py-2">
        {pending ? (
          <>
            <p className="text-[13px] text-muted-foreground">{pending}</p>
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('contextual.thinking')}
            </p>
          </>
        ) : latest ? (
          <>
            <p className="text-[13px] text-muted-foreground">{latest.question}</p>
            <RichText
              text={latest.answer}
              format="markdown"
              className="space-y-2"
              paragraphClassName="text-[14px] leading-[1.7]"
            />
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('walkthroughQA.noAnswer')}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={onExpand}>
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          {t('walkthroughQA.expandWindow')}
        </Button>
        {!noteId && win ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || win.turns.length === 0}
            onClick={() => void save()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bookmark className="h-3.5 w-3.5" />
            )}
            {t('walkthroughQA.save')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !noteId}
            onClick={() => void addToCards()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="h-3.5 w-3.5" />
            )}
            {t('walkthroughQA.cardsShort')}
          </Button>
        )}
      </div>
    </div>,
    document.body,
  )
}
