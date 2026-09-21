import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Languages, Lightbulb, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ContextualTutorPopup, type ContextualTutorContext } from '@/widgets/tutor/ContextualTutorPopup'
import { buildAIServices } from '@/services/aiServices'
import { useAuth } from '@/features/auth/useAuth'
import { useCurrentProject } from '@/features/project/useCurrentProject'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

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
  language: string
  fromVisual: boolean
  tooLong: boolean
  style: CSSProperties
}

interface TranslationResult {
  translation: string
  contextNote: string
  alternatives: string[]
}

/** Longest selection worth sending; beyond this the learner is told to narrow it. */
const MAX_SELECTION = 600
const MIN_DESKTOP_MARGIN = 150

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
  const { profile } = useAuth()
  const currentProject = useCurrentProject()
  const containerRef = useRef<HTMLDivElement>(null)
  // Mirrors state so the selection listener never reads a stale closure.
  const translatingRef = useRef(false)

  useEffect(() => {
    translatingRef.current = translating
  }, [translating])

  useEffect(() => {
    function onSelectionChange(): void {
      if (translatingRef.current) return
      const sel = window.getSelection()
      // A collapsed selection is handled by the outside-click listener, which
      // knows whether the click landed inside our own popup.
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

      const range = sel.getRangeAt(0)
      // Selecting text inside our own popup (e.g. in the textarea) must not
      // replace the context or close the conversation.
      if (containerRef.current?.contains(range.commonAncestorContainer)) return

      const text = sel.toString().trim()
      if (!text) return

      // jsdom (and some embedded webviews) do not implement Range rects.
      const rect =
        typeof range.getBoundingClientRect === 'function'
          ? range.getBoundingClientRect()
          : { left: 0, top: 0, width: 0, height: 0 }
      const route = parseTopicRoute(window.location.pathname)
      const mobile = window.innerWidth < 640
      const style: CSSProperties = mobile
        ? { left: '50%', bottom: 12, transform: 'translateX(-50%)' }
        : {
            left: clamp(rect.left + rect.width / 2, MIN_DESKTOP_MARGIN, window.innerWidth - MIN_DESKTOP_MARGIN),
            top: rect.top - 8,
            transform: 'translate(-50%, -100%)',
          }

      const canonicalLatex = extractCanonicalLatex(range)
      const surrounding = getSurroundingParagraph(range)
      const sectionHeading = getSectionHeading(range)
      const topicTitle = getTopicTitle(range)

      setAction(null)
      setTranslation(null)
      setSelection({
        text,
        surrounding,
        ...(canonicalLatex ? { canonicalLatex } : {}),
        ...(sectionHeading ? { sectionHeading } : {}),
        ...(topicTitle ? { topicTitle } : {}),
        ...(route ?? {}),
        language: detectLanguage(`${text} ${surrounding}`),
        fromVisual: isInsideVisual(range),
        tooLong: text.length > MAX_SELECTION,
        style,
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  function closeAll(): void {
    setSelection(null)
    setAction(null)
    setTranslation(null)
  }

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
  }, [selection])

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
    const targetLang: 'zh' | 'en' =
      profile?.language && profile.language !== 'auto'
        ? profile.language
        : detected === 'zh'
          ? 'en'
          : 'zh'
    setTranslating(true)
    try {
      const entry = await bundle.translation.translate({
        projectId: currentProject.id,
        selectedText: selection.text,
        surroundingContext: selection.surrounding,
        sourceLanguage: detected === 'zh' ? 'zh' : 'en',
        targetLanguage: targetLang,
      })
      setTranslation({
        translation: entry.translation,
        contextNote: entry.contextNote,
        alternatives: entry.alternatives,
      })
    } catch (err) {
      toast({ variant: 'error', title: t('translate.failed'), description: friendlyAIError(err) })
      setAction(null)
    } finally {
      setTranslating(false)
    }
  }

  // Choosing "Translate" runs it once; the AI is never called on selection alone.
  useEffect(() => {
    if (action === 'translate') void translate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action])

  if (!selection) return null

  const contextualContext: ContextualTutorContext | null =
    selection.projectId && selection.topicId
      ? {
          projectId: selection.projectId,
          topicId: selection.topicId,
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
      style={selection.style}
      className="fixed z-50 max-w-[calc(100vw-1.5rem)]"
    >
      {selection.tooLong ? (
        <div className="rounded-md border bg-card px-3 py-2 text-[13px] text-muted-foreground shadow-xl">
          {t('contextual.tooLong')}
        </div>
      ) : action === null ? (
        <div className="flex items-center gap-0.5 rounded-md border bg-card p-1 shadow-xl">
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
                <Sparkles className="h-3.5 w-3.5" />
                {t('contextual.ask')}
              </Button>
            </>
          )}
        </div>
      ) : action === 'translate' ? (
        <div className="w-[20rem] max-w-[calc(100vw-1.5rem)] rounded-md border bg-card p-3 text-sm text-card-foreground shadow-xl">
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
          <p className="line-clamp-2 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
            “{selection.text}”
          </p>
          {translating && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('translate.working')}
            </p>
          )}
          {translation && (
            <div className="mt-2 space-y-1.5">
              <p className="text-sm font-medium leading-relaxed text-foreground">
                {translation.translation}
              </p>
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
      ) : contextualContext ? (
        <ContextualTutorPopup mode={action} context={contextualContext} onClose={closeAll} />
      ) : null}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** `/projects/:projectId/tutor/:topicId[/interactive]` → ids, else null. */
function parseTopicRoute(pathname: string): { projectId: string; topicId: string } | null {
  const match = /^\/projects\/([^/]+)\/tutor\/([^/]+)/.exec(pathname)
  if (!match) return null
  return { projectId: match[1]!, topicId: match[2]! }
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
