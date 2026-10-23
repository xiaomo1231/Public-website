import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { cn, formatDateTime } from '@/shared/lib/utils'
import { useExams, useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useExamWorkspace } from '@/features/studyPlan/useExamWorkspace'
import { examWorkspacePath } from '@/features/studyPlan/examReturn'
import { useProjects } from '@/features/project/useProjects'
import { toast } from '@/features/toast/toastStore'
import { countdownParts, countdownUrgency } from '@/entities/studyPlan/countdown'
import { SavedExamEditor } from '@/widgets/studyPlan/ExamSetup'
import { scopeLabel } from '@/widgets/studyPlan/scopeLabels'
import { ExamReviewContent } from '@/widgets/studyPlan/ExamReviewContent'
import { OverviewTab } from '@/widgets/examWorkspace/OverviewTab'
import { MaterialsTab } from '@/widgets/examWorkspace/MaterialsTab'
import { PapersTab } from '@/widgets/examWorkspace/PapersTab'
import { TimelineTab } from '@/widgets/examWorkspace/TimelineTab'
import { MistakesTab } from '@/widgets/examWorkspace/MistakesTab'
import { useTranslation } from '@/i18n'

const WORKSPACE_TABS = [
  'overview',
  'materials',
  'papers',
  'review',
  'timeline',
  'mistakes',
] as const
type WorkspaceTab = (typeof WORKSPACE_TABS)[number]

/**
 * 考试工作台 (`/plan/exams/:examId`): one exam's page — readiness, its files,
 * its past papers and AI mock papers, the 复习提纲, its tasks by day and the
 * mistakes / mastery in its scope. The data is the same as on the course
 * pages (nothing copied); links to the other features are pre-filled with the
 * exam, and focus pages opened from here lead back here.
 */
export function ExamWorkspacePage(): JSX.Element {
  const { t } = useTranslation()
  const { examId = '' } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: WorkspaceTab = WORKSPACE_TABS.includes(raw as WorkspaceTab)
    ? (raw as WorkspaceTab)
    : 'overview'
  const { view, missing, error, refresh } = useExamWorkspace(examId)
  const service = useStudyPlanService()
  const { exams } = useExams()
  const { projects } = useProjects()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const courseName = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const switchable = useMemo(() => [...exams].sort((a, b) => a.at - b.at), [exams])

  const setTab = (next: string) =>
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true })

  if (missing)
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('examWorkspace.missing')}
            description={t('examWorkspace.missingHint')}
            action={
              <Button asChild>
                <Link to="/plan?tab=exams">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  {t('examWorkspace.backToPlan')}
                </Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  if (error && !view)
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('examWorkspace.loadFailed')}
            description={error}
            action={
              <Button variant="outline" onClick={refresh}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  if (!view)
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('common.loading')} />
        </PageContent>
      </PageContainer>
    )

  const { exam, project } = view.context
  const now = Date.now()
  const left = countdownParts(now, exam.at)
  const urgency = countdownUrgency(now, exam.at)
  const leftLabel = left.past
    ? t('plan.exams.past')
    : left.days > 0
      ? t('plan.countdown.daysHours', { days: left.days, hours: left.hours })
      : t('plan.countdown.hoursMinutes', { hours: left.hours, minutes: left.minutes })

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 px-4 pb-3 pt-4 sm:px-6 lg:px-8" data-exam-workspace>
        <nav aria-label={t('examWorkspace.breadcrumb')} className="text-sm">
          <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
            <li>
              <Link
                to="/plan?tab=exams"
                className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 transition-colors hover:text-foreground lecture:rounded-none lab:rounded-sm"
                data-workspace-back
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t('plan.title')}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="min-w-0 truncate text-foreground">
              {exam.name} · {project.name}
            </li>
          </ol>
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h1 className="break-words font-heading text-[26px] font-semibold leading-tight tracking-tight lecture:font-bold lab:text-[22px]">
              {exam.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Link
                to={`/projects/${project.id}`}
                className="focus-ring rounded-sm hover:text-foreground hover:underline"
              >
                {project.name}
              </Link>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatDateTime(exam.at)}</span>
              {exam.location && (
                <>
                  <span aria-hidden>·</span>
                  <span>{exam.location}</span>
                </>
              )}
              {exam.durationMinutes ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('plan.exams.duration', { minutes: exam.durationMinutes })}</span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{scopeLabel(exam.scope, t)}</span>
            </p>
            <p
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-sm tabular-nums lab:rounded-sm lab:font-mono',
                urgency === 'final'
                  ? 'bg-destructive/15 font-semibold text-destructive'
                  : urgency === 'near'
                    ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                    : 'bg-muted text-foreground',
              )}
              data-workspace-countdown={urgency}
            >
              {leftLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {switchable.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">{t('examWorkspace.switch')}</span>
                <select
                  value={exam.id}
                  onChange={(event) =>
                    navigate(
                      examWorkspacePath(event.target.value, tab === 'overview' ? undefined : tab),
                    )
                  }
                  className="focus-ring h-10 max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm lab:rounded-sm coarse:h-11"
                  data-exam-switcher
                >
                  {switchable.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name} · {courseName.get(each.projectId) ?? ''}
                      {each.at < now ? ` (${t('plan.exams.past')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-expanded={editing}
              onClick={() => setEditing((open) => !open)}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {t('plan.exams.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('plan.exams.delete', { name: exam.name })}
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
        {editing && (
          <div className="rounded-md border p-3 lab:rounded-none">
            <SavedExamEditor
              key={exam.updatedAt}
              exam={exam}
              courseName={project.name}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false)
                refresh()
              }}
            />
          </div>
        )}
      </header>
      <PageContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t('examWorkspace.tabsLabel')}>
            {WORKSPACE_TABS.map((each) => (
              <TabsTrigger key={each} value={each} data-workspace-tab={each}>
                {t(`examWorkspace.tab.${each}` as const)}
                {each === 'mistakes' && view.mistakesDue.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary">
                    {view.mistakesDue.length}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <OverviewTab view={view} onTab={setTab} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="materials" className="pt-4">
            <MaterialsTab view={view} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="papers" className="pt-4">
            <PapersTab view={view} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="review" className="pt-4">
            <ExamReviewContent projectId={project.id} examId={exam.id} embedded />
          </TabsContent>
          <TabsContent value="timeline" className="pt-4">
            <TimelineTab view={view} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="mistakes" className="pt-4">
            <MistakesTab view={view} onChanged={refresh} />
          </TabsContent>
        </Tabs>
      </PageContent>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('plan.exams.deleteTitle')}
        description={t('plan.exams.deleteHint', { name: exam.name })}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={async () => {
          try {
            await service.deleteExam(exam.id)
            await service.replan()
            setDeleting(false)
            toast({ variant: 'success', title: t('examWorkspace.deleted', { name: exam.name }) })
            navigate('/plan?tab=exams', { replace: true })
          } catch (err) {
            toast({
              variant: 'error',
              title: t('plan.errors.actionFailed'),
              description: err instanceof Error ? err.message : String(err),
            })
          }
        }}
      />
    </PageContainer>
  )
}
