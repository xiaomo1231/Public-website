import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react'
import { Keyboard } from 'lucide-react'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { Math } from '@/shared/ui/Math'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import {
  applySymbol,
  symbolGroupsFor,
  type MathInputMode,
  type SymbolGroupId,
  type SymbolItem,
} from '@/shared/lib/mathInput'
import { parseNumeric, previewEquation, previewExpression, previewQuantity } from '@/services/answerPreview'
import { useTranslation, type TranslationKey } from '@/i18n'

const GROUP_LABEL_KEYS: Record<SymbolGroupId, TranslationKey> = {
  basic: 'symbolGroup.basic',
  greek: 'symbolGroup.greek',
  calculus: 'symbolGroup.calculus',
  sets: 'symbolGroup.sets',
  linear: 'symbolGroup.linear',
  stats: 'symbolGroup.stats',
  scripts: 'symbolGroup.scripts',
  arrows: 'symbolGroup.arrows',
  chemistry: 'symbolGroup.chemistry',
  biology: 'symbolGroup.biology',
  chemEquation: 'symbolGroup.chemEquation',
  operators: 'symbolGroup.operators',
  functions: 'symbolGroup.functions',
  units: 'symbolGroup.units',
}

/** Graded fields show the symbol bar by default; free text keeps it folded. */
const OPEN_BY_DEFAULT: Record<MathInputMode, boolean> = {
  text: false,
  expression: true,
  number: true,
  quantity: true,
  chemistry: true,
}

const storageKey = (mode: MathInputMode) => `ai-learning:symbol-bar:${mode}`

function readOpen(mode: MathInputMode): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey(mode))
    return stored === null ? OPEN_BY_DEFAULT[mode] : stored === '1'
  } catch {
    return OPEN_BY_DEFAULT[mode]
  }
}

