import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Languages, Lightbulb, Loader2, MessageCircleQuestion, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  ContextualTutorPopup,
  type ContextualTutorContext,
} from '@/widgets/tutor/ContextualTutorPopup'
import { buildAIServices } from '@/services/aiServices'
import { useAuth } from '@/features/auth/useAuth'
import { useCurrentProject } from '@/features/project/useCurrentProject'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import type { ContextualTutorKind } from '@/infrastructure/ai/prompts/contextual-tutor/v3'
import { describeAnchor, type TextAnchor } from '@/shared/lib/textAnchor'
import { openPassage } from '@/features/homework/floatingQA'
import { isTouchLike } from '@/shared/lib/pointerGesture'
import { selectionTextWithMath } from '@/shared/lib/selectionText'
import { RichText } from '@/shared/ui/RichText'
import {
  computeSelectionPopupPosition,
  isPopupAnchorVisible,
  TOUCH_POPUP_GAP,
  type PopupAnchor,
  type PopupPosition,
} from '@/shared/lib/popupPosition'

/** Which action the learner chose for the current selection. */
type SelectionAction = 'translate' | 'explain' | 'ask'

interface SelectionState {
  text: string
  surrounding: string
  /** Original LaTeX when the selection is inside a rendered formula. */
  canonicalLatex?: string
  sectionHeading?: string
  topicTitle?: string
  projectId?: string
  topicId?: string
  contextKind?: ContextualTutorKind
  language: string
  fromVisual: boolean
  tooLong: boolean
  /** The selection's viewport rectangle; the anchor for every re-position. */
  anchor: PopupAnchor
  mobile: boolean
  /**
   * Made with a finger or pen (iPadOS): the popup goes below the selection,
   * clear of the native selection menu above it and the handle below it.
   */
  touch: boolean
  /** Inside a homework walkthrough: Explain / Ask open a floating window. */
  walkthrough?: WalkthroughSelection
}

interface WalkthroughSelection {
  projectId: string
  setId: string
  setTitle: string
  sectionId: string
  sectionTitle: string
  textAnchor: TextAnchor
}

interface TranslationResult {
  translation: string
  contextNote: string
  alternatives: string[]
}

/** Longest selection worth sending; beyond this the learner is told to narrow it. */
const MAX_SELECTION = 600

/** Idle pause after which a selection that changed without a release counts as settled. */
const SELECTION_SETTLE_MS = 120

/**
 * The same for a touch / pen selection. iPadOS handle drags send no pointer
 * events, only selectionchange, so a longer pause stands in for "released".
 */
export const SELECTION_SETTLE_TOUCH_MS = 400

/** The part of a popup position that affects rendering. */
type PopupLayout = Pick<PopupPosition, 'side' | 'maxHeight'>

function layoutOf(position: PopupPosition): PopupLayout {
  return {
    side: position.side,
    ...(position.maxHeight !== undefined ? { maxHeight: position.maxHeight } : {}),
  }
}

function translateFor(position: Pick<PopupPosition, 'left' | 'top'>): string {
  return `translate3d(${position.left}px, ${position.top}px, 0)`
}

const nodeIds = new WeakMap<Node, number>()
let nextNodeId = 1

/** A stable per-node number, so equal text in different places gets different keys. */
function nodeId(node: Node): number {
  let id = nodeIds.get(node)
  if (id === undefined) {
    id = nextNodeId++
    nodeIds.set(node, id)
  }
  return id
}

/**
 * Identity of a selected range, to ignore repeated events for the same
 * selection. Includes the boundary nodes: selecting the same text elsewhere
 * must re-anchor the popup.
 */
function selectionKey(range: Range, text: string): string {
  return `${nodeId(range.startContainer)}:${range.startOffset}:${nodeId(range.endContainer)}:${range.endOffset}:${text}`
}

