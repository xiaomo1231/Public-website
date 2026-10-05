import { useEffect, useState } from 'react'
import { ExternalLink, Globe, ImageOff, Loader2, ShieldCheck, X } from 'lucide-react'
import type { ReferenceImage } from '@/entities/referenceImage/types'
import type { UseReferenceImagesState } from '@/features/tutor/useReferenceImages'
import { Button } from '@/shared/ui/Button'
import { useTranslation } from '@/i18n'

const SOURCE_NAMES: Record<ReferenceImage['source'], string> = {
  pubchem: 'PubChem',
  wikimedia: 'Wikimedia Commons',
}

function ReferenceFigure({
  image,
  load,
  onRemove,
}: {
  image: ReferenceImage
  load: UseReferenceImagesState['loadImage']
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      const blob = await load(image.id).catch(() => null)
      if (cancelled) return
      if (!blob || typeof URL.createObjectURL !== 'function') {
        setFailed(true)
        return
      }
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [image.id, load])

  return (
    <figure data-reference-image={image.id} className="min-w-0 space-y-2 rounded-lg border border-border/70 bg-card p-3">
      <div className="relative">
        {url ? (
          // Reference pictures are usually drawn on white; keep them legible in dark mode.
          <img src={url} alt={image.purpose} loading="lazy" className="mx-auto block h-auto max-h-80 max-w-full rounded-md bg-white" />
        ) : failed ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-[13px] text-muted-foreground">
            <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
            {t('tutor.visualUnavailable')}
          </div>
        ) : (
          <div className="h-32 animate-pulse rounded-md bg-muted/40" aria-hidden />
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('referenceImages.remove', { title: image.title })}
          title={t('referenceImages.remove', { title: image.title })}
          className="focus-ring absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <figcaption className="space-y-1 text-[13px]">
        <p className="font-medium text-foreground">{image.purpose}</p>
        {image.relevance === 'verified' ? (
          <p className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t('referenceImages.verified')}
          </p>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('referenceImages.unverified')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          <a
            href={image.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
          >
            {image.title}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          {' · '}
          {SOURCE_NAMES[image.source]}
          {' · '}
          {image.licenseUrl ? (
            <a href={image.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
              {image.license}
            </a>
          ) : (
            image.license
          )}
          {image.author ? ` · ${image.author}` : ''}
        </p>
      </figcaption>
    </figure>
  )
}

/**
 * Opt-in web reference pictures under a chemistry / biology lesson. Course
 * figures come first: when the lesson already has its own figures, the search
 * is not offered (cached pictures are still shown).
 */
export function ReferenceImageGallery({
  state,
  hasCourseFigures,
}: {
  state: UseReferenceImagesState
  hasCourseFigures: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const offerSearch = state.available && !hasCourseFigures
  if (state.images.length === 0 && !offerSearch) return null

  return (
    <section className="space-y-3" aria-label={t('referenceImages.title')}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">{t('referenceImages.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('referenceImages.subtitle')}</p>
        </div>
        {offerSearch && (
          <Button variant="outline" size="sm" onClick={() => void state.search()} disabled={state.searching}>
            {state.searching ? <Loader2 className="animate-spin" /> : <Globe />}
            {state.searching
              ? t('referenceImages.searching')
              : state.images.length > 0
                ? t('referenceImages.searchMore')
                : t('referenceImages.search')}
          </Button>
        )}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.searchedEmpty && !state.error && <p className="text-sm text-muted-foreground">{t('referenceImages.none')}</p>}
      {state.images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {state.images.map((image) => (
            <ReferenceFigure key={image.id} image={image} load={state.loadImage} onRemove={() => void state.remove(image.id)} />
          ))}
        </div>
      )}
    </section>
  )
}
