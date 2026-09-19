import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  BookX,
  FolderKanban,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import { useProjects } from '@/features/project/useProjects'
import { useAuth } from '@/features/auth/useAuth'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Progress } from '@/shared/ui/Progress'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { WeaknessPanel } from '@/widgets/mistakes/WeaknessPanel'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation()
  const { projects, loading, loaded } = useProjects()
  const { profile } = useAuth()

  const stats = useMemo(() => {
    const total = projects.length
    const subjects = new Set(projects.map((p) => p.subject)).size
    const lastUpdated = projects
      .map((p) => p.updatedAt)
      .sort((a, b) => b - a)[0]
    return { total, subjects, lastUpdated }
  }, [projects])

  const recent = projects.slice(0, 4)

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.greeting', { name: profile?.name ?? t('dashboard.student') })}
        description={t('dashboard.subtitle')}
        actions={
          <Button asChild>
            <Link to="/projects">
              <FolderKanban className="h-4 w-4" />
              {t('dashboard.myProjects')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />
      <PageContent>
        {!loaded && loading ? (
          <LoadingState label={t('dashboard.loading')} />
        ) : (
          <div className="grid gap-4">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<FolderKanban className="h-4 w-4" />}
                label={t('dashboard.projects')}
                value={String(stats.total)}
                hint={
                  stats.total === 0
                    ? t('dashboard.createFirstProject')
                    : t('dashboard.projectsCount', { count: stats.subjects })
                }
              />
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label={t('dashboard.studyStreak')}
                value="—"
                hint={t('dashboard.comingLater')}
              />
              <StatCard
                icon={<Target className="h-4 w-4" />}
                label={t('dashboard.mastery')}
                value="—"
                hint={t('dashboard.quizTutorComing')}
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label={t('dashboard.lastActivity')}
                value={stats.lastUpdated ? relativeTime(stats.lastUpdated) : '—'}
                hint={stats.lastUpdated ? t('dashboard.autoSaved') : t('dashboard.noActivity')}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t('dashboard.recentProjects')}</CardTitle>
                  <CardDescription>{t('dashboard.recentProjectsHint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recent.length === 0 ? (
                    <EmptyState
                      icon={<FolderKanban className="h-8 w-8" />}
                      title={t('dashboard.noProjects')}
                      description={t('dashboard.noProjectsHint')}
                      action={
                        <Button asChild>
                          <Link to="/projects">
                            {t('dashboard.createFirstProject')}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      }
                    />
                  ) : (
                    recent.map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3 transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <TruncatedText
                            as="div"
                            text={p.name}
                            className="text-sm font-medium"
                          />
                          <div className="text-xs text-muted-foreground">
                            {t(SUBJECT_LABEL_KEYS[p.subject])} ·{' '}
                            {t('dashboard.updatedAt', { date: relativeTime(p.updatedAt) })}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">{p.subject}</Badge>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.whatsNext')}</CardTitle>
                  <CardDescription>{t('dashboard.roadmap')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <RoadmapItem
                    icon={<Sparkles className="h-4 w-4" />}
                    title={t('dashboard.aiProvider')}
                    state="configured"
                  />
                  <RoadmapItem
                    icon={<FolderKanban className="h-4 w-4" />}
                    title={t('dashboard.contentLibrary')}
                    state="ready"
                  />
                  <RoadmapItem
                    icon={<BookOpen className="h-4 w-4" />}
                    title={t('dashboard.aiTutor')}
                    state="ready"
                  />
                  <RoadmapItem
                    icon={<Target className="h-4 w-4" />}
                    title={t('dashboard.quizMastery')}
                    state="ready"
                  />
                  <RoadmapItem
                    icon={<BookX className="h-4 w-4" />}
                    title={t('dashboard.mistakeBook')}
                    state="configured"
                  />
                </CardContent>
              </Card>
            </section>

            {recent[0] && (
              <section>
                <WeaknessPanel projectId={recent[0].id} compact />
              </section>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.localFirstTitle')}</CardTitle>
                <CardDescription>{t('dashboard.localFirstBody')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={stats.total > 0 ? 60 : 5} />
                <p className="mt-2 text-xs text-muted-foreground">{t('dashboard.phaseStatus')}</p>
              </CardContent>
            </Card>
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold leading-tight">{value}</div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function RoadmapItem({
  icon,
  title,
  state,
}: {
  icon: React.ReactNode
  title: string
  state: 'configured' | 'ready' | 'soon' | 'later'
}) {
  const { t } = useTranslation()
  const map = {
    configured: { labelKey: 'dashboard.phase1Done', variant: 'default' },
    ready: { labelKey: 'dashboard.ready', variant: 'secondary' },
    soon: { labelKey: 'dashboard.phase2', variant: 'outline' },
    later: { labelKey: 'dashboard.later', variant: 'outline' },
  } as const
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <Badge variant={map[state].variant}>{t(map[state].labelKey)}</Badge>
    </div>
  )
}