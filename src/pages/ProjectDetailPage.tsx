import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookX, Brain, Calendar, FileText, History, Layers, ListChecks, Pencil, Sparkles } from 'lucide-react'
import { useProject, useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { ProjectDocumentsTab } from '@/widgets/documents/ProjectDocumentsTab'
import { CourseAnalysisPanel } from '@/widgets/documentAnalysis/CourseAnalysisPanel'
import { RenameProjectDialog } from '@/widgets/project/RenameProjectDialog'
import { toast } from '@/features/toast/toastStore'
import { formatDate, formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function ProjectDetailPage(): JSX.Element {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { project, loading, update } = useProject(id)
  const { loaded, loading: listLoading } = useProjects()
  const [renameOpen, setRenameOpen] = useState(false)

  useEffect(() => {
    if (loading || listLoading || !loaded) return
    if (!id) return
    if (!project) navigate('/projects', { replace: true })
  }, [id, project, loading, loaded, listLoading, navigate])

  if (loading || listLoading || !loaded) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('projectDetail.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (!project) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('projectDetail.notFound')}
            description={t('projectDetail.notFoundHint')}
            action={
              <Button asChild>
                <Link to="/projects">
                  <ArrowLeft className="h-4 w-4" />
                  {t('projectDetail.backToProjects')}
                </Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  async function handleRename(name: string) {
    await update({ name })
    toast({ variant: 'success', title: t('projectDetail.renamed'), description: name })
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('projectDetail.backToProjects')}>
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span>{project.name}</span>
            <Badge variant="outline">{t(SUBJECT_LABEL_KEYS[project.subject])}</Badge>
          </div>
        }
        description={project.description || t('projectDetail.subtitle')}
        actions={
          <Button variant="outline" onClick={() => setRenameOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('common.rename')}
          </Button>
        }
      />
      <PageContent>
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">{t('projectDetail.tab.documents')}</TabsTrigger>
            <TabsTrigger value="analysis">
              <Brain className="h-4 w-4" />
              {t('projectDetail.tab.analysis')}
            </TabsTrigger>
            <TabsTrigger value="overview">{t('projectDetail.tab.overview')}</TabsTrigger>
            <TabsTrigger value="quiz">
              <ListChecks className="h-4 w-4" />
              {t('projectDetail.tab.quiz')}
            </TabsTrigger>
            <TabsTrigger value="mistakes">
              <BookX className="h-4 w-4" />
              {t('projectDetail.tab.mistakes')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="documents">
            <ProjectDocumentsTab projectId={project.id} />
          </TabsContent>
          <TabsContent value="analysis" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4" />
                  {t('projectDetail.analysis.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('projectDetail.analysis.description')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/quiz`}>
                    <ListChecks className="h-4 w-4" />
                    {t('projectDetail.card.quiz')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/mistakes`}>
                    <BookX className="h-4 w-4" />
                    {t('projectDetail.card.mistakes')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/mastery`}>
                    <Brain className="h-4 w-4" />
                    {t('projectDetail.card.mastery')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/history`}>
                    <History className="h-4 w-4" />
                    {t('projectDetail.card.chatHistory')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/projects/${project.id}/tutor`}>
                    <Sparkles className="h-4 w-4" />
                    {t('projectDetail.openTutor')}
                  </Link>
                </Button>
              </div>
            </div>
            <CourseAnalysisPanel
              projectId={project.id}
              subject={t(SUBJECT_LABEL_KEYS[project.subject])}
              onStartTutor={(topicId) => navigate(`/projects/${project.id}/tutor/${topicId}`)}
            />
          </TabsContent>
          <TabsContent value="quiz" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <ListChecks className="h-4 w-4" />
                  {t('projectDetail.quizzes.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('projectDetail.quizzes.description')}
                </p>
              </div>
              <Button asChild>
                <Link to={`/projects/${project.id}/quiz`}>{t('projectDetail.quizzes.open')}</Link>
              </Button>
            </div>
            <EmptyState
              icon={<ListChecks className="h-8 w-8" />}
              title={t('projectDetail.quizzes.emptyTitle')}
              description={t('projectDetail.quizzes.emptyBody')}
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/quiz`}>
                    {t('projectDetail.quizzes.generate')}
                  </Link>
                </Button>
              }
            />
          </TabsContent>
          <TabsContent value="mistakes" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <BookX className="h-4 w-4" />
                  {t('projectDetail.mistakes.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('projectDetail.mistakes.description')}
                </p>
              </div>
              <Button asChild>
                <Link to={`/projects/${project.id}/mistakes`}>
                  {t('projectDetail.mistakes.open')}
                </Link>
              </Button>
            </div>
            <EmptyState
              icon={<BookX className="h-8 w-8" />}
              title={t('projectDetail.mistakes.emptyTitle')}
              description={t('projectDetail.mistakes.emptyBody')}
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/mistakes`}>
                    {t('projectDetail.mistakes.open')}
                  </Link>
                </Button>
              }
            />
          </TabsContent>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t('projectDetail.about.title')}</CardTitle>
                  <CardDescription>{t('projectDetail.about.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Meta
                    icon={<Layers className="h-4 w-4" />}
                    label={t('projectDetail.about.subject')}
                    value={t(SUBJECT_LABEL_KEYS[project.subject])}
                  />
                  <Meta
                    icon={<Calendar className="h-4 w-4" />}
                    label={t('projectDetail.about.created')}
                    value={formatDate(project.createdAt)}
                  />
                  <Meta
                    icon={<Calendar className="h-4 w-4" />}
                    label={t('projectDetail.about.lastUpdated')}
                    value={formatDateTime(project.updatedAt)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('projectDetail.upcoming.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <EmptyState
                    icon={<FileText className="h-6 w-6" />}
                    title={t('projectDetail.upcoming.uploadTitle')}
                    description={t('projectDetail.upcoming.uploadBody')}
                    action={
                      <Button asChild size="sm">
                        <Link to={`/projects/${project.id}`}>
                          {t('projectDetail.upcoming.goToDocuments')}
                        </Link>
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </PageContent>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        project={project}
        onRename={handleRename}
      />
    </PageContainer>
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