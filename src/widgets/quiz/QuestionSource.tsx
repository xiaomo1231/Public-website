import { BookOpen } from 'lucide-react'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { useTranslation } from '@/i18n'
import { SourceQuote } from '@/widgets/source/SourceQuote'

export interface QuestionSourceProps {
  /**
   * Citations resolved when the question was generated. `undefined` means the
   * question predates this feature; an empty array means no source was found.
   */
  sourceRefs?: SourceReference[] | null
  /** When set, each citation links to the document it came from. */
  projectId?: string
}

/** Build the human-readable location line for a citation. */
function locationOf(
  reference: SourceReference,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return [
    reference.page !== undefined ? t('questionSource.page', { page: reference.page }) : '',
    reference.slideNumber !== undefined
      ? t('questionSource.slide', { slide: reference.slideNumber })
      : '',
    reference.section ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Shows where a quiz question came from: the course document, its location and
 * the verbatim excerpt the question was built on.
 *
 * The excerpt is rendered as plain text (with LaTeX typeset), so markdown,
 * quotes and newlines from the source material cannot break the layout.
 */
export function QuestionSource({ sourceRefs, projectId }: QuestionSourceProps): JSX.Element {
  const { t } = useTranslation()
  const refs = (sourceRefs ?? []).filter((ref) => ref && (ref.documentName || ref.documentId))

  return (
    <section
      className="min-w-0 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3"
      aria-label={t('questionSource.title')}
    >
      <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('questionSource.title')}
      </h3>

      {refs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {sourceRefs === undefined || sourceRefs === null
            ? t('questionSource.notRecorded')
            : t('questionSource.unavailable')}
        </p>
      ) : (
        <div className="space-y-2">
          {refs.map((ref, index) => (
            <SourceQuote
              key={`${ref.chunkId ?? ref.documentId}-${index}`}
              documentName={ref.documentName || t('common.unknown')}
              {...(locationOf(ref, t) ? { location: locationOf(ref, t) } : {})}
              quote={ref.quote ?? ''}
              index={index + 1}
              total={refs.length}
              {...(projectId && ref.documentId
                ? { documentHref: `/projects/${projectId}/documents/${ref.documentId}` }
                : {})}
              {...(ref.chunkId
                ? { technical: [{ label: t('sourceReader.chunkId'), value: ref.chunkId }] }
                : {})}
            />
          ))}
        </div>
      )}
    </section>
  )
}
