import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, GraduationCap, Pencil } from 'lucide-react'
import { useProject, useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { SectionHeading } from '@/shared/ui/Section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { ProjectDocumentsTab } from '@/widgets/documents/ProjectDocumentsTab'
import { CourseAnalysisPanel } from '@/widgets/documentAnalysis/CourseAnalysisPanel'
import { RenameProjectDialog } from '@/widgets/project/RenameProjectDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
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
  // The open tab lives in the URL (`?tab=analysis`), so links can point at it
  // and a reload or Back keeps the student where they were.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'analysis' ? 'analysis' : 'documents'

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
        <div className="relative z-10 px-4 pb-4 pt-6 sm:px-6 lg:px-8">
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
                  <GraduationCap className="h-4 w-4" />
                  {t('projectDetail.openTutor')}
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil className="h-4 w-4" />
                {t('common.edit')}
              </Button>
            </div>
          </div>
          {/* Same course map as every other course page. */}
          <ProjectFlowNav projectId={project.id} active="home" className="-mx-1 mt-5" />
        </div>
      </header>
      <PageContent>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setSearchParams(value === 'analysis' ? { tab: 'analysis' } : {}, { replace: true })
          }
        >
          <TabsList>
            <TabsTrigger value="documents">{t('projectDetail.tab.documents')}</TabsTrigger>
            <TabsTrigger value="analysis">{t('projectDetail.tab.analysis')}</TabsTrigger>
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
              onStartTutor={(topicId) => navigate(`/projects/${project.id}/tutor/${topicId}`)}
            />
          </TabsContent>
        </Tabs>
      </PageContent>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        project={project}
        onRename={handleRename}
        onChangeSubject={(subject) => update({ subject })}
      />
    </PageContainer>
  )
}
