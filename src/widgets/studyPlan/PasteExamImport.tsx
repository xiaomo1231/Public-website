import { useRef, useState } from 'react'
import { ClipboardPaste, ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isAbortError } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import type { PasteCourse, PastedExam } from '@/entities/studyPlan/examPaste'
import type { ExamScheduleImportService } from '@/services/examScheduleImportService'
import { MAX_SCHEDULE_IMAGES } from '@/services/examScheduleImportService'
import { useTranslation } from '@/i18n'

/**
 * 粘贴识别: paste text (a syllabus line, an email, a table) or a screenshot
 * (paste, drop or pick) and get editable draft exams. Text is read locally
 * first; the AI is asked only when that finds nothing or is unsure, and for
 * images. Nothing is saved here — the drafts go to the exam form.
 */
export function PasteExamImport({
  service,
  hasAI,
  courses,
  defaultProjectId,
  onDrafts,
  onClose,
}: {
  service: ExamScheduleImportService
  hasAI: boolean
  courses: PasteCourse[]
  defaultProjectId?: string
  onDrafts: (exams: PastedExam[]) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const run = useGenerationRun()

  function addImages(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith('image/'))
    if (accepted.length === 0) return
    setImages((list) => [...list, ...accepted].slice(0, MAX_SCHEDULE_IMAGES))
    setMessage(null)
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.some((file) => file.type.startsWith('image/'))) {
      event.preventDefault()
      addImages(files)
    }
  }

  async function read() {
    if (busy) return
    const pasted = text.trim()
    if (!pasted && images.length === 0) {
      setMessage({ kind: 'error', text: t('plan.paste.empty') })
      return
    }
    setBusy(true)
    setMessage(null)
    const control = run.start()
    const options = {
      courses,
      signal: control.signal,
      ...(defaultProjectId ? { defaultProjectId } : {}),
    }
    try {
      const found: PastedExam[] = []
      const notes: string[] = []
      if (pasted) {
        const result = await service.readText(pasted, options)
        found.push(...result.exams)
        if (result.via === 'ai')
          notes.push(t('plan.paste.readByAI', { count: result.exams.length }))
        if (result.dropped > 0) notes.push(t('plan.paste.dropped', { count: result.dropped }))
        if (result.aiError) notes.push(t('plan.paste.aiFailed', { reason: result.aiError }))
        if (result.needsAI && result.exams.length === 0) notes.push(t('plan.paste.needsAI'))
      }
      if (images.length > 0) {
        if (!hasAI) {
          notes.push(t('plan.paste.imageNeedsAI'))
        } else {
          const result = await service.readImages(images, options)
          found.push(...result.exams)
          if (result.dropped > 0) notes.push(t('plan.paste.dropped', { count: result.dropped }))
        }
      }
      if (found.length === 0) {
        setMessage({ kind: 'error', text: [t('plan.paste.nothing'), ...notes].join(' ') })
      } else {
        onDrafts(found)
        setText('')
        setImages([])
        setMessage({
          kind: 'info',
          text: [t('plan.paste.found', { count: found.length }), ...notes].join(' '),
        })
      }
    } catch (err) {
      if (!isAbortError(err, control.signal))
        setMessage({ kind: 'error', text: friendlyAIError(err) })
    } finally {
      run.finish()
      setBusy(false)
    }
  }

  return (
    <section
      className="space-y-3 rounded-md border p-3 lab:rounded-none"
      aria-labelledby="exam-paste-title"
      data-exam-paste
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="exam-paste-title" className="flex-1 text-sm font-medium">
          {t('plan.paste.title')}
        </h3>
        <Button size="sm" variant="ghost" aria-label={t('common.close')} onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('plan.paste.hint')}</p>
      <div
        className={cn('rounded-md lab:rounded-none', dragOver && 'ring-2 ring-ring')}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          addImages(Array.from(event.dataTransfer.files ?? []))
        }}
      >
        <Label htmlFor="exam-paste-text" className="sr-only">
          {t('plan.paste.label')}
        </Label>
        <Textarea
          id="exam-paste-text"
          rows={5}
          value={text}
          placeholder={t('plan.paste.placeholder')}
          onPaste={onPaste}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void read()
            }
          }}
        />
      </div>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('plan.paste.images')}>
          {images.map((image, i) => (
            <li
              key={`${image.name}-${i}`}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs lab:rounded-none"
            >
              {image.name || t('plan.paste.screenshot', { n: i + 1 })}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={t('plan.paste.removeImage', { name: image.name || String(i + 1) })}
                onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void read()} data-paste-read>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ClipboardPaste className="h-4 w-4" aria-hidden />
          )}
          {t('plan.paste.read')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {t('plan.paste.addImage')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            addImages(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <GenerationControls kind="single" state={run.state} hideStatus onStopNow={run.stopNow} />
        {!hasAI && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t('plan.paste.localOnly')}
          </span>
        )}
      </div>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'text-sm',
            message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
