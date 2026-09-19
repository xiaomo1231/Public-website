import { useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { cn } from '@/shared/lib/utils'
import { collapseText } from '@/shared/lib/textPreview'
import { useTranslation } from '@/i18n'
import { SourceReader, type SourceDetail } from './SourceReader'

/** Quotes longer than this collapse by default so they cannot bury the question. */
const COLLAPSE_AT = 320

export interface SourceQuoteProps {
  documentName: string
  /** Human-readable location, e.g. `Page 12 · Derivatives`. */
  location?: string
  /** The excerpt, verbatim from the course material. */
  quote: string
  /** Full text to show in the reader. Defaults to `quote`. */
  fullText?: string
  documentHref?: string
  meta?: SourceDetail[]
  technical?: SourceDetail[]
  /** 1-based position when a question cites more than one source. */
  index?: number
  total?: number
  className?: string
}

/**
 * Where a question or mistake came from: document, location and the verbatim
 * excerpt. The excerpt is the subject; the citation is a quiet caption above it.
 */
export function SourceQuote({
  documentName,
  location,
  quote,
  fullText,
  documentHref,
  meta,
  technical,
  index,
  total,
  className,
}: SourceQuoteProps): JSX.Element {
  const { t } = useTranslation()
  const inRouter = useInRouterContext()
  const [expanded, setExpanded] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)

  const text = quote ?? ''
  const { shown, truncated } = collapseText(text, COLLAPSE_AT)
  const displayed = expanded ? text : shown
  const readable = (fullText ?? text).trim()

  return (
    <>
      <figure
        className={cn(
          'min-w-0 space-y-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5',
          className,
        )}
      >
        <figcaption className="min-w-0 space-y-0.5">
          {/* A single source sits under the caller's own heading; multiple
              sources each need their own label to stay distinguishable. */}
          {total !== undefined && total > 1 && index !== undefined && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('questionSource.sourceN', { index })}
            </span>
          )}
          <TruncatedText text={documentName} className="text-xs font-medium text-foreground" />
          {location ? (
            <p className="min-w-0 break-words text-[11px] text-muted-foreground">{location}</p>
          ) : null}
        </figcaption>

        {text.trim().length > 0 ? (
          <blockquote className="min-w-0 border-l-2 border-border pl-3">
            <RichText
              text={expanded ? displayed : `${displayed}${truncated ? '…' : ''}`}
              className="space-y-2"
              paragraphClassName="text-[13px] leading-relaxed text-foreground"
            />
          </blockquote>
        ) : (
          <p className="text-xs text-muted-foreground">{t('questionSource.unavailable')}</p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {truncated && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
              {expanded ? t('questionSource.collapse') : t('questionSource.expand')}
            </Button>
          )}
          {readable.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setReaderOpen(true)}
            >
              {t('sourceReader.readSource')}
            </Button>
          )}
          {documentHref && inRouter && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" asChild>
              <Link to={documentHref}>
                <ExternalLink />
                {t('sourceReader.openDocument')}
              </Link>
            </Button>
          )}
        </div>
      </figure>

      <SourceReader
        open={readerOpen}
        onOpenChange={setReaderOpen}
        documentName={documentName}
        {...(location ? { location } : {})}
        content={readable}
        {...(meta ? { meta } : {})}
        {...(technical ? { technical } : {})}
        {...(documentHref ? { documentHref } : {})}
      />
    </>
  )
}
