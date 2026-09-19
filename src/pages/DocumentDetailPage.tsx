import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { DocumentRepository } from '@/entities/document/repository'
import { getDb } from '@/infrastructure/db/database'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProgressiveList } from '@/shared/ui/ProgressiveList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { ChunkPreview } from '@/widgets/documents/ChunkPreview'
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [chunks, setChunks] = useState<DocumentChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(true)
  const [chunksError, setChunksError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

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
  }, [did])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return chunks
    return chunks.filter((c) => c.text.toLowerCase().includes(q) || c.sourceReference.toLowerCase().includes(q))
  }, [chunks, search])

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
                  <Link to={`/projects/${projectId}/documents`}>
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
                <Link to={`/projects/${projectId}/documents`}>
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

  async function handleDelete() {
    if (!document || !projectId) return
    setDeleting(true)
    try {
      await new DocumentRepository(getDb()).delete(document.id)
      setDeleteOpen(false)
      toast({ variant: 'success', title: t('documentDetail.deleted'), description: document.name })
      navigate(`/projects/${projectId}/documents`, { replace: true })
    } catch (err) {
      toast({ variant: 'error', title: t('documentDetail.deleteFailed'), description: (err as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('documentDetail.back')}>
              <Link to={`/projects/${projectId}/documents`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <TruncatedText text={document.name} className="min-w-0 max-w-full" />
            <Badge variant="outline">{document.type.toUpperCase()}</Badge>
            <Badge variant={document.status === 'ready' ? 'default' : document.status === 'failed' ? 'destructive' : 'secondary'}>
              {t(PROCESSING_STATUS_LABEL_KEYS[document.status])}
            </Badge>
          </div>
        }
        description={t('documentDetail.subtitle')}
        actions={
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>
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
              <Badge variant="outline">{filtered.length} / {chunks.length}</Badge>
            </div>

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
                    index={chunks.indexOf(chunk) + 1}
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
                <Meta icon={<Layers className="h-4 w-4" />} label={t('documentDetail.type')} value={document.type.toUpperCase()} />
                <Meta icon={<Hash className="h-4 w-4" />} label={t('documentDetail.chunks')} value={String(chunks.length)} />
                <Meta
                  icon={<FileText className="h-4 w-4" />}
                  label={t('documentDetail.textLength')}
                  value={document.textLength ? t('documentDetail.chars', { count: document.textLength.toLocaleString() }) : '—'}
                />
                <Meta icon={<Calendar className="h-4 w-4" />} label={t('documentDetail.uploaded')} value={formatDate(document.uploadedAt)} />
                {document.processedAt && (
                  <Meta icon={<Calendar className="h-4 w-4" />} label={t('documentDetail.processed')} value={formatDateTime(document.processedAt)} />
                )}
              </CardContent>
              {document.warnings.length > 0 && (
                <CardContent className="pt-0">
                  <div className="rounded-md border border-amber-500/30 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/30">
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
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
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
                <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.fileSize')} value={formatBytes(document.sizeBytes)} />
                {document.mimeType && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.mimeType')} value={document.mimeType} />}
                {document.metadata.title && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.fileTitle')} value={document.metadata.title} />}
                {document.metadata.author && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.author')} value={document.metadata.author} />}
                {document.metadata.subject && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.subject')} value={document.metadata.subject} />}
                {document.metadata.producer && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.producer')} value={document.metadata.producer} />}
                {document.metadata.creator && <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.creator')} value={document.metadata.creator} />}
                {document.metadata.pageCount !== undefined && (
                  <Meta icon={<Hash className="h-4 w-4" />} label={t('documentDetail.pages')} value={String(document.metadata.pageCount)} />
                )}
                {document.metadata.slideCount !== undefined && (
                  <Meta icon={<Hash className="h-4 w-4" />} label={t('documentDetail.slides')} value={String(document.metadata.slideCount)} />
                )}
                {document.metadata.language && (
                  <Meta icon={<FileText className="h-4 w-4" />} label={t('documentDetail.language')} value={document.metadata.language} />
                )}
                {document.metadata.ocrConfidence !== undefined && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label={t('documentDetail.ocrConfidence')}
                    value={`${document.metadata.ocrConfidence.toFixed(1)}%`}
                  />
                )}
                <p className="mt-4 text-xs text-muted-foreground">{t('documentDetail.lastActivity', { time: relativeTime(document.uploadedAt) })}</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>

      <ConfirmDialog
        open={deleteOpen}
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
            <DetailRow label={t('documentDetail.detail.type')} value={document.type.toUpperCase()} />
            <DetailRow label={t('documentDetail.detail.size')} value={formatBytes(document.sizeBytes)} />
            <DetailRow label={t('documentDetail.detail.project')} value={project?.name ?? projectId ?? '—'} />
            <DetailRow
              label={t('documentDetail.detail.chunks')}
              value={t('documentDetail.detail.chunksWillDelete', { count: chunks.length })}
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
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted">{icon}</span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        <TruncatedText text={value} className="text-sm font-medium text-foreground" />
      </div>
    </div>
  )
}
