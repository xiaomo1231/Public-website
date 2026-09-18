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
import { formatDate, formatDateTime, relativeTime } from '@/shared/lib/utils'
import { formatBytes } from '@/shared/lib/format'

export function DocumentDetailPage(): JSX.Element {
  const { id: projectId, did } = useParams<{ id: string; did: string }>()
  const navigate = useNavigate()
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
          <LoadingState label="Loading document" />
        </PageContent>
      </PageContainer>
    )
  }

  if (status === 'error') {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title="Could not load document"
            description={error ?? 'Something went wrong while reading this document from local storage.'}
            action={
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => void refresh()}>
                  Try again
                </Button>
                <Button asChild>
                  <Link to={`/projects/${projectId}/documents`}>
                    <ArrowLeft className="h-4 w-4" />
                    Back to library
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
            title="Document not found"
            description="This document may have been deleted, or the link is wrong."
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/documents`}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to library
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
      toast({ variant: 'success', title: 'Document deleted', description: document.name })
      navigate(`/projects/${projectId}/documents`, { replace: true })
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: (err as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back">
              <Link to={`/projects/${projectId}/documents`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="truncate">{document.name}</span>
            <Badge variant="outline">{document.type.toUpperCase()}</Badge>
            <Badge variant={document.status === 'ready' ? 'default' : document.status === 'failed' ? 'destructive' : 'secondary'}>
              {document.status}
            </Badge>
          </div>
        }
        description="View parsed content, source references, and chunk preview."
        actions={
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        }
      />
      <PageContent>
        <Tabs defaultValue="chunks">
          <TabsList>
            <TabsTrigger value="chunks">Chunks</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
          </TabsList>

          <TabsContent value="chunks" className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search in chunks"
                  className="pl-9"
                />
              </div>
              <Badge variant="outline">{filtered.length} / {chunks.length}</Badge>
            </div>

            {chunksError && (
              <ErrorState title="Could not load chunks" description={chunksError} />
            )}

            {!chunksLoading && chunks.length === 0 && (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title="No chunks yet"
                description={
                  document.status === 'failed'
                    ? 'Processing failed. Re-upload to retry.'
                    : 'The document has not been processed yet.'
                }
              />
            )}

            {chunksLoading ? (
              <LoadingState label="Loading chunks" />
            ) : (
              <ProgressiveList
                items={filtered}
                pageSize={30}
                className="space-y-2"
                renderItem={(chunk) => <ChunkRow key={chunk.id} chunk={chunk} />}
              />
            )}
          </TabsContent>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>High-level information about this document.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Meta icon={<Layers className="h-4 w-4" />} label="Type" value={document.type.toUpperCase()} />
                <Meta icon={<Hash className="h-4 w-4" />} label="Chunks" value={String(chunks.length)} />
                <Meta
                  icon={<FileText className="h-4 w-4" />}
                  label="Text length"
                  value={document.textLength ? `${document.textLength.toLocaleString()} chars` : '—'}
                />
                <Meta icon={<Calendar className="h-4 w-4" />} label="Uploaded" value={formatDate(document.uploadedAt)} />
                {document.processedAt && (
                  <Meta icon={<Calendar className="h-4 w-4" />} label="Processed" value={formatDateTime(document.processedAt)} />
                )}
              </CardContent>
              {document.warnings.length > 0 && (
                <CardContent className="pt-0">
                  <div className="rounded-md border border-amber-500/30 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/30">
                    <div className="mb-1 flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4" />
                      Warnings ({document.warnings.length})
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
                <CardTitle>Metadata</CardTitle>
                <CardDescription>Information extracted from the file.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Meta icon={<FileText className="h-4 w-4" />} label="File size" value={formatBytes(document.sizeBytes)} />
                {document.mimeType && <Meta icon={<FileText className="h-4 w-4" />} label="MIME type" value={document.mimeType} />}
                {document.metadata.title && <Meta icon={<FileText className="h-4 w-4" />} label="Title" value={document.metadata.title} />}
                {document.metadata.author && <Meta icon={<FileText className="h-4 w-4" />} label="Author" value={document.metadata.author} />}
                {document.metadata.subject && <Meta icon={<FileText className="h-4 w-4" />} label="Subject" value={document.metadata.subject} />}
                {document.metadata.producer && <Meta icon={<FileText className="h-4 w-4" />} label="Producer" value={document.metadata.producer} />}
                {document.metadata.creator && <Meta icon={<FileText className="h-4 w-4" />} label="Creator" value={document.metadata.creator} />}
                {document.metadata.pageCount !== undefined && (
                  <Meta icon={<Hash className="h-4 w-4" />} label="Pages" value={String(document.metadata.pageCount)} />
                )}
                {document.metadata.slideCount !== undefined && (
                  <Meta icon={<Hash className="h-4 w-4" />} label="Slides" value={String(document.metadata.slideCount)} />
                )}
                {document.metadata.language && (
                  <Meta icon={<FileText className="h-4 w-4" />} label="Language" value={document.metadata.language} />
                )}
                {document.metadata.ocrConfidence !== undefined && (
                  <Meta
                    icon={<FileText className="h-4 w-4" />}
                    label="OCR confidence"
                    value={`${document.metadata.ocrConfidence.toFixed(1)}%`}
                  />
                )}
                <p className="mt-4 text-xs text-muted-foreground">Last activity {relativeTime(document.uploadedAt)}.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this document?"
        description="The original file and everything extracted from it are permanently removed from this device. This cannot be undone."
        variant="destructive"
        confirmLabel="Delete document"
        busy={deleting}
        onConfirm={handleDelete}
        details={
          <dl className="space-y-1.5">
            <DetailRow label="Document" value={document.name} />
            <DetailRow label="Type" value={document.type.toUpperCase()} />
            <DetailRow label="Size" value={formatBytes(document.sizeBytes)} />
            <DetailRow label="Project" value={project?.name ?? projectId ?? '—'} />
            <DetailRow
              label="Extracted chunks"
              value={`${chunks.length} chunk${chunks.length === 1 ? '' : 's'} will also be deleted`}
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

function ChunkRow({ chunk }: { chunk: DocumentChunk }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="uppercase">
              {chunk.contentType}
            </Badge>
            {chunk.pageNumber !== undefined && (
              <span className="text-xs text-muted-foreground">Page {chunk.pageNumber}</span>
            )}
            {chunk.section && <span className="text-xs text-muted-foreground">§ {chunk.section}</span>}
          </div>
          <p className="text-xs text-muted-foreground">{chunk.sourceReference}</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">#{chunk.order + 1}</span>
      </CardHeader>
      <CardContent className="pb-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{chunk.text}</p>
      </CardContent>
    </Card>
  )
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-muted">{icon}</span>
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        <span className="text-sm font-medium text-foreground">{value}</span>
      </div>
    </div>
  )
}