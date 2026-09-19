import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { cn } from '@/shared/lib/utils'

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
    return katex.renderToString(latex, {
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
}

export function Math({ latex, display = false, className }: MathProps): JSX.Element {
  const html = useMemo(() => typeset(latex, display), [latex, display])

  if (html === null) {
    return (
      <code
        className={cn(
          'inline-block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[13px] break-words',
          className,
        )}
      >
        {display ? `\\[${latex}\\]` : `$${latex}$`}
      </code>
    )
  }

  return (
    <span
      className={cn(
        'katex-host',
        display && 'my-3 block max-w-full overflow-x-auto text-center',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
