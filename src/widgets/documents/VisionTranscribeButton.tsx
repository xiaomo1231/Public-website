import { useEffect, useState } from 'react'
import { ScanText, Square } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isAbortError } from '@/shared/lib/generationControl'
import { useTranslation } from '@/i18n'

/**
 * 「用 AI 看图识别」: pages recognised from a picture (a scan, a photo, a PDF
 * without a text layer) are read again by the student's vision model. Only on
 * this click are the page images sent to the configured AI provider; the
 * button's hint says so. Hidden when the file has no such page.
 */
export function VisionTranscribeButton({
  documentId,
  refreshKey,
  onDone,
  size,
}: {
  documentId: string
  /** Changes when the file was re-processed (re-checks its pages). */
  refreshKey?: unknown
  onDone: () => void
  size?: 'sm'
}): JSX.Element | null {
  const { t } = useTranslation()
  const generation = useGenerationRun({ abortOnUnmount: true })
  const [running, setRunning] = useState(false)
  const [pages, setPages] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { PageTranscriptionService } = await import('@/services/pageTranscriptionService')
        const found = await new PageTranscriptionService(null).candidates(documentId)
        if (!cancelled) setPages(found.length)
      } catch {
        if (!cancelled) setPages(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId, refreshKey])

  if (pages === 0) return null

  const run = async () => {
    const control = generation.start()
    setRunning(true)
    try {
      const [{ SettingsService }, { AIService }, { PageTranscriptionService }] = await Promise.all([
        import('@/services/settingsService'),
        import('@/services/aiService'),
        import('@/services/pageTranscriptionService'),
      ])
      const settings = await new SettingsService().get()
      if (!settings.apiKey.trim()) {
        toast({ variant: 'error', title: t('handwritingRecognition.noAI') })
        return
      }
      const ai = new AIService({ config: settings, usageKind: 'other' })
      const result = await new PageTranscriptionService(ai, { model: settings.model }).transcribe(
        documentId,
        { control },
      )
      toast({
        variant: result.pages.length > 0 ? 'success' : 'warning',
        title:
          result.pages.length > 0
            ? t('documentDetail.vision.done', { count: result.pages.length })
            : t('documentDetail.vision.none'),
        ...(result.failed.length > 0
          ? {
              description: t('documentDetail.vision.failedPages', {
                pages: result.failed.join(', '),
              }),
            }
          : {}),
      })
      onDone()
    } catch (err) {
      if (!isAbortError(err, control.signal))
        toast({
          variant: 'error',
          title: t('documentDetail.vision.failed'),
          description: friendlyAIError(err),
        })
    } finally {
      generation.finish()
      setRunning(false)
    }
  }

  return running ? (
    <Button variant="outline" size={size} onClick={() => generation.stopNow()}>
      <Square className="h-4 w-4" />
      {t('documentDetail.vision.stop')}
    </Button>
  ) : (
    <Button
      variant="outline"
      size={size}
      onClick={() => void run()}
      title={t('documentDetail.vision.hint', { count: pages })}
    >
      <ScanText className="h-4 w-4" />
      {t('documentDetail.vision.action')}
    </Button>
  )
}
