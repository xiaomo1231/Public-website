import { useEffect, useState } from 'react'
import { Languages, Loader2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { TranslationService } from '@/services/translationService'
import { buildAIServices } from '@/services/aiServices'
import { useAuth } from '@/features/auth/useAuth'
import { useCurrentProject } from '@/features/project/useCurrentProject'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'

interface PopupState {
  x: number
  y: number
  text: string
  surrounding: string
}

const MAX_SELECTION = 240

/**
 * Listens for text selections anywhere in the document and offers
 * "Translate" / "Explain". Sends the selection + surrounding paragraph +
 * topic to the AI for context-aware translation.
 */
export function SelectionTranslator(): JSX.Element | null {
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [result, setResult] = useState<null | { translation: string; contextNote: string; alternatives: string[] }>(null)
  const [busy, setBusy] = useState(false)
  const { profile } = useAuth()
  const currentProject = useCurrentProject()

  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        if (!busy) setPopup(null)
        return
      }
      const text = sel.toString().trim()
      if (text.length === 0 || text.length > MAX_SELECTION) return
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const surrounding = getSurroundingParagraph(range)
      setResult(null)
      setPopup({ x: rect.left + rect.width / 2, y: rect.top - 8, text, surrounding })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [busy])

  if (!popup) return null

  const detectedLang = detectLanguage(popup.text)
  const targetLang: 'zh' | 'en' = profile?.language && profile.language !== 'auto' ? profile.language : detectedLang === 'zh' ? 'en' : 'zh'
  const sourceLang: 'zh' | 'en' = detectedLang === 'zh' ? 'zh' : 'en'

  async function translate() {
    if (!popup) return
    if (!currentProject) {
      toast({ variant: 'warning', title: 'Open a project to use translation' })
      return
    }
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({ variant: 'error', title: 'Configure AI provider first' })
      return
    }
    setBusy(true)
    try {
      const service: TranslationService = bundle.translation
      const entry = await service.translate({
        projectId: currentProject.id,
        selectedText: popup.text,
        surroundingContext: popup.surrounding,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      })
      setResult({ translation: entry.translation, contextNote: entry.contextNote, alternatives: entry.alternatives })
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: 'Translation failed', description: msg })
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setPopup(null)
    setResult(null)
  }

  return (
    <div
      className="fixed z-50 max-w-sm rounded-md border bg-popover p-3 text-sm shadow-lg"
      style={{ left: popup.x, top: popup.y - 8, transform: 'translate(-50%, -100%)' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Languages className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Translate</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {sourceLang} → {targetLang}
        </span>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={close} className="h-7 w-7">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">“{popup.text}”</p>
      {!result && (
        <Button size="sm" className="mt-2 w-full" onClick={translate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          Translate with AI
        </Button>
      )}
      {result && (
        <div className="mt-2 space-y-1">
          <p className="text-sm font-medium">{result.translation}</p>
          {result.contextNote && <p className="text-xs text-muted-foreground">{result.contextNote}</p>}
          {result.alternatives.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Also: {result.alternatives.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function getSurroundingParagraph(range: Range): string {
  let node: Node | null = range.startContainer
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
  while (node && node.parentNode && node.nodeName !== 'P' && node.nodeName !== 'DIV' && node.nodeName !== 'LI') {
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
  if (zh > en) return 'zh'
  return 'en'
}