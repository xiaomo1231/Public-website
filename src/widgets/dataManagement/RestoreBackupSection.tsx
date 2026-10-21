import { useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Progress } from '@/shared/ui/Progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import {
  DataManagementService,
  type BackupSummary,
  type RestoreProgress,
} from '@/services/dataManagementService'
import { isAppError } from '@/infrastructure/errors/AppError'
import { formatBytes } from '@/shared/lib/format'
import { formatDateTime, formatNumber, useTranslation } from '@/i18n'
import { toast } from '@/features/toast/toastStore'

type Phase = 'confirm' | 'restoring' | 'done' | 'failed'

interface RestoreBackupSectionProps {
  /** Runs the panel's normal export so the current data can be saved first. */
  onExport: () => void | Promise<void>
  exporting: boolean
}

function errorText(err: unknown): string {
  return isAppError(err) || err instanceof Error ? err.message : String(err)
}

/**
 * "Restore from backup": pick an exported .json, review what it holds, then
 * replace all local data with it. The app reloads afterwards so every store
 * starts from the restored data.
 */
export function RestoreBackupSection({
  onExport,
  exporting,
}: RestoreBackupSectionProps): JSX.Element {
  const { t, language } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const ackId = useId()
  const [inspecting, setInspecting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  const [phase, setPhase] = useState<Phase>('confirm')
  const [acknowledged, setAcknowledged] = useState(false)
  const [progress, setProgress] = useState<RestoreProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = summary !== null
  const busy = phase === 'restoring'

  async function handlePick(picked: File | undefined) {
    if (inputRef.current) inputRef.current.value = ''
    if (!picked) return
    setInspecting(true)
    try {
      const result = await new DataManagementService().inspectBackup(picked)
      setFile(picked)
      setPhase('confirm')
      setAcknowledged(false)
      setProgress(null)
      setError(null)
      setSummary(result)
    } catch (err) {
      toast({ variant: 'error', title: t('backup.inspectFailed'), description: errorText(err) })
    } finally {
      setInspecting(false)
    }
  }

  async function handleRestore() {
    if (!file) return
    setPhase('restoring')
    setError(null)
    try {
      await new DataManagementService().restoreFromFile(file, { onProgress: setProgress })
      setPhase('done')
    } catch (err) {
      setError(errorText(err))
      setPhase('failed')
    }
  }

  function close() {
    setSummary(null)
    setFile(null)
  }

  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold lecture:font-heading">{t('backup.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('backup.description')}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void handlePick(e.target.files?.[0])}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={inspecting}>
        {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {inspecting ? t('backup.inspecting') : t('backup.choose')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          if (!next) {
            if (phase === 'done') window.location.reload()
            else close()
          }
        }}
      >
        <DialogContent
          className="max-w-xl"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (busy || phase === 'done') e.preventDefault()
          }}
        >
          {summary && phase === 'done' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {t('backup.doneTitle')}
                </DialogTitle>
                <DialogDescription>{t('backup.doneBody')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => window.location.reload()}>{t('backup.finish')}</Button>
              </DialogFooter>
            </>
          ) : summary ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('backup.dialogTitle')}</DialogTitle>
                {file && (
                  <DialogDescription className="break-all">
                    {t('backup.file', { name: file.name, size: formatBytes(file.size) })}
                  </DialogDescription>
                )}
              </DialogHeader>

              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                <SummaryLine
                  label={t('backup.exportedAt')}
                  value={
                    summary.exportedAt && !Number.isNaN(Date.parse(summary.exportedAt))
                      ? formatDateTime(Date.parse(summary.exportedAt), language)
                      : t('backup.unknownDate')
                  }
                />
                <SummaryLine
                  label={t('backup.schemaVersion')}
                  value={`v${summary.schemaVersion}`}
                />
                <SummaryLine
                  label={t('backup.projects')}
                  value={formatNumber(summary.counts.projects, language)}
                />
                <SummaryLine
                  label={t('backup.documents')}
                  value={formatNumber(summary.counts.documents, language)}
                />
                <SummaryLine
                  label={t('backup.files')}
                  value={t('backup.filesValue', {
                    count: formatNumber(summary.counts.files, language),
                    size: formatBytes(summary.counts.fileBytes),
                  })}
                />
                <SummaryLine
                  label={t('backup.quizzes')}
                  value={formatNumber(summary.counts.quizzes, language)}
                />
                <SummaryLine
                  label={t('backup.mistakes')}
                  value={formatNumber(summary.counts.mistakes, language)}
                />
                <SummaryLine
                  label={t('backup.vocabWords')}
                  value={formatNumber(summary.counts.vocabWords, language)}
                />
                <SummaryLine
                  label={t('backup.reviewCards')}
                  value={formatNumber(summary.counts.reviewCards, language)}
                />
              </dl>

              <BackupWarnings summary={summary} />

              <div
                role="alert"
                className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <p className="flex items-start gap-2 font-medium text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t('backup.replaceWarning')}
                </p>
                <p className="text-muted-foreground">{t('backup.notRestored')}</p>
              </div>

              {phase === 'confirm' || phase === 'failed' ? (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onExport()}
                    disabled={exporting}
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {t('backup.exportFirst')}
                  </Button>
                  <label htmlFor={ackId} className="flex cursor-pointer items-start gap-3 text-sm">
                    <input
                      id={ackId}
                      type="checkbox"
                      className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    <span>{t('backup.acknowledge')}</span>
                  </label>
                </div>
              ) : null}

              {busy && (
                <div className="space-y-2" aria-live="polite">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {progress ? t(`backup.stage.${progress.stage}`) : t('backup.restoring')}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {progress?.stage === 'files'
                        ? t('backup.filesProgress', {
                            done: formatNumber(progress.done, language),
                            total: formatNumber(progress.total, language),
                          })
                        : `${percent}%`}
                    </span>
                  </div>
                  <Progress value={percent} aria-label={t('backup.restoring')} />
                </div>
              )}

              {phase === 'failed' && error && (
                <div
                  role="alert"
                  className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="font-medium text-destructive">{t('backup.failedTitle')}</p>
                  <p className="break-words">{error}</p>
                  <p className="text-muted-foreground">{t('backup.unchanged')}</p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleRestore()}
                  disabled={!acknowledged || busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? t('backup.restoring') : t('backup.restore')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </div>
  )
}

function BackupWarnings({ summary }: { summary: BackupSummary }) {
  const { t, language } = useTranslation()
  const dropped = Object.values(summary.droppedRows).reduce((sum, n) => sum + n, 0)
  const items = [
    summary.ignoredTables.length > 0 &&
      t('backup.warnIgnoredTables', { names: summary.ignoredTables.join(', ') }),
    dropped > 0 && t('backup.warnDroppedRows', { count: formatNumber(dropped, language) }),
    summary.skippedFiles > 0 &&
      t('backup.warnSkippedFiles', { count: formatNumber(summary.skippedFiles, language) }),
  ].filter((item): item is string => Boolean(item))
  if (!items.length) return null
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
