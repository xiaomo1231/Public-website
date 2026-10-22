import { useMemo, useRef } from 'react'
import katex from 'katex'
// Chemistry: `\ce{2H2 + O2 -> 2H2O}` typesets formulas, charges and arrows.
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import { cn } from '@/shared/lib/utils'
import { prepareLatexForDisplay } from '@/shared/lib/mathDisplay'
import { breakDisplayLatex, hasTopLevelBreaks } from '@/shared/lib/mathBreak'
import {
  breakBudget,
  INITIAL_DISPLAY_STAGE,
  INITIAL_SCALE_STAGE,
  nextDisplayStage,
  shrinkStep,
  type DisplayStage,
  type FitMeasurement,
  type FitSettings,
  type ScaleStage,
} from '@/shared/lib/fitToWidth'
import { innerWidth, useFitStage, useFitWidthSettings } from '@/shared/lib/useFitStage'
import { useTranslation } from '@/i18n'

/**
 * The single place LaTeX is rendered in the app.
 *
 * Every surface (lessons, symbols, formulas, source quotes, quiz explanations)
 * goes through this component so there is exactly one math renderer and one
 * failure mode: invalid LaTeX falls back to showing the author's source rather
 * than breaking the page.
 */

function typeset(latex: string, display: boolean): string | null {
  try {
    return katex.renderToString(prepareLatexForDisplay(latex), {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: false,
    })
  } catch {
    return null
  }
}

export interface MathProps {
  latex: string
  /** Block (centred, own line, horizontally scrollable) vs inline. */
  display?: boolean
  className?: string
  /**
   * Inside a `FitWidthScope`, fit the formula to its column (default). Off for
   * small labels whose container is sized by the formula itself.
   */
  fit?: boolean
}

function SourceFallback({
  latex,
  display,
  className,
}: {
  latex: string
  display: boolean
  className?: string
}): JSX.Element {
  return (
    <code
      className={cn(
        'inline-block max-w-full overflow-x-auto break-words rounded bg-muted px-2 py-1 font-mono text-[13px]',
        className,
      )}
    >
      {display ? `\\[${latex}\\]` : `$${latex}$`}
    </code>
  )
}

export function Math({ latex, display = false, className, fit = true }: MathProps): JSX.Element {
  const settings = useFitWidthSettings()
  if (settings && fit) {
    return display ? (
      <FitDisplayMath latex={latex} className={className} settings={settings} />
    ) : (
      <FitInlineMath latex={latex} className={className} settings={settings} />
    )
  }
  return <PlainMath latex={latex} display={display} className={className} />
}

function PlainMath({
  latex,
  display,
  className,
}: {
  latex: string
  display: boolean
  className?: string
}): JSX.Element {
  const html = useMemo(() => typeset(latex, display), [latex, display])

  if (html === null) {
    return <SourceFallback latex={latex} display={display} className={className} />
  }

  return (
    <span
      className={cn(
        'katex-host',
        display && 'my-3 block max-w-full overflow-x-auto text-center',
        // An inline matrix / array cannot wrap: it scrolls inside its own box
        // instead of being clipped by a narrow card.
        !display &&
          latex.includes('\\begin{') &&
          'inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface FitMathProps {
  latex: string
  className?: string
  settings: FitSettings
}

/** The `.katex-display` box of a display formula: its overflow is what must go. */
function measureDisplay(element: HTMLElement): FitMeasurement | null {
  const box = element.querySelector<HTMLElement>('.katex-display') ?? element
  if (box.clientWidth <= 0) return null
  return { available: box.clientWidth, content: box.scrollWidth }
}

/**
 * A display formula fitted to its column: broken into aligned lines at its
 * top-level relations, scaled down (not below the floor), wrapped at KaTeX's
 * break points, and only as a last resort scrolled, with a visible hint.
 */
function FitDisplayMath({ latex, className, settings }: FitMathProps): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLSpanElement>(null)
  const html = useMemo(() => typeset(latex, true), [latex])
  const breakable = useMemo(() => hasTopLevelBreaks(latex), [latex])
  const stage = useFitStage<DisplayStage>(ref, {
    enabled: html !== null,
    initial: INITIAL_DISPLAY_STAGE,
    resetKey: latex,
    measure: measureDisplay,
    next: (current, measurement) =>
      nextDisplayStage(current, measurement, { ...settings, breakable }),
  })
  const broken = useMemo(() => {
    if (stage.variant !== 'broken' || stage.budget === undefined) return null
    const lines = breakDisplayLatex(latex, breakBudget(latex, stage.budget))
    return lines ? typeset(lines, true) : null
  }, [latex, stage.variant, stage.budget])

  if (html === null) return <SourceFallback latex={latex} display className={className} />

  return (
    <>
      <span
        ref={ref}
        className={cn('katex-host katex-fit my-3 block max-w-full text-center', className)}
        data-fit-stage={stage.variant}
        data-fit-wrap={stage.variant === 'wrap' ? '' : undefined}
        data-fit-scroll={stage.scroll ? '' : undefined}
        style={stage.scale < 1 ? { fontSize: `${stage.scale}em` } : undefined}
        // A scrolled formula can be scrolled with the keyboard too.
        tabIndex={stage.scroll ? 0 : undefined}
        dangerouslySetInnerHTML={{ __html: (stage.variant === 'broken' && broken) || html }}
      />
      {stage.scroll && (
        <span className="-mt-2 mb-2 block text-xs text-muted-foreground" data-fit-hint>
          {t('common.scrollForMore')}
        </span>
      )}
    </>
  )
}

/** Paragraph-like block an inline formula lines up in. */
function inlineContainer(element: HTMLElement): HTMLElement | null {
  return (
    element.parentElement?.closest<HTMLElement>('p, li, blockquote, h1, h2, h3, h4, div') ?? null
  )
}

/**
 * Inline math wraps at its top-level relations by itself (KaTeX emits one
 * unbreakable piece per term); what can still overflow is a single piece
 * wider than the line (a long fraction, a matrix). Inside table cells the
 * table fits as a whole instead.
 */
function measureInline(element: HTMLElement): FitMeasurement | null {
  const container = inlineContainer(element)
  if (!container || element.closest('td, th')) return null
  const available = innerWidth(container)
  if (available <= 0) return null
  let content = 0
  element.querySelectorAll('.katex-html > .base').forEach((base) => {
    content = globalThis.Math.max(content, base.getBoundingClientRect().width)
  })
  return { available, content }
}

function FitInlineMath({ latex, className, settings }: FitMathProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const html = useMemo(() => typeset(latex, false), [latex])
  const stage = useFitStage<ScaleStage>(ref, {
    enabled: html !== null,
    initial: INITIAL_SCALE_STAGE,
    resetKey: latex,
    measure: measureInline,
    next: (current, measurement) => shrinkStep(current, measurement, settings),
    widthTarget: (element) => inlineContainer(element),
  })

  if (html === null) return <SourceFallback latex={latex} display={false} className={className} />

  return (
    <span
      ref={ref}
      className={cn(
        'katex-host katex-fit',
        stage.scroll && 'inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle',
        className,
      )}
      data-fit-scroll={stage.scroll ? '' : undefined}
      style={stage.scale < 1 ? { fontSize: `${stage.scale}em` } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
