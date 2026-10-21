import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Loader2, Play, Sparkles, Stethoscope, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { InterviewRoom } from '@/widgets/interview/InterviewRoom'
import { useProject } from '@/features/project/useProjects'
import { toast } from '@/features/toast/toastStore'
import { targetLanguageOf, languageName } from '@/shared/lib/language'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { buildAIServices } from '@/services/aiServices'
import { InterviewService } from '@/services/interviewService'
import type { InterviewScenario, InterviewSession } from '@/entities/interview/types'
import { formatDateTime, useTranslation, type TranslationKey } from '@/i18n'

const STATUS_KEYS: Record<InterviewSession['status'], TranslationKey> = {
  interviewing: 'interview.status.interviewing',
  summarizing: 'interview.status.summarizing',
  graded: 'interview.status.graded',
}

/** Simulated patient interview (oral exam practice) for a language course. */
export function InterviewPage(): JSX.Element {
  const { id: projectId = '', sessionId } = useParams<{ id: string; sessionId?: string }>()
  const { t, language: uiLanguage } = useTranslation()
  const { project, loading } = useProject(projectId)
  const targetLanguage = targetLanguageOf(project)

  const header = (
    <PageHeader
      title={
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label={t('interview.backToProject')}>
            <Link to={sessionId ? `/projects/${projectId}/interview` : `/projects/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Stethoscope className="h-4 w-4" />
          {t('interview.title')}
        </div>
      }
      description={
        targetLanguage
          ? t('interview.subtitle', { language: languageName(targetLanguage, uiLanguage) })
          : t('interview.subtitleGeneric')
      }
      nav={<ProjectFlowNav projectId={projectId} active="interview" />}
    />
  )

  return (
    <PageContainer>
      {header}
      <PageContent className="space-y-6">
        {loading ? (
          <LoadingState />
        ) : !targetLanguage ? (
          <EmptyState
            icon={<Stethoscope className="h-10 w-10" />}
            title={t('interview.notLanguageCourse')}
            description={t('interview.notLanguageCourseHint')}
          />
        ) : sessionId ? (
          <InterviewRoom
            key={sessionId}
            projectId={projectId}
            sessionId={sessionId}
            targetLanguage={targetLanguage}
          />
        ) : (
          <InterviewLanding projectId={projectId} />
        )}
      </PageContent>
    </PageContainer>
  )
}

function InterviewLanding({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<InterviewSession[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [scenarios, setScenarios] = useState<InterviewScenario[] | null>(null)
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'generating' | 'starting'>('idle')
  const [progress, setProgress] = useState(0)
  const [examMode, setExamMode] = useState(false)
  const [deleting, setDeleting] = useState<InterviewSession | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    new InterviewService()
      .list(projectId)
      .then((rows) => {
        if (!cancelled) setSessions(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  const service = useCallback(async () => {
    const bundle = await buildAIServices()
    return new InterviewService({ ai: bundle?.ai ?? null })
  }, [])

  const extract = async () => {
    const controller = new AbortController()
    abort.current = controller
    setPhase('extracting')
    setProgress(0)
    try {
      const found = await (
        await service()
      ).extractScenarios(projectId, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      })
      setScenarios(found)
    } catch (err) {
      if (!controller.signal.aborted)
        toast({
          variant: 'error',
          title: t('interview.extractFailed'),
          description: friendlyAIError(err),
        })
    } finally {
      if (!controller.signal.aborted) setPhase('idle')
    }
  }

  const generate = async () => {
    const controller = new AbortController()
    abort.current = controller
    setPhase('generating')
    try {
      const required = scenarios?.[0]?.questions
      const scenario = await (
        await service()
      ).generateScenario(projectId, {
        ...(required ? { requiredQuestions: required } : {}),
        signal: controller.signal,
      })
      setScenarios((previous) => [scenario, ...(previous ?? [])])
    } catch (err) {
      if (!controller.signal.aborted)
        toast({
          variant: 'error',
          title: t('interview.generateFailed'),
          description: friendlyAIError(err),
        })
    } finally {
      if (!controller.signal.aborted) setPhase('idle')
    }
  }

  const start = async (scenario: InterviewScenario) => {
    setPhase('starting')
    try {
      const session = await new InterviewService().start(projectId, scenario, { examMode })
      navigate(`/projects/${projectId}/interview/${session.id}`)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('interview.startFailed'),
        description: friendlyAIError(err),
      })
      setPhase('idle')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await new InterviewService().delete(deleting.id)
      setSessions((rows) => rows?.filter((row) => row.id !== deleting.id) ?? null)
      setDeleting(null)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('interview.deleteFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  const busy = phase !== 'idle'

  return (
    <div className="space-y-6">
      <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:border-t-[1.5px] lecture:border-t-foreground lecture:bg-transparent lecture:shadow-none">
        <CardHeader className="lecture:px-0">
          <CardTitle>{t('interview.newTitle')}</CardTitle>
          <CardDescription>{t('interview.newDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 lecture:px-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void extract()} disabled={busy}>
              {phase === 'extracting' ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <BookOpen aria-hidden />
              )}
              {t('interview.extract')}
            </Button>
            <Button variant="outline" onClick={() => void generate()} disabled={busy}>
              {phase === 'generating' ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {t('interview.generate')}
            </Button>
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={examMode}
              onChange={(event) => setExamMode(event.target.checked)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{t('interview.examMode')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('interview.examModeHint')}
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">{t('interview.privacy')}</p>
          {phase === 'extracting' && (
            <div className="space-y-1" role="status" aria-live="polite">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {t('interview.extracting', { percent: progress })}
              </p>
            </div>
          )}
          {scenarios !== null && scenarios.length === 0 && phase === 'idle' && (
            <p className="text-sm text-muted-foreground" role="status">
              {t('interview.noScenarios')}
            </p>
          )}
          {scenarios && scenarios.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border lecture:rounded-none lab:rounded-sm">
              {scenarios.map((scenario, index) => (
                <li
                  key={`${scenario.title}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-sm font-medium">{scenario.title}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={scenario.source === 'textbook' ? 'secondary' : 'outline'}>
                        {scenario.source === 'textbook'
                          ? t('interview.sourceTextbook')
                          : t('interview.sourceGenerated')}
                      </Badge>
                      <span>
                        {t('interview.counts', {
                          questions: scenario.questions.length,
                          facts: scenario.facts.length,
                        })}
                      </span>
                      {scenario.page !== undefined && (
                        <span>{t('interview.page', { page: scenario.page })}</span>
                      )}
                    </div>
                    {scenario.source === 'generated' && (
                      <p className="text-xs text-muted-foreground">
                        {t('interview.generatedNotice')}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => void start(scenario)} disabled={busy}>
                    <Play aria-hidden />
                    {t('interview.start')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="interview-sessions">
        <h2 id="interview-sessions" className="font-heading text-base font-semibold">
          {t('interview.sessions')}
        </h2>
        {loadError ? (
          <ErrorState
            title={t('interview.loadFailed')}
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        ) : sessions === null ? (
          <LoadingState />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('interview.noSessions')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border lecture:rounded-none lab:rounded-sm">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Link
                    to={`/projects/${projectId}/interview/${session.id}`}
                    className="focus-ring break-words text-sm font-medium hover:underline"
                  >
                    {session.scenario.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{t(STATUS_KEYS[session.status])}</Badge>
                    {session.examMode && <span>{t('interview.examMode')}</span>}
                    {session.results && (
                      <span>
                        {t('interview.sessionScore', {
                          asked: session.results.questions.asked,
                          questions: session.results.questions.total,
                          understood: session.results.facts.understood,
                          facts: session.results.facts.total,
                        })}
                      </span>
                    )}
                    <span>{formatDateTime(session.updatedAt)}</span>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/projects/${projectId}/interview/${session.id}`}>
                    {session.status === 'graded' ? t('interview.view') : t('interview.resume')}
                  </Link>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('interview.delete', { title: session.scenario.title })}
                  onClick={() => setDeleting(session)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
        title={t('interview.deleteTitle')}
        description={t('interview.deleteDescription', { title: deleting?.scenario.title ?? '' })}
        confirmLabel={t('common.delete')}
        variant="destructive"
        busy={deleteBusy}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