/** The current visual viewport, falling back to the layout viewport. */
function readViewport(): {
  width: number
  height: number
  offsetTop: number
  offsetLeft: number
} {
  const vv = window.visualViewport
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
    offsetTop: vv?.offsetTop ?? 0,
    offsetLeft: vv?.offsetLeft ?? 0,
  }
}

/**
 * Selection toolbar for the reading surfaces.
 *
 * On selection it offers three *separate* actions:
 *   - Translate  → the existing translation service (unchanged)
 *   - Explain    → the contextual tutor, no question needed
 *   - Ask AI     → the contextual tutor with the learner's own question
 *
 * Selection alone never calls the AI. The contextual conversation lives in the
 * popup and is never written to the Tutor lesson cache or translation history.
 */
export function SelectionTranslator(): JSX.Element | null {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [action, setAction] = useState<SelectionAction | null>(null)
  const [translation, setTranslation] = useState<TranslationResult | null>(null)
  const [translating, setTranslating] = useState(false)
  // Only the side and height clamp live in state; left/top are written to the
  // element as a transform so scrolling never re-renders the popup.
  const [layout, setLayout] = useState<PopupLayout | null>(null)
  const { profile } = useAuth()
  const currentProject = useCurrentProject()
  const containerRef = useRef<HTMLDivElement>(null)
  // Mirrors state so the selection listener never reads a stale closure.
  const translatingRef = useRef(false)
  // Identity of the selection the popup currently shows, so a late
  // selectionchange for the same range does not reset the chosen action.
  const shownKeyRef = useRef<string | null>(null)

  useEffect(() => {
    translatingRef.current = translating
  }, [translating])

  /** The running translation, aborted when the popup closes. */
  const translationAbort = useRef<AbortController | null>(null)
  useEffect(() => () => translationAbort.current?.abort(), [])

  const closeAll = useCallback((): void => {
    // Closing stops the translation: otherwise it keeps running unseen and
    // blocks every new selection until it settles.
    translationAbort.current?.abort()
    translationAbort.current = null
    translatingRef.current = false
    setTranslating(false)
    setSelection(null)
    setAction(null)
    setTranslation(null)
    setLayout(null)
    shownKeyRef.current = null
  }, [])

  useEffect(() => {
    // Dragging a selection fires selectionchange on every pointer move. Those
    // events only remember the range; the expensive work (layout reads, DOM
    // walks, state updates) runs once the selection settles — on pointer /
    // key release, or after a short idle pause (touch handles, programmatic).
    let pending: Range | null = null
    let pointerDown = false
    // The kind of the last press: a touch / pen selection settles more slowly
    // and its popup prefers to sit below the text.
    let lastPointerType = 'mouse'
    let timer: ReturnType<typeof setTimeout> | undefined

    function clearTimer(): void {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    function flush(): void {
      clearTimer()
      const next = pending
      pending = null
      if (next) processSelection(next)
    }

    function processSelection(range: Range): void {
      if (translatingRef.current) return
      // Selecting text inside our own popup (e.g. in the textarea) must not
      // replace the context or close the conversation.
      if (containerRef.current?.contains(range.commonAncestorContainer)) return

      // Prefer the live selection's text (it follows rendering, e.g. skips the
      // hidden KaTeX annotation); fall back to the stored range.
      const sel = window.getSelection()
      const live = sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.getRangeAt(0) === range
      const plain = (live ? sel.toString() : range.toString()).trim()
      if (!plain) return
      // Formulas once, as LaTeX — the plain string repeats each one (MathML +
      // HTML copies). Anchors below still use the plain range text.
      const text = selectionTextWithMath(range) || plain

      const key = selectionKey(range, text)
      if (key === shownKeyRef.current) return

      // jsdom (and some embedded webviews) do not implement Range rects.
      const rect =
        typeof range.getBoundingClientRect === 'function'
          ? range.getBoundingClientRect()
          : { left: 0, top: 0, width: 0, height: 0 }
      const route = parseTopicRoute(window.location.pathname)
      const homeworkScope = elementFor(range.startContainer)?.closest(
        '[data-selection-context="homework"]',
      )
      const homeworkProject = homeworkScope ? parseProjectRoute(window.location.pathname) : null
      const mobile = window.innerWidth < 640
      const touch = isTouchLike(lastPointerType)
      const anchor: PopupAnchor = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }

      const canonicalLatex = extractCanonicalLatex(range)
      const surrounding = getSurroundingParagraph(range)
      const sectionHeading = getSectionHeading(range)
      const topicTitle = homeworkScope?.getAttribute('data-selection-title') || getTopicTitle(range)
      const walkthrough = readWalkthroughSelection(range)

      shownKeyRef.current = key
      // The layout effect below measures the real popup and places it (as a
      // transform) before the first paint.
      setAction(null)
      setTranslation(null)
      setLayout(null)
      setSelection({
        text,
        surrounding,
        ...(canonicalLatex ? { canonicalLatex } : {}),
        ...(sectionHeading ? { sectionHeading } : {}),
        ...(topicTitle ? { topicTitle } : {}),
        ...(route ??
          (homeworkProject
            ? { projectId: homeworkProject }
            : walkthrough
              ? { projectId: walkthrough.projectId }
              : {})),
        ...(walkthrough
          ? { contextKind: 'walkthrough' as const }
          : homeworkProject
            ? { contextKind: 'homework' as const }
            : {}),
        language: detectLanguage(`${text} ${surrounding}`),
        fromVisual: isInsideVisual(range),
        tooLong: text.length > MAX_SELECTION,
        anchor,
        mobile,
        touch,
        ...(walkthrough ? { walkthrough } : {}),
      })
    }

    function onSelectionChange(): void {
      if (translatingRef.current) return
      const sel = window.getSelection()
      // A collapsed selection is handled by the outside-click listener, which
      // knows whether the click landed inside our own popup.
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        pending = null
        clearTimer()
        return
      }
      pending = sel.getRangeAt(0)
      clearTimer()
      // While the pointer is down the selection is still being dragged; the
      // release flushes it.
      if (!pointerDown)
        timer = setTimeout(
          flush,
          isTouchLike(lastPointerType) ? SELECTION_SETTLE_TOUCH_MS : SELECTION_SETTLE_MS,
        )
    }

    function onPointerDown(event: PointerEvent): void {
      pointerDown = true
      lastPointerType = event.pointerType || 'mouse'
    }
    function onTouchStart(): void {
      // Browsers without Pointer Events for touch (old webviews).
      lastPointerType = 'touch'
    }
    function onRelease(): void {
      pointerDown = false
      if (pending) flush()
    }

    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onRelease, true)
    window.addEventListener('pointercancel', onRelease, true)
    window.addEventListener('keyup', onRelease, true)
    // A long-press selection may end without a pointerup (iPadOS hands the
    // gesture to its selection UI); the touch still ends.
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    window.addEventListener('touchend', onRelease, true)
    window.addEventListener('touchcancel', onRelease, true)
    return () => {
      clearTimer()
      window.removeEventListener('touchstart', onTouchStart, true)
      window.removeEventListener('touchend', onRelease, true)
      window.removeEventListener('touchcancel', onRelease, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onRelease, true)
      window.removeEventListener('pointercancel', onRelease, true)
      window.removeEventListener('keyup', onRelease, true)
    }
  }, [])

  useEffect(() => {
    if (!selection) return
    function onPointerDown(event: MouseEvent): void {
      if (containerRef.current?.contains(event.target as Node)) return
      closeAll()
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeAll()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selection, closeAll])

  // Keep the popup inside the visual viewport: recompute from the real anchor
  // and the real popup size whenever the content, viewport or scroll changes.
  const reposition = useCallback((): void => {
    if (!selection) return
    const element = containerRef.current
    // Prefer the *live* selection so scrolling the page keeps the popup next to
    // the text; fall back to the stored rectangle when the selection is gone
    // (e.g. the browser collapsed it) or the rect is not measurable.
    const anchor = resolveLiveAnchor(selection, element)
    const viewport = readViewport()
    if (
      !isPopupAnchorVisible({
        anchor,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewportOffsetTop: viewport.offsetTop,
        viewportOffsetLeft: viewport.offsetLeft,
      })
    ) {
      closeAll()
      return
    }
    const rect = element?.getBoundingClientRect()
    const popupWidth = rect?.width ?? 0
    // `scrollHeight` is the natural content height even while a previous
    // `maxHeight` clamps the element, so measuring it cannot oscillate.
    const popupHeight = element ? element.scrollHeight || rect?.height || 0 : 0
    const next = computeSelectionPopupPosition({
      anchor,
      popupWidth,
      popupHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportOffsetTop: viewport.offsetTop,
      viewportOffsetLeft: viewport.offsetLeft,
      mobile: selection.mobile,
      ...(selection.touch ? { prefer: 'bottom' as const, gap: TOUCH_POPUP_GAP } : {}),
    })
    if (element) element.style.transform = translateFor(next)
    // Re-render only when the side or the height clamp actually changes.
    setLayout((previous) =>
      previous && previous.side === next.side && previous.maxHeight === next.maxHeight
        ? previous
        : layoutOf(next),
    )
  }, [selection, closeAll])

  useLayoutEffect(() => {
    if (!selection) return
    reposition()
    const element = containerRef.current
    const observer =
      element && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => reposition())
        : null
    if (element) observer?.observe(element)
    // Scroll fires many times per frame; measure at most once per frame.
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        reposition()
      })
    }
    window.addEventListener('resize', reposition)
    // Capture-phase scroll catches scrolling containers, not just the window.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    const vv = window.visualViewport
    vv?.addEventListener('resize', reposition)
    vv?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', onScroll, true)
      vv?.removeEventListener('resize', reposition)
      vv?.removeEventListener('scroll', onScroll)
    }
  }, [selection, action, translation, translating, reposition])

  async function translate(): Promise<void> {
    if (!selection || selection.tooLong) return
    if (!currentProject) {
      toast({ variant: 'warning', title: t('translate.noProject') })
      setAction(null)
      return
    }
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({ variant: 'error', title: t('translate.noProvider') })
      setAction(null)
      return
    }
    const detected = detectLanguage(selection.text)
    const source: 'zh' | 'en' = detected === 'zh' ? 'zh' : 'en'
    const preferred: 'zh' | 'en' | null =
      profile?.language && profile.language !== 'auto' ? profile.language : null
    // Translating into the language the passage is already written in is
    // useless: then the other language is the target.
    const targetLang: 'zh' | 'en' =
      preferred && preferred !== source ? preferred : source === 'zh' ? 'en' : 'zh'
    const controller = new AbortController()
    translationAbort.current = controller
    setTranslating(true)
    try {
      const entry = await bundle.translation.translate({
        signal: controller.signal,
        projectId: currentProject.id,
        selectedText: selection.text,
        surroundingContext: selection.surrounding,
        sourceLanguage: source,
        targetLanguage: targetLang,
      })
      if (controller.signal.aborted) return
      setTranslation({
        translation: entry.translation,
        contextNote: entry.contextNote,
        alternatives: entry.alternatives,
      })
    } catch (err) {
      // Closed while translating: nothing to report.
      if (controller.signal.aborted) return
      toast({ variant: 'error', title: t('translate.failed'), description: friendlyAIError(err) })
      setAction(null)
    } finally {
      if (translationAbort.current === controller) {
        translationAbort.current = null
        setTranslating(false)
      }
    }
  }

  // Choosing "Translate" runs it once; the AI is never called on selection alone.
  useEffect(() => {
    if (action === 'translate') void translate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  // In a walkthrough the answer becomes a floating window the learner can move
  // and keep, instead of a popup tied to the selection.
  useEffect(() => {
    if ((action !== 'explain' && action !== 'ask') || !selection?.walkthrough) return
    const { walkthrough: scope } = selection
    openPassage(
      {
        projectId: scope.projectId,
        setId: scope.setId,
        setTitle: scope.setTitle,
        sectionId: scope.sectionId,
        sectionTitle: scope.sectionTitle,
        quote: selection.text,
        ...(selection.canonicalLatex ? { latex: selection.canonicalLatex } : {}),
        anchor: scope.textAnchor,
        surrounding: selection.surrounding,
        language: selection.language === 'zh' ? 'zh' : 'en',
      },
      action,
      selection.anchor,
    )
    window.getSelection()?.removeAllRanges()
    closeAll()
  }, [action, selection, closeAll])

  if (!selection) return null

  const contextualContext: ContextualTutorContext | null = selection.projectId
    ? {
        projectId: selection.projectId,
        ...(selection.topicId ? { topicId: selection.topicId } : {}),
        ...(selection.contextKind ? { contextKind: selection.contextKind } : {}),
        ...(selection.topicTitle ? { topicTitle: selection.topicTitle } : {}),
        ...(selection.sectionHeading ? { sectionHeading: selection.sectionHeading } : {}),
        selectedText: selection.canonicalLatex ?? selection.text,
        surroundingContext: selection.surrounding,
        language: selection.language,
        fromVisual: selection.fromVisual,
      }
    : null

  return (
    <div
      ref={containerRef}
      // left/top stay 0; the position is the transform written by `reposition`
      // (not in this style object, so React never resets it).
      style={{
        left: 0,
        top: 0,
        ...(layout?.maxHeight !== undefined
          ? { maxHeight: layout.maxHeight, overflowY: 'auto' as const }
          : {}),
      }}
      data-side={layout?.side}
      className="fixed z-50 max-w-[calc(100vw-1.5rem)]"
    >
      {selection.tooLong ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-[13px] text-muted-foreground shadow-xl">
          {t('contextual.tooLong')}
        </div>
      ) : action === null ? (
        <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-xl">
          <Button variant="ghost" size="sm" onClick={() => setAction('translate')}>
            <Languages className="h-3.5 w-3.5" />
            {t('contextual.translate')}
          </Button>
          {contextualContext && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setAction('explain')}>
                <Lightbulb className="h-3.5 w-3.5" />
                {t('contextual.explain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAction('ask')}>
                <MessageCircleQuestion className="h-3.5 w-3.5" />
                {t('contextual.ask')}
              </Button>
            </>
          )}
        </div>
      ) : action === 'translate' ? (
        <div className="w-[20rem] max-w-[calc(100vw-1.5rem)] rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{t('translate.title')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              aria-label={t('common.close')}
              onClick={closeAll}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <RichText
            text={`“${selection.text}”`}
            format="markdown"
            className="line-clamp-2 rounded bg-muted/60 px-2 py-1"
            paragraphClassName="text-xs text-muted-foreground"
          />
          {translating && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('translate.working')}
            </p>
          )}
          {translation && (
            <div className="mt-2 space-y-1.5">
              <RichText
                text={translation.translation}
                format="markdown"
                paragraphClassName="text-sm font-medium leading-relaxed text-foreground"
              />
              {translation.contextNote && (
                <p className="text-xs text-muted-foreground">{translation.contextNote}</p>
              )}
              {translation.alternatives.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {t('translate.also', { value: translation.alternatives.join(', ') })}
                </p>
              )}
            </div>
          )}
        </div>
      ) : selection.walkthrough ? null : contextualContext ? (
        <ContextualTutorPopup mode={action} context={contextualContext} onClose={closeAll} />
      ) : null}
    </div>
  )
}

