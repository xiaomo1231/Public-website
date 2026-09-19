import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import type { DocumentChunk } from '@/entities/chunk/types'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { collapseText } from '@/shared/lib/textPreview'
import { useTranslation } from '@/i18n'
import { SourceReader } from '@/widgets/source/SourceReader'

/** Characters shown before the chunk preview offers to expand. */
const PREVIEW_AT = 420

export interface ChunkPreviewProps {
  chunk: DocumentChunk
  /** Document the chunk belongs to, shown as the preview's caption. */
  documentName: string
  /** 1-based position in the document, for the "Chunk N" label. */
  index: number
  documentHref?: string
}

/**
 * A chunk rendered as course text rather than as a database row.
 *
 * The reading order is: where this came from → the text itself → optional
 * technical detail. Chunk ids and offsets are hidden behind a disclosure.
 */
export function ChunkPreview({
  chunk,
  documentName,
  index,
  documentHref,
}: ChunkPreviewProps): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)

  const { shown, truncated } = collapseText(chunk.text, PREVIEW_AT)
  const location = [
    chunk.pageNumber !== undefined
      ? t('documentDetail.pageLabel', { number: chunk.pageNumber })
      : '',
    chunk.section ? t('documentDetail.sectionLabel', { title: chunk.section }) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const technical = [
    { label: t('sourceReader.chunkId'), value: chunk.id },
    { label: t('sourceReader.documentId'), value: chunk.documentId },
    { label: t('documentDetail.type'), value: chunk.contentType },
    { label: t('documentDetail.textLength'), value: t('sourceReader.characters', { count: chunk.text.length }) },
  ]

  return (
    <>
      <article className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card">
        <header className="min-w-0 space-y-0.5 border-b border-border/60 px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t('documentDetail.chunkNumber', { number: index })}
          </p>
          <TruncatedText text={documentName} className="text-xs font-medium text-foreground" />
          {location ? (
            <p className="min-w-0 break-words text-[11px] text-muted-foreground">{location}</p>
          ) : null}
        </header>

        <div className="px-4 py-3">
          <RichText
            text={expanded || !truncated ? chunk.text : `${shown}…`}
            paragraphClassName="text-sm leading-[1.7]"
          />
          {truncated && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-xs"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
              {expanded ? t('questionSource.collapse') : t('questionSource.expand')}
            </Button>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 bg-muted/20 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setReaderOpen(true)}
          >
            <BookOpen />
            {t('sourceReader.readSource')}
          </Button>

          <details className="group ml-auto">
            <summary className="w-fit cursor-pointer list-none rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-ring">
              {t('sourceReader.advanced')}
            </summary>
            <dl className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
              {technical.map((row) => (
                <div key={row.label} className="flex min-w-0 items-baseline gap-2">
                  <dt className="shrink-0">{row.label}</dt>
                  <dd className="min-w-0 break-all font-mono">{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </footer>
      </article>

      <SourceReader
        open={readerOpen}
        onOpenChange={setReaderOpen}
        documentName={documentName}
        {...(location ? { location } : {})}
        content={chunk.text}
        technical={technical}
        {...(documentHref ? { documentHref } : {})}
      />
    </>
  )
}
