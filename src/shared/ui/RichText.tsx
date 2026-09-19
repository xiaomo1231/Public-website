import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { cn } from '@/shared/lib/utils'
import { splitMathSegments, splitParagraphs } from '@/shared/lib/mathText'

/**
 * Reading renderer for extracted course text.
 *
 * Course material is stored as plain text (the parsers do not produce a
 * document tree), so this deliberately does *not* invent structure. It only:
 *
 *   - splits on blank lines so paragraphs breathe,
 *   - recognises LaTeX delimiters (`$$…$$`, `\[…\]`, `\(…\)`, `$…$`) and
 *     typesets those spans with KaTeX,
 *   - keeps everything else verbatim, including math symbols, CJK and
 *     undecodable characters.
 *
 * No markdown is interpreted: a stray `*` or `#` in a PDF is content, not
 * formatting.
 */

function typeset(value: string, display: boolean): string | null {
  try {
    return katex.renderToString(value, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: false,
    })
  } catch {
    // Not valid LaTeX — the caller falls back to showing the source.
    return null
  }
}

function MathSpan({ value, display }: { value: string; display: boolean }): JSX.Element {
  const html = useMemo(() => typeset(value, display), [value, display])

  if (html === null) {
    // Honest fallback: show the author's LaTeX rather than a broken formula.
    return (
      <code className="my-1 inline-block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-[13px] break-words">
        {display ? `\\[${value}\\]` : `$${value}$`}
      </code>
    )
  }

  return (
    <span
      className={cn(
        'katex-host',
        display && 'my-3 block max-w-full overflow-x-auto text-center',
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export interface RichTextProps {
  text: string
  className?: string
  /** Extra classes for each paragraph. */
  paragraphClassName?: string
}

export function RichText({ text, className, paragraphClassName }: RichTextProps): JSX.Element {
  const paragraphs = useMemo(
    () => splitParagraphs(text).map((block) => splitMathSegments(block)),
    [text],
  )

  if (paragraphs.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>—</p>
  }

  return (
    <div className={cn('space-y-4', className)}>
      {paragraphs.map((segments, index) => (
        <p
          key={index}
          className={cn(
            'text-[15px] leading-[1.75] text-foreground',
            'whitespace-pre-wrap [overflow-wrap:anywhere]',
            paragraphClassName,
          )}
        >
          {segments.map((segment, i) =>
            segment.kind === 'text' ? (
              <span key={i}>{segment.value}</span>
            ) : (
              <MathSpan key={i} value={segment.value} display={segment.display} />
            ),
          )}
        </p>
      ))}
    </div>
  )
}
