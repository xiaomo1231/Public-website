import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ClipboardList, Loader2, RotateCcw, Upload } from 'lucide-react'
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
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

const STATUS_VARIANT = {
  analyzing: 'secondary',
  ready: 'default',
  failed: 'destructive',
} as const

/**
 * Homework hub: upload an assignment, watch the AI read its questions, and open
 * a walkthrough. Analysis runs once per document (a set is only created when
 * none exists), so revisiting never re-runs the AI.
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
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef<Set<string>>(new Set())

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

  // Analyse each ready homework document that has no set yet — once per page.
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

  async function retry(set: HomeworkSet): Promise<void> {
    if (!service) return
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
  }

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
              <Card className="blueprint-frame border-border/70">
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
                {sets.map((set) => (
                  <li key={set.id}>
                    <Card className="flex h-full flex-col">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="min-w-0 text-base">
                            <TruncatedText text={set.title} className="min-w-0 max-w-full" />
                          </CardTitle>
                          <Badge variant={STATUS_VARIANT[set.status]}>
                            {t(HOMEWORK_STATUS_LABEL_KEYS[set.status])}
                          </Badge>
                        </div>
                        <CardDescription>
                          {set.status === 'ready'
                            ? t('homework.questionsCount', { count: set.questionCount })
                            : relativeTime(set.updatedAt)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="mt-auto space-y-3">
                        {set.status === 'failed' && set.errorMessage && (
                          <p className="text-xs text-muted-foreground">{set.errorMessage}</p>
                        )}
                        {set.status === 'failed' ? (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => void retry(set)}
                            disabled={busyDocumentId === set.documentId}
                          >
                            {busyDocumentId === set.documentId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            {t('homework.retryAnalyze')}
                          </Button>
                        ) : set.status === 'analyzing' ? (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            {t('homework.analyzing')}
                          </p>
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
                ))}

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
                        <CardContent className="mt-auto">
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            {(busyDocumentId === doc.id ||
                              doc.status === 'processing' ||
                              doc.status === 'uploading') && (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            )}
                            {doc.status === 'failed' ? t('homework.noContent') : doc.status === 'ready' ? t('homework.analyzing') : t('homework.analyzingHint')}
                          </p>
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
    </PageContainer>
  )
}
