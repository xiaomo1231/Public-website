import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, History, MessageSquare, XCircle } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import {
  SESSION_STATUS_LABEL_KEYS,
  TURN_KIND_LABEL_KEYS,
  type TutorSession,
  type TutorTurn,
} from '@/entities/tutorSession/types'
import { formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function ChatHistoryPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()
  const [sessions, setSessions] = useState<TutorSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const repo = new TutorSessionRepository()
        const rows = await repo.listByProject(projectId)
        if (cancelled) return
        setSessions(rows)
        if (rows[0]) setActiveId(rows[0].id)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

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
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <aside className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    activeId === s.id ? 'border-foreground/30 bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{s.topicName}</span>
                    <Badge variant="outline">{s.currentDifficulty}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTime(s.updatedAt)}</span>
                    <span>·</span>
                    <span>{t('chatHistory.turns', { count: s.turns.length })}</span>
                  </div>
                </button>
              ))}
            </aside>
            <section className="space-y-3">
              {active && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {active.topicName}
                        <Badge variant="outline">
                          {t('chatHistory.mastery', {
                            value: `${Math.round(active.mastery * 100)}%`,
                          })}
                        </Badge>
                        <Badge variant="outline">
                          {t(SESSION_STATUS_LABEL_KEYS[active.status])}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
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
    <Card className={isStudent ? 'border-l-4 border-l-primary' : isFeedback && correct === false ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-muted'}>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
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
        <p className="whitespace-pre-wrap">{turn.content}</p>
        {turn.question?.sourceRefs && turn.question.sourceRefs.length > 0 && (
          <div className="rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
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