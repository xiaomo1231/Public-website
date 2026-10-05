import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  ListChecks,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { DocumentRepository } from '@/entities/document/repository'
import { PROCESSING_STATUS_LABEL_KEYS, resolveMaterialType, type Document } from '@/entities/document/types'
import {
  HOMEWORK_STATUS_LABEL_KEYS,
  type HomeworkSet,
  type ReanalysisSummary,
} from '@/entities/homework/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/DropdownMenu'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { HomeworkAnswerDialog } from '@/widgets/homework/HomeworkAnswerDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

const STATUS_VARIANT = {
  analyzing: 'secondary',
  ready: 'default',
  failed: 'destructive',
} as const

/** An `analyzing` set older than this, with no run in flight, is interrupted. */
const STALE_ANALYZING_MS = 120_000

/**
 * Homework hub: upload an assignment, watch the AI read its questions, and open
 * a walkthrough.
 *
 * A document has at most one set and analysis runs once — the service's
 * check-and-create is the guard, so revisiting, refreshing or opening a second
 * tab never re-identifies. Each card's menu separates the three actions:
 * Refresh (local only), Re-analyze (an explicit AI run) and Delete (removes the
 * assignment and its source file after confirmation).
 */
export function HomeworkLandingPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()
  const service = useHomeworkService()

  const [documents, setDocuments] = useState<Document[]>([])
  const [sets, setSets] = useState<HomeworkSet[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null)
  const [summary, setSummary] = useState<ReanalysisSummary | null>(null)
  const [deleting, setDeleting] = useState<HomeworkSet | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [answerTarget, setAnswerTarget] = useState<HomeworkSet | null>(null)
  const [uploadAnswerTarget, setUploadAnswerTarget] = useState<HomeworkSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef<Set<string>>(new Set())
  const reconciled = useRef(false)

  const load = useCallback(async () => {
    if (!projectId) return
    const docs = await new DocumentRepository().listByProject(projectId)
    const homeworkDocs = docs.filter(
      (doc) => resolveMaterialType(doc.materialType) === 'homework',
    )
    const nextSets = service ? await service.listSets(projectId) : []
    setDocuments(homeworkDocs)
    setSets(nextSets)
  }, [projectId, service])

  useEffect(() => {
    let alive = true
    void load()
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [load])

  // While any assignment is being analysed (or a document is still being
  // extracted), re-read local state so each card's progress stays live. This
  // polls IndexedDB only — it never triggers an AI call.
  const hasActiveWork = busyDocumentId !== null || sets.some((set) => set.status === 'analyzing')
  useEffect(() => {
    if (!hasActiveWork) return
    const timer = window.setInterval(() => {
      void load().catch(() => {
        /* transient read error: the next tick retries */
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveWork, load])

  // Clean up historical duplicates once per mount: more than one set for the
  // same documentId. Lossless — only sets with no student work are removed.
  useEffect(() => {
    if (!service || !projectId || reconciled.current) return
    reconciled.current = true
    void service
      .reconcileSets(projectId)
      .then((result) => {
        if (result.removed > 0) void load()
      })
      .catch(() => {
        /* cleanup is best-effort; never block the page */
      })
  }, [service, projectId, load])

  // Analyse each ready homework document that has no set yet — once per page.
  // The service is also idempotent, so a remount or second tab is harmless.
  useEffect(() => {
    if (!service || !projectId) return
    const pending = documents.find(
      (doc) =>
        doc.status === 'ready' &&
        !sets.some((set) => set.documentId === doc.id) &&
        !attempted.current.has(doc.id),
    )
    if (!pending) return
    attempted.current.add(pending.id)
    setBusyDocumentId(pending.id)
    setError(null)
    void service
      .createFromDocument(pending.id)
      .then(() => load())
      .catch((err) => setError(friendlyAIError(err)))
      .finally(() => setBusyDocumentId(null))
  }, [service, projectId, documents, sets, load])

  /** Refresh: read the latest local state only — never calls the AI. */
  const refresh = useCallback(async () => {
    setError(null)
    await load()
  }, [load])

  /** Re-analyze: an explicit AI run, only if one is not already in flight. */
  const reanalyze = useCallback(
    async (set: HomeworkSet) => {
      if (!service || service.isSetRunning(set.id)) return
      setBusyDocumentId(set.documentId)
      setError(null)
      setSummary(null)
      try {
        const result = await service.retrySet(set.id)
        if (result) setSummary(result.summary)
        await load()
      } catch (err) {
        setError(friendlyAIError(err))
      } finally {
        setBusyDocumentId(null)
      }
    },
    [service, load],
  )

  /**
   * An answer file finished uploading. Link it to the assignment that started
   * the upload, then open the mapping review for it.
   */
  const handleAnswerUploaded = useCallback(
    async (documentId: string) => {
      const target = uploadAnswerTarget
      if (!service || !target) return
      try {
        const updated = await service.attachAnswerDocument(target.id, documentId)
        setUploadAnswerTarget(null)
        await load()
        setAnswerTarget(updated)
      } catch (err) {
        setError(friendlyAIError(err))
      }
    },
    [service, uploadAnswerTarget, load],
  )

  const confirmDelete = useCallback(async () => {
    if (!service || !deleting || !projectId) return
    setDeleteBusy(true)
    try {
      await service.deleteAssignment(deleting.id, projectId)
      toast({ variant: 'success', title: t('homework.deleted') })
      setDeleting(null)
      await load()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('homework.deleteFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setDeleteBusy(false)
    }
  }, [service, deleting, projectId, load, t])

  if (!projectId) return <div />

  return (
    <PageContainer>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title={t('homework.title')}
        description={t('homework.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="homework" />}
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            {t('homework.upload')}
          </Button>
        }
      />
      <PageContent className="space-y-5">
        {loading ? (
          <LoadingState label={t('common.loading')} />
        ) : (
          <>
            {summary && (
              <Card className="border-border/70">
                <CardHeader>
                  <CardTitle className="text-base">{t('homework.reanalysis.title')}</CardTitle>
                  <CardDescription>
                    {t('homework.reanalysis.summary', {
                      matched: summary.matched,
                      regenerated: summary.regenerated,
                      added: summary.added,
                      restored: summary.restored,
                      retired: summary.retired,
                    })}
                  </CardDescription>
                </CardHeader>
                {summary.failed > 0 && (
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    {t('homework.reanalysis.failed', { count: summary.failed })}
                  </CardContent>
                )}
              </Card>
            )}

            {error && (
              <ErrorState
                title={t('homework.failedTitle')}
                description={error}
                action={
                  <Button variant="outline" onClick={() => setUploadOpen(true)}>
                    <Upload className="h-4 w-4" />
                    {t('homework.upload')}
                  </Button>
                }
              />
            )}

            {documents.length === 0 && sets.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="h-10 w-10" />}
                title={t('homework.empty')}
                description={t('homework.emptyHint')}
                action={
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload className="h-4 w-4" />
                    {t('homework.upload')}
                  </Button>
                }
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sets.map((set) => {
                  const running =
                    busyDocumentId === set.documentId || Boolean(service?.isSetRunning(set.id))
                  const interrupted =
                    set.status === 'analyzing' &&
                    !running &&
                    Date.now() - set.updatedAt > STALE_ANALYZING_MS
                  const generating = set.status === 'analyzing' && set.progress?.stage === 'generating'
                  return (
                    <li key={set.id}>
                      <Card className="flex h-full flex-col">
                        <CardHeader>
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="min-w-0 text-base">
                              <TruncatedText text={set.title} className="min-w-0 max-w-full" />
                            </CardTitle>
                            <div className="flex shrink-0 items-center gap-1">
                              <Badge variant={STATUS_VARIANT[set.status]}>
                                {generating
                                  ? t('homework.status.preparing')
                                  : t(HOMEWORK_STATUS_LABEL_KEYS[set.status])}
                              </Badge>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={t('homework.menu.label')}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => void refresh()}>
                                    <RefreshCw className="h-4 w-4" />
                                    {t('homework.menu.refresh')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => void reanalyze(set)}
                                    disabled={running}
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    {t('homework.menu.reanalyze')}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setUploadAnswerTarget(set)}>
                                    <ClipboardCheck className="h-4 w-4" />
                                    {set.answerDocumentId
                                      ? t('homework.menu.replaceAnswer')
                                      : t('homework.menu.uploadAnswer')}
                                  </DropdownMenuItem>
                                  {set.answerDocumentId && (
                                    <DropdownMenuItem onSelect={() => setAnswerTarget(set)}>
                                      <ListChecks className="h-4 w-4" />
                                      {t('homework.menu.manageAnswer')}
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() => setDeleting(set)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t('homework.menu.delete')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                          <CardDescription>
                            {set.status === 'ready'
                              ? t('homework.questionsCount', { count: set.questionCount })
                              : relativeTime(set.updatedAt)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="mt-auto space-y-3">
                          {interrupted && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              {t('homework.analysisInterrupted')}
                            </p>
                          )}
                          {set.analysisNote && (
                            <p className="text-xs text-muted-foreground">{set.analysisNote}</p>
                          )}
                          {set.status === 'failed' && set.errorMessage && (
                            <p className="text-xs text-muted-foreground">{set.errorMessage}</p>
                          )}
                          {set.status === 'failed' ? (
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => void reanalyze(set)}
                              disabled={running}
                            >
                              {running ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                              {t('homework.retryAnalyze')}
                            </Button>
                          ) : set.status === 'analyzing' ? (
                            interrupted ? (
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => void reanalyze(set)}
                                disabled={running}
                              >
                                <RotateCcw className="h-4 w-4" />
                                {t('homework.retryAnalyze')}
                              </Button>
                            ) : (
                              <SetProgress set={set} />
                            )
                          ) : (
                            <Button asChild className="w-full">
                              <Link to={`/projects/${projectId}/homework/${set.id}`}>
                                {t('homework.open')}
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  )
                })}

                {documents
                  .filter((doc) => !sets.some((set) => set.documentId === doc.id))
                  .map((doc) => (
                    <li key={doc.id}>
                      <Card className="flex h-full flex-col border-dashed">
                        <CardHeader>
                          <CardTitle className="min-w-0 text-base">
                            <TruncatedText text={doc.name} className="min-w-0 max-w-full" />
                          </CardTitle>
                          <CardDescription>
                            {busyDocumentId === doc.id
                              ? t('homework.analyzing')
                              : t(PROCESSING_STATUS_LABEL_KEYS[doc.status])}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="mt-auto space-y-2">
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            {(busyDocumentId === doc.id ||
                              doc.status === 'processing' ||
                              doc.status === 'uploading') && (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            )}
                            {doc.status === 'failed'
                              ? t('homework.noContent')
                              : doc.status === 'ready'
                                ? t('homework.analyzing')
                                : t('homework.progress.extracting')}
                          </p>
                          {(busyDocumentId === doc.id ||
                            doc.status === 'processing' ||
                            doc.status === 'uploading') && (
                            <HomeworkProgressBar label={t('homework.progress.extracting')} />
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </PageContent>

      <DocumentUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) {
            attempted.current.clear()
            void load()
          }
        }}
        materialType="homework"
      />

      <DocumentUploadDialog
        projectId={projectId}
        open={uploadAnswerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUploadAnswerTarget(null)
        }}
        materialType="homework_answer"
        onUploaded={(documentId) => void handleAnswerUploaded(documentId)}
      />

      {answerTarget && service && (
        <HomeworkAnswerDialog
          projectId={projectId}
          set={answerTarget}
          service={service}
          open={answerTarget !== null}
          onOpenChange={(open) => {
            if (!open) setAnswerTarget(null)
          }}
          onRequestUpload={() => {
            const target = answerTarget
            setAnswerTarget(null)
            setUploadAnswerTarget(target)
          }}
          onChanged={() => void load()}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('homework.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('homework.deleteIntro', { name: deleting?.title ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('homework.deleteScope', { count: deleting?.questionCount ?? 0 })}</p>
            <p>{t('homework.deleteStudentNote')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t('homework.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

/**
 * Stage-aware progress for one assignment card.
 *
 * The bar is only ever driven by real finished work units stored on the set
 * (`progress.completed` / `progress.total`); when the total is not yet known it
 * falls back to an indeterminate bar rather than a fake percentage.
 */
function SetProgress({ set }: { set: HomeworkSet }): JSX.Element {
  const { t } = useTranslation()
  const progress = set.progress
  const total = progress?.total
  const determinate = typeof total === 'number' && total > 0
  const completed = progress?.completed ?? 0
  const generating = progress?.stage === 'generating'
  const label = generating
    ? determinate
      ? t('homework.progress.generating', { current: completed, total: total as number })
      : t('homework.progress.generatingUnknown')
    : determinate
      ? t('homework.progress.identifying', { current: completed, total: total as number })
      : t('homework.progress.identifyingUnknown')
  const value = determinate ? Math.round((completed / (total as number)) * 100) : undefined
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {label}
      </p>
      <HomeworkProgressBar value={value} label={label} />
    </div>
  )
}

function HomeworkProgressBar({ value, label }: { value?: number; label: string }): JSX.Element {
  const indeterminate = value === undefined
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': value })}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {indeterminate ? (
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${value}%` }}
        />
      )}
    </div>
  )
}
