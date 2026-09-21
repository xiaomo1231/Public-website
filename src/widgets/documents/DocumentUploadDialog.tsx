import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Progress } from '@/shared/ui/Progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { Textarea } from '@/shared/ui/Textarea'
import { useTranslation, type TranslationKey } from '@/i18n'
import type { LearningMaterialType } from '@/entities/document/types'
import { ACCEPTED_TYPES } from '@/infrastructure/files/validation'
import { formatBytes } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { useBatchUpload } from '@/features/documents/useBatchUpload'
import {
  MAX_BATCH_FILES,
  type FileIssue,
  type UploadQueueItem,
  type UploadStatus,
} from '@/features/documents/batchUpload'

export interface DocumentUploadDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which learning-material role these files belong to. */
  materialType?: LearningMaterialType
}

const TEXT_TAB = 'text' as const
const FILE_TAB = 'file' as const

type Mode = typeof FILE_TAB | typeof TEXT_TAB

const STATUS_KEYS: Record<UploadStatus, TranslationKey> = {
  queued: 'batch.status.queued',
  uploading: 'batch.status.uploading',
  processing: 'batch.status.processing',
  completed: 'batch.status.completed',
  failed: 'batch.status.failed',
  cancelled: 'batch.status.cancelled',
  skipped: 'batch.status.skipped',
}

const ISSUE_KEYS: Record<FileIssue, TranslationKey> = {
  unsupported: 'batch.issue.unsupported',
  'too-large': 'batch.issue.too-large',
  duplicate: 'batch.issue.duplicate',
}

const STAGE_KEYS: Record<string, TranslationKey> = {
  validating: 'batch.stage.validating',
  saving: 'batch.stage.saving',
  extracting: 'batch.stage.extracting',
  chunking: 'batch.stage.chunking',
  indexing: 'batch.stage.indexing',
  done: 'batch.stage.done',
  failed: 'batch.stage.failed',
}

const ACCEPT = ACCEPTED_TYPES.flatMap((entry) => entry.mime)
  .concat(ACCEPTED_TYPES.flatMap((entry) => entry.ext.map((e) => `.${e}`)))
  .join(',')

function ItemIcon({ item }: { item: UploadQueueItem }): JSX.Element {
  if (item.status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
  }
  if (item.status === 'failed') {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />
  }
  if (item.status === 'skipped') {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
  }
  if (item.status === 'uploading' || item.status === 'processing') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  }
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
}