/**
 * The selection's current viewport rectangle.
 *
 * Uses the live browser selection so the popup follows the text while the page
 * scrolls; falls back to the stored rectangle when the selection no longer
 * exists, is inside our own popup, or has no measurable rect.
 */
function resolveLiveAnchor(selection: SelectionState, container: HTMLElement | null): PopupAnchor {
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    if (!container || !container.contains(range.commonAncestorContainer)) {
      if (typeof range.getBoundingClientRect === 'function') {
        const rect = range.getBoundingClientRect()
        if (rect.width || rect.height || rect.top || rect.left) {
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
      }
    }
  }
  return selection.anchor
}

/** `/projects/:projectId/tutor/:topicId[/interactive]` → ids, else null. */
function parseTopicRoute(pathname: string): { projectId: string; topicId: string } | null {
  const match = /^\/projects\/([^/]+)\/tutor\/([^/]+)/.exec(pathname)
  if (!match) return null
  return { projectId: match[1]!, topicId: match[2]! }
}

function parseProjectRoute(pathname: string): string | null {
  return /^\/projects\/([^/]+)\/homework\/[^/]+/.exec(pathname)?.[1] ?? null
}

function readWalkthroughSelection(range: Range): WalkthroughSelection | undefined {
  const start = elementFor(range.startContainer)
  const scope = start?.closest('[data-selection-context="walkthrough"]')
  const section = start?.closest('[data-walkthrough-section]')
  if (!scope || !section || !section.contains(range.endContainer)) return undefined
  const projectId = scope.getAttribute('data-walkthrough-project')
  const setId = scope.getAttribute('data-walkthrough-set')
  const sectionId = section.getAttribute('data-walkthrough-section')
  const textAnchor = describeAnchor(section, range)
  if (!projectId || !setId || !sectionId || !textAnchor) return undefined
  return {
    projectId,
    setId,
    setTitle: scope.getAttribute('data-selection-title') ?? '',
    sectionId,
    sectionTitle: section.getAttribute('data-section-title') ?? '',
    textAnchor,
  }
}

