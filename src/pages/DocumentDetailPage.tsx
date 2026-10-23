import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  FileText,
  Hash,
  Layers,
  Search,
  Trash2,
} from 'lucide-react'
import type { DocumentChunk } from '@/entities/chunk/types'
import { useDocument } from '@/features/documents/useDocuments'
import { useProject } from '@/features/project/useProjects'
import { ChunkRepository } from '@/entities/chunk/repository'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import type { DocumentDeleteImpact } from '@/services/documentService'
import { getDb } from '@/infrastructure/db/database'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import {
  EVAL_ROLES,
  EVAL_ROLE_HINT_KEYS,
  EVAL_ROLE_LABEL_KEYS,
  resolveEvalRole,
} from '@/entities/evaluation/evalRole'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProgressiveList } from '@/shared/ui/ProgressiveList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { ChunkPreview } from '@/widgets/documents/ChunkPreview'
import { VisionTranscribeButton } from '@/widgets/documents/VisionTranscribeButton'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { formatDate, formatDateTime, relativeTime } from '@/shared/lib/utils'
import { formatBytes } from '@/shared/lib/format'
import { useTranslation } from '@/i18n'
import { PROCESSING_STATUS_LABEL_KEYS } from '@/entities/document/types'

export function DocumentDetailPage(): JSX.Element {
  const { id: projectId, did } = useParams<{ id: string; did: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { document, status, error, refresh } = useDocument(projectId, did)
  const { project } = useProject(projectId)
  const removeDocument = useDocumentsStore((s) => s.remove)
  const describeDelete = useDocumentsStore((s) => s.describeDelete)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** What deleting would remove; `blocked` when the file holds student work. */
  const [impact, setImpact] = useState<DocumentDeleteImpact | null>(null)
  const [checkingDelete, setCheckingDelete] = useState(false)
  const [chunks, setChunks] = useState<DocumentChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(true)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // `?page=n` (from 错题跟进 / a formula sheet link) shows that page's chunks first.
  const [searchParams, setSearchParams] = useSearchParams()
  const pageParam = Number(searchParams.get('page'))
  const pageFilter = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : null

  useEffect(() => {
    if (!did) return
    let cancelled = false
    setChunksLoading(true)
    setChunksError(null)
    new ChunkRepository(getDb())
      .listByDocument(did)
      .then((rows) => {
        if (cancelled) return
        setChunks(rows)
      })
      .catch((err) => {
        if (cancelled) return
        setChunksError((err as Error).message)
      })
      .finally(() => {
        if (cancelled) return
        setChunksLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Re-read once the file finishes (re)processing: its chunks changed.
  }, [did, document?.processedAt, document?.status])

  /** Chunk number by id: `indexOf` per row would be quadratic on a long book. */
  const chunkNumbers = useMemo(
    () => new Map(chunks.map((chunk, index) => [chunk.id, index + 1])),
    [chunks],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q && pageFilter !== null) {
      const onPage = chunks.filter((c) => c.pageNumber === pageFilter)
      if (onPage.length > 0) return onPage
    }
    if (!q) return chunks
    return chunks.filter(
      (c) => c.text.toLowerCase().includes(q) || c.sourceReference.toLowerCase().includes(q),
    )
  }, [chunks, search, pageFilter])

  if (!projectId) return <div />

  if (status === 'loading') {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('documentDetail.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (status === 'error') {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('documentDetail.loadFailed')}
            description={error ?? t('documentDetail.loadFailedHint')}
            action={
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => void refresh()}>
                  {t('common.tryAgain')}
                </Button>
                <Button asChild>
                  <Link to={`/projects/${projectId}`}>
                    <ArrowLeft className="h-4 w-4" />
                    {t('documentDetail.backToLibrary')}
                  </Link>
                </Button>
              </div>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  if (status === 'not-found' || !document) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('documentDetail.notFound')}
            description={t('documentDetail.notFoundHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}`}>
                  <ArrowLeft className="h-4 w-4" />
                  {t('documentDetail.backToLibrary')}
                </Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  async function requestDelete() {
    if (!document || !projectId) return
    setCheckingDelete(true)
    try {
      setImpact(await describeDelete(document.id, projectId))
      setDeleteOpen(true)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documentDetail.deleteFailed'),
        description: (err as Error).message,
      })
    } finally {
      setCheckingDelete(false)
    }
  }

  async function handleDelete() {
    if (!document || !projectId) return
    setDeleting(true)
    try {
      // Goes through DocumentService.delete: refuses files holding student
      // work, cleans up derived homework / practice / slide data, unlinks
      // answer keys, marks the course analysis stale and refreshes the store.
      await removeDocument(document.id, projectId)
      setDeleteOpen(false)
      toast({ variant: 'success', title: t('documentDetail.deleted'), description: document.name })
      navigate(`/projects/${projectId}`, { replace: true })
    } catch (err) {
      setDeleteOpen(false)
      toast({
        variant: 'error',
        title: t('documentDetail.deleteFailed'),
        description: (err as Error).message,
      })
    } finally {
      setDeleting(false)
    }
  }

  const blockedWork = impact
    ? [
        impact.studentWork.homeworkAnswers > 0 && t('files.deleteBlockedHomework'),
        impact.studentWork.practiceAttempts > 0 && t('files.deleteBlockedPractice'),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('documentDetail.back')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <TruncatedText text={document.name} className="min-w-0 max-w-full" />
            <Badge variant="outline">{document.type.toUpperCase()}</Badge>
            <Badge
              variant={
                document.status === 'ready'
                  ? 'default'
                  : document.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {t(PROCESSING_STATUS_LABEL_KEYS[document.status])}
            </Badge>
          </div>
        }
        description={t('documentDetail.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="home" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* 留作检验: an independent document never reaches the AI as course context. */}
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('evalRole.label')}</span>
              <select
                value={resolveEvalRole(document.evalRole) ?? ''}
                title={
                  resolveEvalRole(document.evalRole)
                    ? t(EVAL_ROLE_HINT_KEYS[resolveEvalRole(document.evalRole)!])
                    : t('evalRole.noneHint')
                }
                onChange={(event) =>
                  void new HomeworkProofreadService()
                    .setDocumentEvalRole(document.id, resolveEvalRole(event.target.value))
                    .then(() => refresh())
                }
                className="focus-ring h-11 rounded-lg border border-input bg-background px-2 text-sm lab:rounded-sm"
              >
                <option value="">{t('evalRole.none')}</option>
                {EVAL_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(EVAL_ROLE_LABEL_KEYS[role])}
                  </option>
                ))}
              </select>
            </label>
            {document.status === 'ready' && (
              <VisionTranscribeButton
                documentId={document.id}
                refreshKey={document.processedAt}
                onDone={() => void refresh()}
              />
            )}
            <Button
              variant="destructive"
              onClick={() => void requestDelete()}
              disabled={checkingDelete}
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </Button>
          </div>
        }
      />
      <PageContent>
        <Tabs defaultValue="chunks">
          <TabsList>
            <TabsTrigger value="chunks">{t('documentDetail.tab.chunks')}</TabsTrigger>
            <TabsTrigger value="overview">{t('documentDetail.tab.overview')}</TabsTrigger>
            <TabsTrigger value="metadata">{t('documentDetail.tab.metadata')}</TabsTrigger>
          </TabsList>

          <TabsContent value="chunks" className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('documentDetail.searchChunks')}
                  className="pl-9"
                />
              </div>
              <Badge variant="outline" className="data-num lab:font-mono">
                {filtered.length} / {chunks.length}
              </Badge>
            </div>

            {pageFilter !== null && !search.trim() && filtered.length < chunks.length && (
              <div className="flex flex-wrap items-center gap-2 text-sm" data-page-filter>
                <span>{t('documentDetail.pageFilter', { page: pageFilter })}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev)
                        next.delete('page')
                        return next
                      },
                      { replace: true },
                    )
                  }
                >
                  {t('documentDetail.showAllPages')}
                </Button>
              </div>
            )}

            {chunksError && (
              <ErrorState title={t('documentDetail.chunksFailed')} description={chunksError} />
            )}

            {!chunksLoading && chunks.length === 0 && (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title={t('documentDetail.noChunks')}
                description={
                  document.status === 'failed'
                    ? t('documentDetail.processingFailed')
                    : t('documentDetail.notProcessed')
                }
              />
            )}

            {chunksLoading ? (
              <LoadingState label={t('documentDetail.loadingChunks')} />
            ) : (
              <ProgressiveList
                items={filtered}
                pageSize={30}
                className="space-y-2"
                renderItem={(chunk) => (
                  <ChunkPreview
                    key={chunk.id}
                    chunk={chunk}
                    documentName={document.name}
                    index={chunkNumbers.get(chunk.id) ?? 0}
                    documentHref={`/projects/${projectId}/documents/${document.id}`}
                  />
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>{t('documentDetail.summary')}</CardTitle>
                <CardDescription>{t('documentDetail.summaryHint')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Meta
                  icon={<Layers className="h-4 w-4" />}
                  label={t('documentDetail.type')}
                  value={document.type.toUpperCase()}
                />
                <Meta
                  icon={<Hash className="h-4 w-4" />}
                  label={t('documentDetail.chunks')}
                  value={String(chunks.length)}
                />
                <Meta
                  icon={<FileText className="h-4 w-4" />}
                  label={t('documentDetail.textLength')}
                  value={
                    document.textLength
                      ? t('documentDetail.chars', { count: document.textLength.toLocaleString() })
                      : '—'
                  }
                />
                <Meta
                  icon={<Calendar className="h-4 w-4" />}
                  label={t('documentDetail.uploaded')}
                  value={formatDate(document.uploadedAt)}
                />
                {document.processedAt && (
                  <Meta
                    icon={<Calendar className="h-4 w-4" />}
                    label={t('documentDetail.processed')}
                    value={formatDateTime(document.processedAt)}
                  />
                )}
              </CardContent>
              {document.warnings.length > 0 && (
                <CardContent className="pt-0">
                  <div className="rounded-lg border border-amber-500/30 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/30">
                    <div className="mb-1 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4" />
                      {t('documentDetail.warnings', { count: document.warnings.length })}
                    </div>
                    <ul className="ml-6 list-disc text-amber-700 dark:text-amber-200/90">
                      {document.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              )}
              {document.errorMessage && (
                <CardContent className="pt-0">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {document.errorMessage}
                  </div>
                </CardContent>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="metadata">
            <Card>
              <CardHeader>
                <CardTitle>{t('documentDetail.metadata')}</CardTitle>
                <CardDescription>{t('documentDetail.metadataHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Meta
                  icon={<FileText className="h-4 w-4" />}
                  label={t('documentDetail.fileSize')}
                  value={formatBytes(document.sizeBytes)}
                />
                {document.mimeType && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.mimeType')}
                    value={document.mimeType}
                  />
                )}
                {document.metadata.title && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.fileTitle')}
                    value={document.metadata.title}
                  />
                )}
                {document.metadata.author && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.author')}
                    value={document.metadata.author}
                  />
                )}
                {document.metadata.subject && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.subject')}
                    value={document.metadata.subject}
                  />
                )}
                {document.metadata.producer && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.producer')}
                    value={document.metadata.producer}
                  />
                )}
                {document.metadata.creator && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.creator')}
                    value={document.metadata.creator}
                  />
                )}
                {document.metadata.pageCount !== undefined && (
                  <Meta
                    icon={<Hash className="h-4 w-4" />}
                    label={t('documentDetail.pages')}
                    value={String(document.metadata.pageCount)}
                  />
                )}
                {document.metadata.slideCount !== undefined && (
                  <Meta
                    icon={<Hash className="h-4 w-4" />}
                    label={t('documentDetail.slides')}
                    value={String(document.metadata.slideCount)}
                  />
                )}
                {document.metadata.language && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.language')}
                    value={document.metadata.language}
                  />
                )}
                {document.metadata.ocrConfidence !== undefined && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.ocrConfidence')}
                    value={`${document.metadata.ocrConfidence.toFixed(1)}%`}
                  />
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  {t('documentDetail.lastActivity', { time: relativeTime(document.uploadedAt) })}
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>

      <Dialog open={deleteOpen && Boolean(impact?.blocked)} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.deleteBlockedTitle')}</DialogTitle>
            <DialogDescription>{t('files.deleteIntro', { name: document.name })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('files.deleteBlockedBody', { work: blockedWork })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen && impact !== null && !impact.blocked}
        onOpenChange={setDeleteOpen}
        title={t('documentDetail.deleteTitle')}
        description={t('documentDetail.deleteBody')}
        variant="destructive"
        confirmLabel={t('documents.deleteAction')}
        busy={deleting}
        onConfirm={handleDelete}
        details={
          <dl className="space-y-1.5">
            <DetailRow label={t('documentDetail.detail.document')} value={document.name} />
            <DetailRow
              label={t('documentDetail.detail.type')}
              value={document.type.toUpperCase()}
            />
            <DetailRow
              label={t('documentDetail.detail.size')}
              value={formatBytes(document.sizeBytes)}
            />
            <DetailRow
              label={t('documentDetail.detail.project')}
              value={project?.name ?? projectId ?? '—'}
            />
            <DetailRow
              label={t('documentDetail.detail.chunks')}
              value={t('documentDetail.detail.chunksWillDelete', {
                count: impact?.removes.chunks ?? chunks.length,
              })}
            />
          </dl>
        }
      />
    </PageContainer>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-muted-foreground">
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted lecture:hidden lab:border lab:border-border lab:bg-transparent"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col lecture:w-full lecture:border-b lecture:border-border lecture:pb-2">
        <span className="text-xs lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-[0.06em]">
          {label}
        </span>
        <TruncatedText
          text={value}
          className="data-num text-sm font-medium text-foreground lab:font-mono"
        />
      </div>
    </div>
  )
}