export function DocumentUploadDialog({
  projectId,
  open,
  onOpenChange,
  materialType = 'textbook',
}: DocumentUploadDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>(FILE_TAB)
  const [text, setText] = useState('')
  const [textName, setTextName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const batch = useBatchUpload(projectId)
  const { items, summary, running } = batch

  const started = items.some((item) => item.status !== 'queued' && item.status !== 'skipped')
  const finished = summary.finished && started
  const settled = summary.completed + summary.failed + summary.cancelled
  const overall = summary.uploadable > 0 ? Math.round((settled / summary.uploadable) * 100) : 0
  const invalid = summary.unsupported + summary.tooLarge

  function statusLabel(item: UploadQueueItem): string {
    if (item.issue) return t(ISSUE_KEYS[item.issue])
    if ((item.status === 'uploading' || item.status === 'processing') && item.phase) {
      const stageKey = STAGE_KEYS[item.phase]
      if (stageKey) return t(stageKey)
    }
    return t(STATUS_KEYS[item.status])
  }

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Reset so picking the same file again still fires `change`.
    event.target.value = ''
    if (files.length > 0) await batch.addFiles(files, materialType)
  }

  async function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) await batch.addFiles(files, materialType)
  }

  async function handleUploadText() {
    if (!text.trim()) return
    const body = text
    const name = textName
    setText('')
    setTextName('')
    await batch.addTextAndStart({
      text: body,
      materialType,
      ...(name.trim() ? { name: name.trim() } : {}),
    })
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Closing mid-run stops the queue; already-completed documents remain.
      if (running) batch.cancelRemaining()
      batch.reset()
      setText('')
      setTextName('')
      setMode(FILE_TAB)
      setDragOver(false)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('batch.title')}</DialogTitle>
          <DialogDescription>{t('batch.description')}</DialogDescription>
        </DialogHeader>

        {!running && !finished && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value={FILE_TAB}>
                <Upload className="h-4 w-4" /> {t('upload.tab.file')}
              </TabsTrigger>
              <TabsTrigger value={TEXT_TAB}>
                <FileText className="h-4 w-4" /> {t('upload.tab.text')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={FILE_TAB} className="space-y-3">
              <Label
                htmlFor="upload-files"
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-6 py-8 text-center text-sm transition-colors',
                  dragOver && 'border-primary bg-primary/5',
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="font-medium">{t('batch.dropzone')}</span>
                <span className="text-xs text-muted-foreground">{t('upload.acceptedFormats')}</span>
                <Input
                  id="upload-files"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={handlePick}
                />
              </Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={summary.total >= MAX_BATCH_FILES}
              >
                <Upload className="h-4 w-4" />
                {summary.total > 0 ? t('batch.addMore') : t('batch.selectFiles')}
              </Button>
              {summary.total === 0 && (
                <p className="text-xs text-muted-foreground">{t('batch.noFiles')}</p>
              )}
            </TabsContent>

            <TabsContent value={TEXT_TAB} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="text-name">{t('upload.titleOptional')}</Label>
                <Input
                  id="text-name"
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                  placeholder={t('upload.titlePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="text-body">{t('upload.textLabel')}</Label>
                <Textarea
                  id="text-body"
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('upload.textPlaceholder')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('upload.charLimit', { count: text.length.toLocaleString() })}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handleUploadText} disabled={!text.trim()}>
                <Upload className="h-4 w-4" />
                {t('batch.addText')}
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                {t('batch.filesSelected', { count: summary.total })}
              </span>
              {running && (
                <span className="text-xs text-muted-foreground">
                  {t('batch.uploadingProgress', { done: settled, total: summary.uploadable })}
                </span>
              )}
            </div>

            {running && summary.uploadable > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('batch.overall')}</span>
                  <span className="tabular-nums">{overall}%</span>
                </div>
                <Progress value={overall} className="h-1.5" />
              </div>
            )}

            <ul
              className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-card p-2"
              aria-label={t('batch.queue')}
            >
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm">
                  <ItemIcon item={item} />
                  <span className="min-w-0 flex-1 truncate" title={item.name || t('upload.tab.text')}>
                    {item.name || t('upload.tab.text')}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : null}
                  </span>
                  <span
                    className={cn(
                      'w-40 shrink-0 truncate text-right text-xs',
                      item.status === 'failed' && 'text-destructive',
                      item.status === 'skipped' && 'text-amber-600 dark:text-amber-400',
                      (item.status === 'completed' || item.status === 'queued') &&
                        'text-muted-foreground',
                    )}
                    title={item.error ?? statusLabel(item)}
                  >
                    {statusLabel(item)}
                  </span>
                  {!running && item.status !== 'completed' && (
                    <button
                      type="button"
                      onClick={() => batch.removeItem(item.id)}
                      aria-label={t('batch.remove')}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {!started && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t('batch.readyToUpload', { count: summary.uploadable })}</span>
                {summary.duplicates > 0 && (
                  <span>{t('batch.duplicatesCount', { count: summary.duplicates })}</span>
                )}
                {invalid > 0 && <span>{t('batch.invalidCount', { count: invalid })}</span>}
                <span className="ml-auto">{t('batch.processingNote')}</span>
              </div>
            )}

            {finished && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium">{t('batch.completeTitle')}</p>
                <p className="text-muted-foreground">
                  {summary.failed === 0 && summary.cancelled === 0 && summary.duplicates === 0
                    ? t('batch.completeAll', { count: summary.completed })
                    : t('batch.completePartial', {
                        completed: summary.completed,
                        failed: summary.failed,
                        skipped: summary.duplicates + invalid + summary.cancelled,
                      })}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {finished ? (
            <>
              {summary.failed > 0 && (
                <Button variant="outline" onClick={() => void batch.retryFailed()}>
                  {t('batch.retryFailed')}
                </Button>
              )}
              <Button onClick={() => handleOpenChange(false)}>{t('batch.done')}</Button>
            </>
          ) : running ? (
            <Button variant="outline" onClick={batch.cancelRemaining}>
              {t('batch.cancelRemaining')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => void batch.start()}
                disabled={summary.queued === 0}
              >
                {t('batch.uploadCount', { count: summary.queued })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
