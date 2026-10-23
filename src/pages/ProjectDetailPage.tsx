import { DueRetestsLink } from '@/widgets/mistakes/RetestSession'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, GraduationCap, Pencil } from 'lucide-react'
import { useProject, useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { Button } from '@/shared/ui/Button'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { SectionHeading } from '@/shared/ui/Section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { ProjectDocumentsTab } from '@/widgets/documents/ProjectDocumentsTab'
import { CourseAnalysisPanel } from '@/widgets/documentAnalysis/CourseAnalysisPanel'
import { RenameProjectDialog } from '@/widgets/project/RenameProjectDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { CourseFigures } from '@/widgets/project/CourseFigures'
import { ExamTopicsPanel } from '@/widgets/syllabus/ExamTopicsPanel'
import { QuestionHabitsPanel } from '@/widgets/questionHabits/QuestionHabitsPanel'
import { GradingRulesPanel } from '@/widgets/project/GradingRulesPanel'
import { CourseLanguagePanel } from '@/widgets/project/CourseLanguagePanel'
import { CoursePlanPanel } from '@/widgets/studyPlan/CoursePlanPanel'
import { CourseExamsPanel } from '@/widgets/examWorkspace/CourseExamsPanel'
import { useCourseMastery } from '@/widgets/dashboard/useCourseMastery'
import { useHomeOverview } from '@/features/home/useHomeOverview'
import { useDocumentsStore } from '@/features/documents/documentsStore'
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
  const tabParam = searchParams.get('tab')
  const tab =
    tabParam === 'analysis' ||
    tabParam === 'exams' ||
    tabParam === 'habits' ||
    tabParam === 'plan' ||
    tabParam === 'exam-list'
      ? tabParam
      : 'documents'
  // Read-only course summary (same counts as the homepage) and the mastery
  // estimate; neither triggers analysis or AI.
  const projectList = useMemo(() => (project ? [project] : []), [project])
  const { overview, refresh: refreshOverview } = useHomeOverview(
    projectList,
    projectList.length > 0,
  )
  const course = overview?.courses.find((c) => c.project.id === project?.id)
  // Keep the figures and the "continue reading" link current while the
  // student works on this page: uploads and processing update the documents
  // store; the course analysis that follows has no event, so poll briefly
  // after a document change and for as long as anything is still running.
  const projectDocs = useDocumentsStore((s) => (project ? s.byProject[project.id] : undefined))
  const [watchUntil, setWatchUntil] = useState(0)
  useEffect(() => {
    if (!projectDocs) return
    refreshOverview()
    setWatchUntil(Date.now() + 60_000)
  }, [projectDocs, refreshOverview])
  const busy =
    course !== undefined &&
    (course.materials.processing > 0 ||
      course.analysis === 'pending' ||
      course.analysis === 'analyzing')
  useEffect(() => {
    if (!busy && Date.now() >= watchUntil) return
    const timer = window.setTimeout(refreshOverview, 4000)
    return () => window.clearTimeout(timer)
  }, [busy, watchUntil, overview, refreshOverview])
  const shownTab = useRef(tab)
  useEffect(() => {
    if (shownTab.current === tab) return
    shownTab.current = tab
    refreshOverview()
  }, [tab, refreshOverview])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshOverview()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshOverview])
  const masteryIds = useMemo(() => (project ? [project.id] : []), [project])
  const mastery = useCourseMastery(masteryIds)

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
      {/* Course home: a "cover" in lecture (kicker, serif title, byline), a
          compact title block in lab — PageHeader carries both looks. */}
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link
              to="/projects"
              aria-label={t('projectDetail.backToProjects')}
              className="focus-ring -ml-1 grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground lab:rounded-md coarse:h-11 coarse:w-11"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            {t(SUBJECT_LABEL_KEYS[project.subject])}
          </span>
        }
        title={project.name}
        description={
          <>
            <span className="block">{project.description || t('projectDetail.subtitle')}</span>
            <span className="data-num mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground lab:font-mono lab:text-[11px]">
              <span>
                {t('projectDetail.about.created')}: {formatDate(project.createdAt)}
              </span>
              <span>
                {t('projectDetail.about.lastUpdated')}: {formatDateTime(project.updatedAt)}
              </span>
            </span>
          </>
        }
        actions={
          <>
            {course?.nextStep.kind === 'tutor' &&
            course.nextStep.topicId &&
            course.nextStep.topicName ? (
              <Button asChild className="min-w-0 max-w-full">
                <Link
                  to={`/projects/${project.id}/tutor/${course.nextStep.topicId}`}
                  title={t('projectDetail.continueReading', { topic: course.nextStep.topicName })}
                >
                  <GraduationCap className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 max-w-[22rem] truncate">
                    {t('projectDetail.continueReading', { topic: course.nextStep.topicName })}
                  </span>
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to={`/projects/${project.id}/tutor`}>
                  <GraduationCap className="h-4 w-4" />
                  {t('projectDetail.openTutor')}
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setRenameOpen(true)}>
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </Button>
          </>
        }
        nav={<ProjectFlowNav projectId={project.id} active="home" />}
        className="lecture:pb-6"
      />
      <PageContent className="space-y-8 lecture:pt-2">
        {course && <CourseFigures course={course} mastery={mastery[project.id]} />}
        <DueRetestsLink projectId={project.id} />
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setSearchParams(value === 'documents' ? {} : { tab: value }, { replace: true })
          }
        >
          <TabsList>
            <TabsTrigger value="documents">{t('projectDetail.tab.documents')}</TabsTrigger>
            <TabsTrigger value="analysis">{t('projectDetail.tab.analysis')}</TabsTrigger>
            <TabsTrigger value="exams">{t('projectDetail.tab.exams')}</TabsTrigger>
            <TabsTrigger value="habits">{t('projectDetail.tab.habits')}</TabsTrigger>
            <TabsTrigger value="plan">{t('projectDetail.tab.plan')}</TabsTrigger>
            <TabsTrigger value="exam-list">{t('examWorkspace.courseTab')}</TabsTrigger>
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

          <TabsContent value="exams">
            <ExamTopicsPanel projectId={project.id} />
          </TabsContent>

          <TabsContent value="plan">
            <CoursePlanPanel projectId={project.id} />
          </TabsContent>

          <TabsContent value="exam-list">
            <CourseExamsPanel projectId={project.id} />
          </TabsContent>

          <TabsContent value="habits" className="space-y-10">
            <QuestionHabitsPanel projectId={project.id} />
            <GradingRulesPanel
              project={project}
              onSave={(sigFigPolicy) => update({ sigFigPolicy })}
            />
            <CourseLanguagePanel projectId={project.id} />
          </TabsContent>
        </Tabs>
      </PageContent>

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        project={project}
        onRename={handleRename}
        onChangeSubject={(subject, details) => update({ subject, ...details })}
      />
    </PageContainer>
  )
}
