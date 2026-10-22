import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  Download,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { HomeworkSet } from '@/entities/homework/types'
import {
  buildWalkthroughImportService,
  WalkthroughImportPartError,
  type ImportableDocument,
  type WalkthroughImportPreview,
  type WalkthroughImportService,
} from '@/services/walkthroughImportService'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Label } from '@/shared/ui/Label'
import { Progress } from '@/shared/ui/Progress'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { downloadText } from '@/shared/lib/download'
import { toast } from '@/features/toast/toastStore'
import { useTranslation } from '@/i18n'

export interface ImportWalkthroughDialogProps {
  set: HomeworkSet
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the imported sections were saved. */
  onImported?: () => void
}

/**
 * 导入讲解: pick (or upload) the walkthrough file, let the AI re-typeset it and
 * split it by question, review what was found, then save — asking before ready
 * sections are replaced (the replaced versions stay as 上一版).
 */
export function ImportWalkthroughDialog({
  set,
  open,
  onOpenChange,
  onImported,
}: ImportWalkthroughDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [service, setService] = useState<WalkthroughImportService | null>(null)
  const [documents, setDocuments] = useState<ImportableDocument[]>([])
  const [documentId, setDocumentId] = useState<string>('')
  const [formatOnly, setFormatOnly] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [preview, setPreview] = useState<WalkthroughImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isTemplate, setIsTemplate] = useState(false)
  /** The template shown to copy by hand when the clipboard is unavailable. */
  const [templateText, setTemplateText] = useState<string | null>(null)
  const generation = useGenerationRun({ abortOnUnmount: true })
  const running = generation.active

  const loadDocuments = useCallback(
    async (svc: WalkthroughImportService, select?: string) => {
      const list = await svc.importableDocuments(set.projectId)
      setDocuments(list)
      setDocumentId((current) => select ?? (current || list.find((doc) => doc.imported)?.id || ''))
    },
    [set.projectId],
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    void buildWalkthroughImportService()
      .then(async (svc) => {
        if (!alive) return
        setService(svc)
        await loadDocuments(svc)
      })
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
    return () => {
      alive = false
    }
  }, [open, loadDocuments])

  function reset(): void {
    setPreview(null)
    setProgress(null)
    setError(null)
    generation.reset()
  }

  useEffect(() => {
    if (!service || !documentId) {
      setIsTemplate(false)
      return
    }
    let alive = true
    void service
      .isTemplateDocument(documentId)
      .then((value) => {
        if (alive) setIsTemplate(value)
      })
      .catch(() => {
        if (alive) setIsTemplate(false)
      })
    return () => {
      alive = false
    }
  }, [service, documentId])

  async function loadTemplate(): Promise<{ text: string; fileName: string } | null> {
    if (!service) return null
    try {
      return await service.template(set.id)
    } catch (err) {
      setError(friendlyAIError(err))
      return null
    }
  }

  async function copyTemplate(): Promise<void> {
    const template = await loadTemplate()
    if (!template) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(template.text)
      setTemplateText(null)
      toast({ variant: 'success', title: t('walkthroughImport.template.copied') })
    } catch {
      // No clipboard (insecure context, denied): show the text to copy by hand.
      setTemplateText(template.text)
      toast({ variant: 'error', title: t('walkthroughImport.template.copyFallback') })
    }
  }

  async function downloadTemplate(): Promise<void> {
    const template = await loadTemplate()
    if (template) downloadText(template.fileName, template.text, 'text/markdown;charset=utf-8')
  }

  async function prepare(resume?: WalkthroughImportPreview, rest = false): Promise<void> {
    if (!service || !documentId) return
    setError(null)
    // 用 AI 整理剩下的 continues a template import: its progress replaces the summary.
    if (rest && resume?.complete) setPreview(null)
    const run = generation.start()
    try {
      // 继续导入 after a failure re-reads the AI settings (a raised output cap applies).
      const svc = resume && error ? await buildWalkthroughImportService() : service
      if (svc !== service) setService(svc)
      const result = await svc.prepare({
        setId: set.id,
        documentId,
        checkIssues: !formatOnly,
        control: run,
        onProgress: setProgress,
        ...(resume ? { resume } : {}),
        ...(rest || resume?.mode === 'template' ? { rest: true } : {}),
      })
      setPreview(result)
    } catch (err) {
      // Keep what was read: 继续导入 asks only for the failed piece and the rest.
      if (err instanceof WalkthroughImportPartError) setPreview(err.partial)
      setError(friendlyAIError(err))
    } finally {
      run.finish()
    }
  }

  async function commit(confirmReplace: boolean): Promise<void> {
    if (!service || !preview) return
    setSaving(true)
    try {
      const result = await service.commit(preview, { confirmReplace })
      toast({
        variant: 'success',
        title: t('walkthroughImport.saved', { count: result.saved }),
        ...(result.replaced > 0
          ? { description: t('walkthroughImport.savedReplaced', { count: result.replaced }) }
          : preview.keptGenerated.length > 0
            ? { description: t('walkthroughImport.savedKept') }
            : {}),
      })
      onImported?.()
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setSaving(false)
    }
  }

  const paused = preview && !preview.complete
  /** Stopped by a failure (not a pause): offered as 继续导入 in the footer. */
  const failedPart = Boolean(paused && error && !running)
  const ready = preview?.complete ? preview : null

  return (
    <>
      <Dialog
        open={open && !uploadOpen}
        onOpenChange={(next) => {
          if (!next && running) return
          if (!next) reset()
          onOpenChange(next)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('walkthroughImport.title')}</DialogTitle>
            <DialogDescription>{t('walkthroughImport.description')}</DialogDescription>
          </DialogHeader>

          {!ready && (
            <div className="space-y-4">
              <section
                aria-labelledby="walkthrough-import-template"
                className="space-y-2 rounded-md border border-border p-3 lecture:rounded-none lab:rounded-none"
              >
                <h3 id="walkthrough-import-template" className="text-sm font-medium">
                  {t('walkthroughImport.template.title')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t('walkthroughImport.template.hint')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!service || running}
                    onClick={() => void copyTemplate()}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    {t('walkthroughImport.template.copy')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!service || running}
                    onClick={() => void downloadTemplate()}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    {t('walkthroughImport.template.download')}
                  </Button>
                </div>
                {templateText !== null && (
                  <textarea
                    readOnly
                    aria-label={t('walkthroughImport.template.manual')}
                    className="focus-ring h-32 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs lecture:rounded-none lab:rounded-none"
                    value={templateText}
                    ref={(node) => node?.select()}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
              </section>

              <div className="space-y-2">
                <Label htmlFor="walkthrough-import-doc">{t('walkthroughImport.file')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={documentId}
                    onValueChange={(value) => {
                      setDocumentId(value)
                      setPreview(null)
                    }}
                    disabled={running || documents.length === 0}
                  >
                    <SelectTrigger id="walkthrough-import-doc" className="min-w-0 flex-1">
                      <SelectValue placeholder={t('walkthroughImport.pickFile')} />
                    </SelectTrigger>
                    <SelectContent>
                      {documents.map((doc) => (
                        <SelectItem key={doc.id} value={doc.id}>
                          {doc.imported
                            ? doc.name
                            : `${doc.name} · ${t('walkthroughImport.otherFile')}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={running}
                    onClick={() => setUploadOpen(true)}
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {t('walkthroughImport.upload')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('walkthroughImport.fileHint')}</p>
              </div>

              {isTemplate ? (
                <p className="text-sm" data-template-import>
                  {t('walkthroughImport.template.detected')}
                </p>
              ) : (
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={formatOnly}
                    disabled={running}
                    onChange={(event) => {
                      setFormatOnly(event.target.checked)
                      setPreview(null)
                    }}
                  />
                  <span>
                    <span className="font-medium">{t('walkthroughImport.formatOnly')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('walkthroughImport.formatOnlyHint')}
                    </span>
                  </span>
                </label>
              )}

              {(running || paused) && progress && (
                <div className="space-y-2" role="status">
                  <p className="flex items-center gap-2 text-sm">
                    {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {t('walkthroughImport.progress', {
                      // The part being read now (1-based) while running.
                      done: Math.min(progress.done + (running ? 1 : 0), progress.total),
                      total: progress.total,
                    })}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Progress
                      className="min-w-[10rem] flex-1"
                      value={progress.total ? (progress.done / progress.total) * 100 : 0}
                    />
                    <GenerationControls
                      kind="parts"
                      state={generation.state}
                      done={progress.done}
                      total={progress.total}
                      stopRequested={generation.run?.stopRequested ?? false}
                      onPause={generation.requestPause}
                      onStopNow={generation.stopNow}
                      {...(paused && !failedPart ? { onResume: () => void prepare(preview) } : {})}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {ready && (
            <ImportSummary
              preview={ready}
              {...(ready.restText
                ? {
                    onRest: () => void prepare(ready, true),
                    restDisabled: !service?.hasAI() || running || saving,
                  }
                : {})}
            />
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            {ready ? (
              <>
                <Button variant="ghost" disabled={saving} onClick={() => setPreview(null)}>
                  {t('walkthroughImport.back')}
                </Button>
                <Button
                  disabled={saving || ready.sections.length === 0}
                  onClick={() => void commit(ready.conflicts.length > 0)}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {ready.conflicts.length > 0
                    ? t('walkthroughImport.replaceAndSave', { count: ready.conflicts.length })
                    : t('walkthroughImport.save', { count: ready.sections.length })}
                </Button>
              </>
            ) : failedPart && preview ? (
              <Button disabled={!service || running} onClick={() => void prepare(preview)}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t('walkthroughImport.retry')}
              </Button>
            ) : (
              <Button
                disabled={!service || !documentId || running || Boolean(paused)}
                title={service && !service.hasAI() ? t('homework.noProvider') : undefined}
                onClick={() => void prepare()}
              >
                <FileUp className="h-4 w-4" aria-hidden />
                {t('walkthroughImport.start')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentUploadDialog
        projectId={set.projectId}
        open={uploadOpen}
        onOpenChange={(next) => {
          setUploadOpen(next)
          if (!next && service) void loadDocuments(service)
        }}
        materialType="walkthrough_import"
        onUploaded={(id) => {
          setDocumentId(id)
          setPreview(null)
          if (service) void loadDocuments(service, id)
        }}
      />
    </>
  )
}

/** What the import found, before saving. */
function ImportSummary({
  preview,
  onRest,
  restDisabled,
}: {
  preview: WalkthroughImportPreview
  /** 用 AI 整理剩下的 (offered when the template has blocks an AI could read). */
  onRest?: () => void
  restDisabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const issues = preview.sections.reduce((sum, section) => sum + (section.issues?.length ?? 0), 0)
  const problems = preview.templateProblems ?? []
  return (
    <div className="space-y-2 text-sm">
      {preview.mode === 'template' && (
        <p className="text-muted-foreground" data-template-import>
          {t('walkthroughImport.template.detected')}
        </p>
      )}
      {problems.length > 0 && (
        <div className="space-y-1 text-amber-700 dark:text-amber-300">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('walkthroughImport.template.problems', { count: problems.length })}
          </p>
          <ul className="list-disc space-y-0.5 pl-10 text-xs">
            {problems.map((problem, index) => (
              <li key={`${problem.questionId ?? ''}-${index}`}>
                {t(`walkthroughImport.template.reason.${problem.reason}`, {
                  label: problem.label ?? problem.questionId ?? '?',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {onRest && (
        <div className="space-y-1">
          <Button variant="outline" size="sm" disabled={restDisabled} onClick={onRest}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {t('walkthroughImport.template.rest')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('walkthroughImport.template.restHint')}
          </p>
        </div>
      )}
      <p>
        {t('walkthroughImport.found', {
          count: preview.sections.filter((section) => section.kind === 'question').length,
        })}
      </p>
      {preview.checkIssues && (
        <p className="text-muted-foreground">
          {t('walkthroughImport.issuesFound', { count: issues })}
        </p>
      )}
      {preview.uncovered.length > 0 && (
        <p className="text-muted-foreground">
          {t('walkthroughImport.uncovered', { count: preview.uncovered.length })}
        </p>
      )}
      {preview.rejected.length > 0 && (
        <p className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('walkthroughImport.rejected', { count: preview.rejected.length })}
        </p>
      )}
      {preview.unknownIds.length > 0 && (
        <p className="text-muted-foreground">
          {t('walkthroughImport.unknownIds', { count: preview.unknownIds.length })}
        </p>
      )}
      {preview.keptGenerated.length > 0 && (
        <p className="text-muted-foreground">
          {t('walkthroughImport.keptGenerated', { count: preview.keptGenerated.length })}
        </p>
      )}
      {preview.conflicts.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-amber-800 lecture:rounded-none lab:rounded-none dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('walkthroughImport.confirmReplace', { count: preview.conflicts.length })}
        </p>
      )}
      {preview.sections.length === 0 && (
        <p className="text-destructive">{t('walkthroughImport.errors.nothing')}</p>
      )}
    </div>
  )
}
