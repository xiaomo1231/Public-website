import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog'
import { Label } from '@/shared/ui/Label'
import { RichText } from '@/shared/ui/RichText'
import { Textarea } from '@/shared/ui/Textarea'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import {
  acceptGuesses,
  findUnclearMarks,
  isTranscriptConfirmed,
  type AnswerTranscript,
} from '@/entities/handwriting/types'
import type { HomeworkAnswerImage } from '@/entities/homework/answerImages'

/** Regions below this confidence are listed as "may be misread". */
export const LOW_CONFIDENCE = 0.7

export interface TranscriptItem {
  questionId: string
  number: string
  images: HomeworkAnswerImage[]
  imageKey: string
  transcript?: AnswerTranscript
}

function ImageStrip({ images, number }: { images: HomeworkAnswerImage[]; number: string }) {
  const { t } = useTranslation()
  const [urls, setUrls] = useState<string[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  useEffect(() => {
    const next = images.map((image) =>
      URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType })),
    )
    setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [images])
  return (
    <div className="space-y-2" data-transcript-original>
      {urls.map((url, index) => (
        <button
          key={images[index]?.id ?? index}
          type="button"
          className="focus-ring block w-full overflow-hidden rounded-md border bg-white"
          aria-label={t('transcript.enlarge', { n: index + 1, number })}
          onClick={() => setViewing(index)}
        >
          <img
            src={url}
            alt={t('transcript.originalAlt', { n: index + 1, number })}
            className="max-h-[50vh] w-full object-contain"
          />
        </button>
      ))}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-5xl gap-3 p-4">
          <DialogTitle>{t('transcript.originalTitle', { number })}</DialogTitle>
          {viewing !== null && urls[viewing] && (
            <div className="max-h-[80vh] overflow-auto rounded-lg bg-white">
              <img
                src={urls[viewing]}
                alt={t('transcript.originalAlt', { n: viewing + 1, number })}
                className="mx-auto h-auto max-w-full"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TranscriptRow({
  item,
  busy,
  onConfirm,
  onRecognize,
}: {
  item: TranscriptItem
  busy: boolean
  onConfirm: (text: string) => Promise<void>
  onRecognize: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const transcript = item.transcript?.imageKey === item.imageKey ? item.transcript : undefined
  const confirmed = isTranscriptConfirmed(transcript, item.imageKey)
  const source = transcript?.confirmedText ?? transcript?.recognizedText ?? ''
  const [draft, setDraft] = useState(source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  // A new recognition replaces the draft (the student has not typed over it yet).
  useEffect(() => setDraft(source), [source])
  const marks = useMemo(() => findUnclearMarks(draft), [draft])
  const guesses = marks.filter((mark) => mark.guess).length
  const lowRegions = (transcript?.regions ?? []).filter(
    (region) => region.confidence !== undefined && region.confidence < LOW_CONFIDENCE,
  )
  const id = `transcript-${item.questionId}`

  function selectNextMark(): void {
    const area = areaRef.current
    if (!area || marks.length === 0) return
    const from = area.selectionEnd ?? 0
    const next = marks.find((mark) => mark.start >= from) ?? marks[0]!
    area.focus()
    area.setSelectionRange(next.start, next.end)
  }

  async function confirm(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onConfirm(draft)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="space-y-3 border-b pb-5" data-transcript-item={item.questionId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('mockExam.questionLabel', { number: item.number })}</span>
        {confirmed ? (
          <Badge variant="secondary" data-transcript-confirmed>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t('transcript.confirmed')}
          </Badge>
        ) : (
          <Badge variant="outline">{t('transcript.needsConfirm')}</Badge>
        )}
        {transcript?.provider && (
          <Badge variant="outline">
            {t(
              transcript.provider === 'vision-llm'
                ? 'transcript.provider.online'
                : transcript.provider === 'local-model'
                  ? 'transcript.provider.local'
                  : 'transcript.provider.typed',
            )}
            {transcript.model ? ` · ${transcript.model}` : ''}
          </Badge>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ImageStrip images={item.images} number={item.number} />
        <div className="space-y-2">
          {!transcript && <p className="text-xs text-muted-foreground">{t('transcript.notYet')}</p>}
          {transcript?.note && (
            <p
              className={
                transcript.status === 'failed'
                  ? 'text-sm text-destructive'
                  : 'text-xs text-amber-700 dark:text-amber-400'
              }
              role={transcript.status === 'failed' ? 'alert' : undefined}
            >
              {transcript.note}
            </p>
          )}
          <Label htmlFor={id}>{t('transcript.textLabel')}</Label>
          <Textarea
            id={id}
            ref={areaRef}
            rows={Math.min(14, Math.max(5, draft.split('\n').length + 1))}
            className="font-mono text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('transcript.placeholder')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {marks.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/30"
              data-unclear-marks
            >
              <span>{t('transcript.unclear', { count: marks.length })}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11"
                onClick={selectNextMark}
              >
                {t('transcript.nextUnclear')}
              </Button>
              {guesses > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11"
                  onClick={() => setDraft((value) => acceptGuesses(value))}
                >
                  <Wand2 aria-hidden />
                  {t('transcript.acceptGuesses', { count: guesses })}
                </Button>
              )}
            </div>
          )}
          {lowRegions.length > 0 && (
            <div className="text-xs text-muted-foreground" data-low-confidence>
              <p>{t('transcript.lowConfidence')}</p>
              <ul className="list-disc pl-5 font-mono">
                {lowRegions.slice(0, 8).map((region, index) => (
                  <li key={index}>{region.text}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.trim() && (
            <div className="rounded-md border p-2" data-transcript-preview>
              <p className="mb-1 text-xs text-muted-foreground">{t('transcript.preview')}</p>
              <RichText
                text={draft}
                format="markdown"
                className="space-y-1"
                paragraphClassName="text-sm"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11"
              disabled={busy || saving || marks.length > 0 || (confirmed && draft === source)}
              onClick={() => void confirm()}
            >
              {saving ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 aria-hidden />
              )}
              {confirmed ? t('transcript.reconfirm') : t('transcript.confirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy || saving}
              onClick={onRecognize}
            >
              <RefreshCw aria-hidden />
              {transcript ? t('transcript.recognizeAgain') : t('transcript.recognize')}
            </Button>
          </div>
          {marks.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('transcript.resolveFirst')}</p>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * Before grading: each handwritten answer next to what was recognised. The
 * student corrects the text (LaTeX for maths, live preview) and confirms it;
 * `[?]` marks must be resolved first. Only confirmed text is ever graded, so
 * a recognition error can never become a marking error.
 */
export function TranscriptConfirmPanel({
  items,
  busy,
  onConfirm,
  onRecognize,
  footer,
}: {
  items: TranscriptItem[]
  busy: boolean
  onConfirm: (questionId: string, text: string) => Promise<void>
  onRecognize: (questionIds: string[]) => void
  footer?: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const remaining = items.filter(
    (item) => !isTranscriptConfirmed(item.transcript, item.imageKey),
  ).length
  return (
    <Card data-transcript-panel>
      <CardHeader>
        <CardTitle className="text-base">{t('transcript.title')}</CardTitle>
        <CardDescription>{t('transcript.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" aria-live="polite">
          {remaining > 0
            ? t('transcript.remaining', { count: remaining, total: items.length })
            : t('transcript.allConfirmed')}
        </p>
        <ol className="space-y-5">
          {items.map((item) => (
            <TranscriptRow
              key={item.questionId}
              item={item}
              busy={busy}
              onConfirm={(text) => onConfirm(item.questionId, text)}
              onRecognize={() => onRecognize([item.questionId])}
            />
          ))}
        </ol>
        {footer}
      </CardContent>
    </Card>
  )
}
