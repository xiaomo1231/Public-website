import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookX,
  Brain,
  Calendar,
  ClipboardList,
  FileText,
  History,
  Layers,
  ListChecks,
  Pencil,
  Sparkles,
} from 'lucide-react'
import { useProject, useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { SectionHeading } from '@/shared/ui/Section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TruncatedText } from '@/shared/ui/TruncatedText'
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
      {/* Course workspace banner: project identity is the page's focal point. */}
      <header className="relative isolate overflow-hidden border-b border-border/70 bg-card">
        <div aria-hidden className="tech-grid" />
        <div className="relative z-10 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label={t('projectDetail.backToProjects')}
              >
                <Link to="/projects">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 max-w-full break-words text-[26px] font-semibold leading-tight tracking-[-0.01em] text-foreground sm:text-[32px]">
                  <TruncatedText text={project.name} className="min-w-0 max-w-full" />
                </h1>
                <Badge variant="outline">{t(SUBJECT_LABEL_KEYS[project.subject])}</Badge>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-[15px]">
                {project.description || t('projectDetail.subtitle')}
              </p>
              <div className="tick-rule max-w-[15rem]" aria-hidden />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t('projectDetail.about.created')}: {formatDate(project.createdAt)}
                </span>
                <span>
                  {t('projectDetail.about.lastUpdated')}: {formatDateTime(project.updatedAt)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button asChild>
                <Link to={`/projects/${project.id}/tutor`}>
                  <Sparkles className="h-4 w-4" />
                  {t('projectDetail.openTutor')}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/projects/${project.id}/history`}>
                  <History className="h-4 w-4" />
                  {t('projectDetail.card.chatHistory')}
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil className="h-4 w-4" />
                {t('common.rename')}
              </Button>
            </div>
          </div>
        </div>
      </header>
      <PageContent>
        <CoursePath projectId={project.id} />
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

          <TabsContent value="analysis" className="space-y-5">
            <SectionHeading
              title={t('projectDetail.analysis.title')}
              description={t('projectDetail.analysis.description')}
            />
            <CourseAnalysisPanel
              projectId={project.id}
              subject={t(SUBJECT_LABEL_KEYS[project.subject])}
              onStartTutor={(topicId) => navigate(`/projects/${project.id}/tutor/${topicId}`)}
            />
          </TabsContent>

          <TabsContent value="quiz" className="space-y-4">
            <SectionHeading
              title={t('projectDetail.quizzes.title')}
              description={t('projectDetail.quizzes.description')}
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/quiz`}>{t('projectDetail.quizzes.open')}</Link>
                </Button>
              }
            />
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
            <SectionHeading
              title={t('projectDetail.mistakes.title')}
              description={t('projectDetail.mistakes.description')}
              action={
                <Button asChild>
                  <Link to={`/projects/${project.id}/mistakes`}>
                    {t('projectDetail.mistakes.open')}
                  </Link>
                </Button>
              }
            />
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
            <SectionHeading
              title={t('projectDetail.tab.overview')}
              description={t('projectDetail.about.description')}
            />
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

              <Card variant="accent">
                <CardHeader>
                  <CardTitle>{t('projectDetail.upcoming.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <EmptyState
                    className="border-0 bg-transparent p-0"
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

/**
 * The course's learning path, stated once on the course home: read, then move
 * into the tutor, quiz, mistake book and mastery. Reuses the same destination
 * names as the course navigation so the wording stays consistent everywhere.
 */
function CoursePath({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const steps = [
    { key: 'tutor', labelKey: 'projectNav.tutor' as const, icon: Sparkles, to: `/projects/${projectId}/tutor` },
    { key: 'homework', labelKey: 'projectNav.homework' as const, icon: ClipboardList, to: `/projects/${projectId}/homework` },
    { key: 'quiz', labelKey: 'projectNav.quiz' as const, icon: ListChecks, to: `/projects/${projectId}/quiz` },
    { key: 'mistakes', labelKey: 'projectNav.mistakes' as const, icon: BookX, to: `/projects/${projectId}/mistakes` },
    { key: 'mastery', labelKey: 'projectNav.mastery' as const, icon: Brain, to: `/projects/${projectId}/mastery` },
  ]

  return (
    <div className="blueprint-frame mb-5 rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="label-mono">{t('projectDetail.path.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('projectDetail.path.hint')}</p>
        </div>
        <ol className="flex shrink-0 flex-wrap items-center gap-1.5">
          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <li key={step.key}>
                <Button asChild variant={index === 0 ? 'default' : 'outline'} size="sm">
                  <Link to={step.to}>
                    <Icon className="h-4 w-4" />
                    {t(step.labelKey)}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
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