function writeOpen(mode: MathInputMode, open: boolean): void {
  try {
    window.localStorage.setItem(storageKey(mode), open ? '1' : '0')
  } catch {
    /* per-viewer convenience only */
  }
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement

export interface MathFieldProps {
  mode: MathInputMode
  value: string
  onChange: (value: string) => void
  /** Course subject; orders the text-mode symbol groups. */
  subject?: string
  multiline?: boolean
  rows?: number
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
  inputClassName?: string
  /**
   * Submit shortcut: Enter in a single-line field, Ctrl/⌘ + Enter in a
   * multi-line one. Omit to leave Enter alone.
   */
  onSubmit?: () => void
  onKeyDown?: (event: KeyboardEvent<FieldElement>) => void
  /** Text mode: render the typed text (LaTeX in `$…$`) underneath. */
  showRenderedPreview?: boolean
  /** Lets a parent focus or scroll to the field. */
  fieldRef?: MutableRefObject<FieldElement | null>
}

/**
 * An answer field with a symbol bar and a live "this is how it will be read"
 * preview. Symbols insert at the caret (and wrap a selection for templates
 * such as √ or a/b), so nobody has to type LaTeX to answer.
 */
export function MathField({
  mode,
  value,
  onChange,
  subject,
  multiline = false,
  rows = 3,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
  inputClassName,
  onSubmit,
  onKeyDown,
  showRenderedPreview = false,
  fieldRef,
}: MathFieldProps): JSX.Element {
  const { t } = useTranslation()
  const localRef = useRef<FieldElement | null>(null)
  /** Caret to restore once the inserted text has been written to the field. */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const panelId = useId()
  const groups = symbolGroupsFor(mode, subject)
  const [open, setOpen] = useState(() => readOpen(mode))
  const [groupId, setGroupId] = useState<SymbolGroupId>(groups[0]!.id)
  const activeGroup = groups.find((group) => group.id === groupId) ?? groups[0]!

  // A different subject reorders the groups; fall back to the first one.
  useEffect(() => {
    if (!groups.some((group) => group.id === groupId)) setGroupId(groups[0]!.id)
  }, [groups, groupId])

  function setRef(node: FieldElement | null) {
    localRef.current = node
    if (fieldRef) fieldRef.current = node
  }

  function insert(item: SymbolItem) {
    const el = localRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = applySymbol(value, start, end, item)
    pendingSelection.current = { start: next.selectionStart, end: next.selectionEnd }
    onChange(next.value)
  }

  // Writing a controlled value moves the caret to the end, so restore it right
  // after React commits the new value (a layout effect, not a timer, so it also
  // works in a background tab where animation frames are paused).
  useLayoutEffect(() => {
    const selection = pendingSelection.current
    const field = localRef.current
    if (!selection || !field) return
    pendingSelection.current = null
    field.focus()
    field.setSelectionRange(selection.start, selection.end)
  }, [value])

  function toggle() {
    setOpen((current) => {
      writeOpen(mode, !current)
      return !current
    })
  }

  function handleKeyDown(event: KeyboardEvent<FieldElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented || !onSubmit || event.key !== 'Enter') return
    if (event.nativeEvent.isComposing) return
    if (multiline ? event.ctrlKey || event.metaKey : !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  const shared = {
    id,
    value,
    placeholder,
    disabled,
    'aria-label': ariaLabel,
    onKeyDown: handleKeyDown,
    spellCheck: mode === 'text',
  }

  return (
    <div className={cn('space-y-2', className)}>
      {multiline ? (
        <Textarea
          {...shared}
          ref={setRef}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
        />
      ) : (
        <Input
          {...shared}
          ref={setRef}
          type="text"
          inputMode={mode === 'number' ? 'decimal' : 'text'}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className={cn(mode !== 'text' && 'font-mono', inputClassName)}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={panelId}
          className="focus-ring inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden />
          {open ? t('symbolBar.hide') : t('symbolBar.show')}
        </button>
        {onSubmit && (
          <span className="text-xs text-muted-foreground">
            {multiline ? t('symbolBar.submitHintMultiline') : t('symbolBar.submitHint')}
          </span>
        )}
      </div>

      {open && !disabled && (
        <div id={panelId} className="space-y-2 rounded-xl border border-border/70 bg-muted/40 p-2">
          {groups.length > 1 && (
            <div role="tablist" aria-label={t('symbolBar.groups')} className="flex flex-wrap gap-1">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={group.id === activeGroup.id}
                  onClick={() => setGroupId(group.id)}
                  className={cn(
                    'focus-ring rounded-md px-2 py-0.5 text-xs transition-colors',
                    group.id === activeGroup.id
                      ? 'bg-card font-medium text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(GROUP_LABEL_KEYS[group.id])}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {activeGroup.items.map((item) => (
              <button
                key={`${item.glyph}-${item.insert}`}
                type="button"
                // Keep the caret and selection in the field.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(item)}
                title={t('symbolBar.inserts', { text: item.insert })}
                aria-label={t('symbolBar.inserts', { text: item.insert })}
                className="focus-ring inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border/70 bg-card px-2 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
              >
                {item.glyph}
              </button>
            ))}
          </div>
        </div>
      )}

      <AnswerPreview mode={mode} value={value} showRendered={showRenderedPreview} />
    </div>
  )
}

/** One line saying how the grader will read the answer. */
function AnswerPreview({
  mode,
  value,
  showRendered,
}: {
  mode: MathInputMode
  value: string
  showRendered: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const trimmed = value.trim()
  if (!trimmed) return null

  let content: JSX.Element | null = null
  let warn = false

  if (mode === 'expression') {
    const preview = previewExpression(trimmed)
    if (preview.status === 'ok') {
      content = (
        <>
          {t('mathPreview.readAs')} <Math latex={preview.latex} />
        </>
      )
    } else if (preview.status === 'error') {
      content = <>{t('mathPreview.expressionError')}</>
      warn = true
    }
  } else if (mode === 'number') {
    const parsed = parseNumeric(trimmed)
    if (parsed === null) {
      content = <>{t('mathPreview.numberError')}</>
      warn = true
    } else if (String(parsed) !== trimmed) {
      content = <>{t('mathPreview.numberValue', { value: String(Number.parseFloat(parsed.toPrecision(10))) })}</>
    }
  } else if (mode === 'quantity') {
    const preview = previewQuantity(trimmed)
    if (preview.status === 'ok') {
      content = <>{t('mathPreview.quantity', { value: String(preview.value), unit: preview.unit })}</>
    } else if (preview.status === 'no-unit') {
      content = <>{t('mathPreview.quantityNoUnit')}</>
      warn = true
    } else if (preview.status === 'bad-unit') {
      content = <>{t('mathPreview.quantityBadUnit', { unit: preview.unit })}</>
      warn = true
    } else if (preview.status === 'bad-number') {
      content = <>{t('mathPreview.quantityBadNumber')}</>
      warn = true
    }
  } else if (mode === 'chemistry') {
    const preview = previewEquation(trimmed)
    if (preview.status === 'ok') {
      content = (
        <>
          {t('mathPreview.readAs')} <Math latex={preview.latex} />
        </>
      )
    } else if (preview.status === 'no-arrow') {
      content = <>{t('mathPreview.equationNoArrow')}</>
      warn = true
    } else if (preview.status === 'bad-term') {
      content = <>{t('mathPreview.equationBadTerm', { term: preview.term })}</>
      warn = true
    }
  } else if (showRendered && /\$|\\\(|\\\[/.test(trimmed)) {
    return (
      <div className="rounded-lg border border-border/70 bg-card px-3 py-2" aria-live="polite">
        <p className="mb-1 text-xs text-muted-foreground">{t('mathPreview.rendered')}</p>
        <RichText text={value} format="markdown" paragraphClassName="text-sm leading-relaxed" />
      </div>
    )
  }

  if (!content) return null
  return (
    <p
      aria-live="polite"
      className={cn('text-xs', warn ? 'font-medium text-foreground' : 'text-muted-foreground')}
    >
      {content}
    </p>
  )
}
