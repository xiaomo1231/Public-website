import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Brain, TrendingDown, TrendingUp } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { MasteryService } from '@/services/masteryService'
import type { KnowledgeMastery } from '@/entities/knowledgeMastery/types'
import { cn, relativeTime } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { practicedMasteryAverage, toPercent } from '@/shared/lib/percent'

function toneFor(mastery: number): { bandKey: TranslationKey; className: string } {
  if (mastery >= 0.8) return { bandKey: 'mastery.band.strong', className: 'text-emerald-600' }
  if (mastery >= 0.6) return { bandKey: 'mastery.band.solid', className: 'text-foreground' }
  if (mastery >= 0.4) return { bandKey: 'mastery.band.developing', className: 'text-amber-600' }
  return { bandKey: 'mastery.band.needsWork', className: 'text-destructive' }
}

/** Headline figures: serif in lecture, a mono readout in lab. */
const FIGURE_VALUE =
  'text-3xl font-semibold tabular-nums lecture:font-heading lecture:font-bold lab:font-mono lab:text-[22px] lab:font-medium'
const FIGURE_LABEL =
  'text-xs text-muted-foreground lecture:text-[13px] lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-wider'

export function MasteryPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const [rows, setRows] = useState<KnowledgeMastery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        const service = new MasteryService()
        const data = await service.listByProject(projectId)
        if (!cancelled) setRows(data.sort((a, b) => a.mastery - b.mastery))
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  if (!projectId) return <div />

  const practiced = rows.filter((r) => r.attempts > 0)
  const average = practicedMasteryAverage(rows) ?? 0

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('mastery.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Brain className="h-4 w-4" />
            {t('mastery.title')}
          </div>
        }
        description={t('mastery.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="mastery" />}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/quiz`}>{t('mastery.takeQuiz')}</Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        {loading ? (
          <LoadingState label={t('mastery.loading')} />
        ) : error ? (
          <ErrorState
            title={t('mastery.loadFailed')}
            description={t('mastery.loadFailedHint')}
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t('common.tryAgain')}
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Brain className="h-10 w-10" />}
            title={t('mastery.empty')}
            description={t('mastery.emptyHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz`}>{t('mastery.generateQuiz')}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-b lecture:border-t-[1.5px] lecture:border-b-border lecture:border-t-foreground lecture:bg-transparent lecture:shadow-none">
              <CardContent className="grid gap-6 p-6 lecture:px-0 lecture:py-4 lab:gap-0 lab:p-0 sm:grid-cols-3 sm:lab:divide-x">
                <div className="lab:px-3.5 lab:py-3">
                  <div className={FIGURE_VALUE}>{toPercent(average)}%</div>
                  <div className={FIGURE_LABEL}>{t('mastery.average')}</div>
                </div>
                <div className="lab:px-3.5 lab:py-3 sm:lecture:border-l sm:lecture:pl-6">
                  <div className={FIGURE_VALUE}>{practiced.length}</div>
                  <div className={FIGURE_LABEL}>{t('mastery.practised')}</div>
                </div>
                <div className="lab:px-3.5 lab:py-3 lab:font-mono lab:text-xs sm:lecture:border-l sm:lecture:pl-6">
                  <div className="flex items-center gap-2 text-sm">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    <span>
                      {t('mastery.below', {
                        count: practiced.filter((r) => r.mastery < 0.6).length,
                      })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                    <span>
                      {t('mastery.above', {
                        count: practiced.filter((r) => r.mastery >= 0.8).length,
                      })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lecture:rounded-none lecture:border-0 lecture:bg-transparent lecture:shadow-none">
              <CardHeader className="lecture:px-0 lecture:pb-2 lab:border-b lab:px-3.5 lab:py-2.5">
                <CardTitle className="text-base lecture:font-heading lecture:text-[21px] lecture:font-bold lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground">
                  {t('mastery.knowledgePoints')}
                </CardTitle>
                <CardDescription>{t('mastery.knowledgePointsHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 lecture:space-y-0 lecture:divide-y lecture:border-t lecture:px-0 lab:space-y-0 lab:divide-y lab:p-0">
                {rows.map((row) => {
                  const tone = toneFor(row.mastery)
                  const pct = toPercent(row.mastery)
                  return (
                    <div
                      key={row.id}
                      className="space-y-1 lecture:py-3 lab:grid lab:items-center lab:gap-x-3 lab:space-y-0 lab:px-3.5 lab:py-2.5 sm:lab:grid-cols-[minmax(0,1fr)_8rem_3rem]"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm lab:contents">
                        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere] lecture:text-[15px] lab:font-normal">
                          {row.knowledgePoint}{' '}
                          <span className={cn('text-xs font-normal', tone.className)}>
                            {t(tone.bandKey)}
                          </span>
                        </span>
                        <span className="ml-auto tabular-nums text-muted-foreground lab:order-3 lab:ml-0 lab:text-right lab:font-mono lab:text-[13px]">
                          {pct}%
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        className="h-1.5 lecture:h-1 lab:order-2 lab:h-1 lab:rounded-none"
                      />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lab:order-4 lab:col-span-full lab:pt-1">
                        <Badge variant="outline" className="tabular-nums lab:font-mono">
                          {t('mastery.correctOf', { correct: row.correct, total: row.attempts })}
                        </Badge>
                        {row.attempts === 0 && <span>{t('mastery.noAttempts')}</span>}
                        <span className="ml-auto">
                          {t('mastery.updatedAt', { date: relativeTime(row.lastUpdated) })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">{t('mastery.explanation')}</p>
          </>
        )}
      </PageContent>
    </PageContainer>
  )
}
