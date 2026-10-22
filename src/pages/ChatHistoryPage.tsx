import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, History, MessageSquare, XCircle } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import {
  SESSION_STATUS_LABEL_KEYS,
  TURN_KIND_LABEL_KEYS,
  type TutorSession,
  type TutorTurn,
} from '@/entities/tutorSession/types'
import { cn, formatDateTime } from '@/shared/lib/utils'
import { difficultyLabelKey } from '@/infrastructure/ai/prompts/types'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation } from '@/i18n'
import { formatPercent } from '@/shared/lib/percent'

export function ChatHistoryPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()
  const [sessions, setSessions] = useState<TutorSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by "Try again" to re-run the load. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    // Switching course must not show the previous course's sessions.
    setSessions([])
    setActiveId(null)
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        const repo = new TutorSessionRepository()
        const rows = await repo.listConversations(projectId)
        if (cancelled) return
        setSessions(rows)
        setActiveId(rows[0]?.id ?? null)
      } catch (err) {
        if (cancelled) return
        logger.error('ChatHistoryPage load failed', { projectId }, err)
        setError(
          err instanceof Error && err.message ? err.message : t('chatHistory.loadFailedHint'),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // `t` is stable per language; reloading on language change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt])

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('chatHistory.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (error) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('chatHistory.loadFailed')}
            description={`${error} ${t('chatHistory.loadFailedHint')}`}
            action={
              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  const active = sessions.find((s) => s.id === activeId) ?? null

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('chatHistory.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <History className="h-4 w-4" />
            {t('chatHistory.title')}
          </div>
        }
        description={t('chatHistory.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="history" />}
      />
      <PageContent>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title={t('chatHistory.empty')}
            description={t('chatHistory.emptyHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/tutor`}>{t('chatHistory.openTutor')}</Link>
              </Button>
            }
          />
        ) : (
          // lecture: a margin list of sessions beside a transcript read as prose.
          // lab: one hairline panel — session index | log.
          <div className="grid gap-6 lab:gap-0 lab:border lab:bg-card lg:grid-cols-[280px_1fr] lg:lecture:gap-12">
            {/* Above the transcript (narrower than lg, e.g. iPad portrait) the
                session list scrolls in its own box instead of pushing the
                conversation below the fold. */}
            <aside className="space-y-2 lecture:space-y-0 lab:space-y-0 lab:border-b max-lg:max-h-[min(18rem,40vh)] max-lg:overflow-y-auto max-lg:overscroll-contain lg:lab:border-b-0 lg:lab:border-r">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={activeId === s.id ? 'true' : undefined}
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    'focus-ring block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    'lecture:rounded-none lecture:border-0 lecture:border-l lecture:py-2.5 lecture:pl-3',
                    'lab:rounded-none lab:border-0 lab:border-b lab:px-3.5 lab:py-2.5 lab:hover:bg-muted',
                    activeId === s.id
                      ? 'border-foreground/30 bg-accent lecture:border-l-2 lecture:border-primary lecture:bg-transparent lecture:pl-[11px] lab:bg-theme-primary-soft lab:shadow-[inset_2px_0_0_hsl(var(--primary))] lab:hover:bg-theme-primary-soft'
                      : 'hover:bg-accent/50 lecture:hover:bg-transparent',
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <TruncatedText text={s.topicName} className="min-w-0 flex-1 font-medium" />
                    <Badge
                      variant="outline"
                      className="shrink-0 lecture:border-0 lecture:px-0 lab:font-mono lab:text-[11px]"
                    >
                      {t(difficultyLabelKey(s.currentDifficulty))}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground lab:font-mono lab:text-[11px] lab:tabular-nums">
                    <span>{formatDateTime(s.updatedAt)}</span>
                    <span>·</span>
                    <span>{t('chatHistory.turns', { count: s.turns.length })}</span>
                  </div>
                </button>
              ))}
            </aside>
            <section className="min-w-0 space-y-3 lecture:max-w-[680px] lecture:space-y-0 lab:space-y-0">
              {active && (
                <>
                  <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:bg-transparent lecture:shadow-none lab:rounded-none lab:border-0 lab:border-b">
                    <CardHeader className="lecture:px-0 lecture:pt-0 lab:px-5 lab:py-4">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base lecture:font-heading lecture:text-[22px] lecture:font-bold lecture:leading-snug">
                        <TruncatedText text={active.topicName} className="min-w-0 max-w-full" />
                        <Badge
                          variant="outline"
                          className="shrink-0 tabular-nums lecture:font-sans lab:font-mono lab:text-[11px]"
                        >
                          {t('chatHistory.mastery', {
                            value: formatPercent(active.mastery),
                          })}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="lecture:font-sans lab:font-mono lab:text-[11px]"
                        >
                          {t(SESSION_STATUS_LABEL_KEYS[active.status])}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="lab:font-mono lab:text-[11.5px]">
                        {t('chatHistory.started', {
                          date: formatDateTime(active.startedAt),
                          count: active.turns.length,
                        })}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                  {active.turns.map((turn, i) => (
                    <TurnCard key={i} turn={turn} />
                  ))}
                </>
              )}
            </section>
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}

function TurnCard({ turn }: { turn: TutorTurn }) {
  const { t } = useTranslation()
  const isStudent = turn.role === 'student'
  const isFeedback = turn.kind === 'feedback'
  const correct = turn.evaluation?.isCorrect
  return (
    // lecture: transcript entries separated by rules; the student's turns
    // carry an accent side rule. lab: hairline log rows with mono metadata.
    <Card
      className={cn(
        isStudent
          ? 'border-primary/30'
          : isFeedback && correct === false
            ? 'border-destructive/40'
            : 'border-border',
        'lecture:rounded-none lecture:border-0 lecture:border-b lecture:border-border lecture:bg-transparent lecture:shadow-none',
        'lab:rounded-none lab:border-0 lab:border-b lab:border-border lab:shadow-none',
        isStudent &&
          'lecture:border-l-2 lecture:border-l-primary lab:shadow-[inset_2px_0_0_hsl(var(--primary))]',
        isFeedback &&
          correct === false &&
          'lecture:border-l-2 lecture:border-l-destructive lab:shadow-[inset_2px_0_0_hsl(var(--destructive))]',
      )}
    >
      <CardContent className="space-y-2 p-4 text-sm lecture:py-5 lecture:pr-0 lecture:text-[15.5px] lecture:leading-[1.8] lab:px-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground lecture:tracking-[0.06em] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.04em]">
          {isStudent ? t('chatHistory.student') : t('chatHistory.tutor')}
          <span>·</span>
          <span>{t(TURN_KIND_LABEL_KEYS[turn.kind])}</span>
          {isFeedback && correct !== undefined && (
            <span className="ml-auto flex items-center gap-1">
              {correct ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              {correct ? t('chatHistory.correct') : t('chatHistory.incorrect')}
            </span>
          )}
        </div>
        <RichText
          text={turn.content}
          format="markdown"
          className="min-w-0 max-w-[70ch] space-y-3"
          paragraphClassName="text-sm leading-relaxed lecture:text-[15.5px] lecture:leading-[1.8]"
        />
        {turn.question?.sourceRefs && turn.question.sourceRefs.length > 0 && (
          <div className="min-w-0 truncate rounded-lg bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {t('chatHistory.source', {
              value: turn.question.sourceRefs
                .map((r) => `${r.documentName}${r.page ? ` p${r.page}` : ''}`)
                .join(', '),
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
