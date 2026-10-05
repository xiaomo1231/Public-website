import { Info } from 'lucide-react'
import type { SlideContent } from '@/services/slideLessonService'
import { VisualSourceFigure } from '@/widgets/source/VisualSourceFigure'
import { RichText } from '@/shared/ui/RichText'
import { useTranslation } from '@/i18n'

export interface SlideViewerProps {
  content: SlideContent
}

/**
 * The original slide as the student can actually see it.
 *
 * The app has no PPTX rasteriser, so instead of a fake rendering it shows what
 * the file genuinely contains, in order: the images embedded in the slide (the
 * preserved visual sources), then the extracted title / body / tables, then the
 * speaker notes kept clearly separate. A short note states this honestly so a
 * missing layout is never mistaken for a missing slide.
 */
export function SlideViewer({ content }: SlideViewerProps): JSX.Element {
  const { t } = useTranslation()
  const bodyBlocks = content.blocks.filter(
    (block) => block.contentType !== 'heading' && block.contentType !== 'note',
  )
  const headingBlocks = content.blocks.filter((block) => block.contentType === 'heading')

  return (
    <section
      aria-label={t('slides.viewerLabel', { current: content.slideNumber, total: content.slideTotal })}
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold text-foreground">
          {content.title ?? t('slides.untitled')}
        </h2>
        <span className="data-num shrink-0 font-mono text-xs text-muted-foreground">
          {t('slides.position', { current: content.slideNumber, total: content.slideTotal })}
        </span>
      </header>

      {content.visuals.length > 0 && (
        <div className="space-y-1">
          {content.visuals.map((visual) => (
            <VisualSourceFigure key={visual.id} visual={visual} documentName={content.document.name} />
          ))}
        </div>
      )}

      {headingBlocks.length > 0 && (
        <div className="space-y-1">
          {headingBlocks.map((block, index) => (
            <RichText
              key={`h-${index}`}
              text={block.text}
              format="markdown"
              paragraphClassName="text-[17px] font-semibold leading-snug"
            />
          ))}
        </div>
      )}

      {bodyBlocks.length === 0 && content.visuals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('slides.emptySlideBody')}</p>
      ) : (
        bodyBlocks.map((block, index) => (
          <RichText
            key={`b-${index}`}
            text={block.text}
            format="markdown"
            paragraphClassName="text-[15px] leading-relaxed"
          />
        ))
      )}

      {content.notes.trim().length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('slides.speakerNotes')}</p>
          <RichText
            text={content.notes}
            format="markdown"
            paragraphClassName="text-[14px] leading-relaxed text-muted-foreground"
          />
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('slides.extractionNote')}
      </p>
    </section>
  )
}
