import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import type { TutorVisual } from '@/entities/tutorLesson/types'
import { useTranslation } from '@/i18n'

export interface VisualSourceFigureProps {
  visual: TutorVisual
  /** Human-readable document name, when the caller has it. */
  documentName?: string
}

/**
 * The original figure, preserved from the course material.
 *
 * The image bytes are loaded from IndexedDB on demand and exposed through an
 * object URL that is revoked on unmount — the lesson row only holds a
 * reference, so opening a cached lesson never re-renders the PDF.
 *
 * When the page could not be rendered (no canvas, e.g. a non-browser
 * environment) the provenance is still shown instead of a broken image.
 */
export function VisualSourceFigure({ visual, documentName }: VisualSourceFigureProps): JSX.Element {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(!visual.hasImage)

  useEffect(() => {
    if (!visual.hasImage) {
      setUnavailable(true)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await new VisualSourceRepository().getImage(visual.id)
        if (cancelled) return
        if (!blob || typeof URL.createObjectURL !== 'function') {
          setUnavailable(true)
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setUnavailable(true)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [visual.id, visual.hasImage])

  return (
    <figure data-visual-source={visual.id} className="my-5 min-w-0 space-y-2">
      {url ? (
        <img
          src={url}
          alt={visual.caption}
          loading="lazy"
          className="mx-auto block h-auto max-w-full rounded-md border border-border/70 bg-card"
        />
      ) : unavailable ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-[13px] text-muted-foreground">
          <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
          {t('tutor.visualUnavailable')}
        </div>
      ) : (
        <div className="h-24 animate-pulse rounded-md border border-border/70 bg-muted/40" aria-hidden />
      )}
      <figcaption className="text-center text-[13px] text-muted-foreground">
        {visual.caption}
        {documentName ? ` · ${documentName}` : ''}
      </figcaption>
    </figure>
  )
}
