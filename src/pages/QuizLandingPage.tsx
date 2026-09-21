import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Brain, ClipboardList, Clock, ListChecks, Sparkles, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { QuizConfigDialog } from '@/widgets/quiz/QuizConfigDialog'
import { buildAIServices } from '@/services/aiServices'
import { QuizRepository } from '@/entities/quiz/repository'
import { QUIZ_STATUS_LABEL_KEYS, type Quiz, type QuizConfig } from '@/entities/quiz/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function QuizLandingPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await new QuizRepository().listByProject(projectId)
        if (!cancelled) setQuizzes(rows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function handleStart(config: QuizConfig) {
    if (!projectId) return
    setBusy(true)
    setProgress({ stage: 'starting', progress: 5 })
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({
          variant: 'error',
          title: t('quiz.noProvider'),
          description: t('quiz.noProviderHint'),
        })
        return
      }
      const quiz = await bundle.quiz.generateQuiz(projectId, config, {
        onProgress: (stage, value) => setProgress({ stage, progress: value }),
      })
      await bundle.quiz.startQuiz(quiz.id)
      toast({
        variant: 'success',
        title: t('quiz.ready'),
        description: t('quiz.readyBody', { count: quiz.questionIds.length }),
      })
      navigate(`/projects/${projectId}/quiz/${quiz.id}`)
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('quiz.generateFailed'), description: msg })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  if (!projectId) return <div />

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('quiz.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <ListChecks className="h-4 w-4" />
            {t('quiz.title')}
          </div>
        }
        description={t('quiz.subtitle')}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/mastery`}>
              <Brain className="h-4 w-4" />
              {t('quiz.mastery')}
            </Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {t('practice.title')}
            </CardTitle>
            <CardDescription>{t('practice.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to={`/projects/${projectId}/practice`}>
                <Upload className="h-4 w-4" />
                {t('practice.upload')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <QuizConfigDialog projectId={projectId} onStart={handleStart} busy={busy} progress={progress} />

        {loading ? (
          <LoadingState label={t('quiz.loading')} />
        ) : quizzes.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-10 w-10" />}
            title={t('quiz.empty')}
            description={t('quiz.emptyHint')}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quiz.previous')}</CardTitle>
              <CardDescription>{t('quiz.previousCount', { count: quizzes.length })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {quizzes.map((q) => (
                <Link
                  key={q.id}
                  to={q.status === 'completed' ? `/projects/${projectId}/quiz/${q.id}/result` : `/projects/${projectId}/quiz/${q.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{q.title}</span>
                  <Badge variant={q.status === 'completed' ? 'default' : q.status === 'failed' ? 'destructive' : 'secondary'}>
                    {t(QUIZ_STATUS_LABEL_KEYS[q.status])}
                  </Badge>
                  {q.score && <Badge variant="outline">{q.score.percentage}%</Badge>}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(q.startedAt)}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageContainer>
  )
}