function elementFor(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
}

/** Original LaTeX behind a rendered formula, when the selection is inside one. */
function extractCanonicalLatex(range: Range): string | undefined {
  const katex = elementFor(range.startContainer)?.closest('.katex')
  if (!katex) return undefined
  const annotation = katex.querySelector('annotation[encoding="application/x-tex"]')
  const tex = annotation?.textContent?.trim()
  return tex || undefined
}

function isInsideVisual(range: Range): boolean {
  return Boolean(elementFor(range.startContainer)?.closest('[data-visual-source]'))
}

/** Nearest heading before the selection, within the lesson article. */
function getSectionHeading(range: Range): string | undefined {
  const article = elementFor(range.startContainer)?.closest('article')
  if (!article) return undefined
  let best: string | undefined
  for (const heading of Array.from(article.querySelectorAll('h2, h3'))) {
    if (range.startContainer.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_PRECEDING) {
      const text = (heading.textContent ?? '').trim()
      if (text) best = text
    }
  }
  return best
}

function getTopicTitle(range: Range): string | undefined {
  const article = elementFor(range.startContainer)?.closest('article')
  const heading = article?.querySelector('h1') ?? document.querySelector('article h1')
  const text = (heading?.textContent ?? '').trim()
  return text || undefined
}

function getSurroundingParagraph(range: Range): string {
  let node: Node | null = range.startContainer
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  while (
    node &&
    node.parentNode &&
    node.nodeName !== 'P' &&
    node.nodeName !== 'DIV' &&
    node.nodeName !== 'LI'
  ) {
    node = node.parentNode
  }
  if (!node) return ''
  return (node.textContent ?? '').trim().slice(0, 600)
}

function detectLanguage(text: string): 'zh' | 'en' {
  let zh = 0
  let en = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) zh++
    else if (/[A-Za-z]/.test(ch)) en++
  }
  return zh > en ? 'zh' : 'en'
}
