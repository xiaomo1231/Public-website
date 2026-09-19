import { Link, useInRouterContext } from 'react-router-dom'
import { Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { RichText } from '@/shared/ui/RichText'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { toast } from '@/features/toast/toastStore'
import { useTranslation } from '@/i18n'

export interface SourceDetail {
  label: string
  value: string
}

export interface SourceReaderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The document this text came from. Shown as the reader's heading. */
  documentName: string
  /** Human-readable location, e.g. `Page 12 · Derivatives`. */
  location?: string
  /** The text to read. */
  content: string
  /** Extra human-readable context rows shown in the footer. */
  meta?: SourceDetail[]
  /** Identifiers, hidden behind a disclosure so they never compete with the text. */
  technical?: SourceDetail[]
  /** When set (and inside a router) an "Open document" action is offered. */
  documentHref?: string
}

/**
 * Full-screen reading surface for course source text.
 *
 * The text is the visual subject: it sits in a width-constrained column with
 * generous leading, while document metadata is demoted to small muted rows in
 * the footer. Technical identifiers are collapsed behind a disclosure.
 */
export function SourceReader({
  open,
  onOpenChange,
  documentName,
  location,
  content,
  meta,
  technical,
  documentHref,
}: SourceReaderProps): JSX.Element {
  const { t } = useTranslation()
  const inRouter = useInRouterContext()

  const copyable = content.trim().length > 0

  async function copySource() {
    try {
      await navigator.clipboard?.writeText(content)
      toast({ variant: 'success', title: t('common.copied') })
    } catch {
      toast({ variant: 'error', title: t('common.copyFailed') })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,54rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]"
        aria-describedby={undefined}
      >
        <header className="shrink-0 space-y-1 border-b px-5 py-4 pr-14 sm:px-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t('sourceReader.eyebrow')}
          </p>
          <DialogTitle className="text-base font-semibold leading-snug">
            <TruncatedText
              text={documentName || t('common.unknown')}
              className="text-base font-semibold leading-snug"
            />
          </DialogTitle>
          {location ? (
            <DialogDescription className="min-w-0 break-words text-xs text-muted-foreground">
              {location}
            </DialogDescription>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {content.trim().length > 0 ? (
            <article className="mx-auto w-full max-w-[46rem]">
              <RichText text={content} />
            </article>
          ) : (
            <p className="mx-auto w-full max-w-[46rem] text-sm text-muted-foreground">
              {t('sourceReader.empty')}
            </p>
          )}
        </div>

        <footer className="shrink-0 space-y-3 border-t bg-muted/20 px-5 py-3 sm:px-7">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copySource()}
              disabled={!copyable}
            >
              <Copy />
              {t('sourceReader.copySource')}
            </Button>
            {documentHref && inRouter && (
              <Button size="sm" asChild>
                <Link to={documentHref}>
                  <ExternalLink />
                  {t('sourceReader.openDocument')}
                </Link>
              </Button>
            )}
          </div>

          {(meta?.length || technical?.length) && (
            <div className="space-y-2">
              {meta && meta.length > 0 && (
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {meta.map((row) => (
                    <div key={row.label} className="flex min-w-0 items-baseline gap-1.5">
                      <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                      <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {technical && technical.length > 0 && (
                <details className="group">
                  <summary className="w-fit cursor-pointer list-none rounded text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-ring">
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
              )}
            </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
