import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, FolderKanban, Sparkles, TrendingUp } from 'lucide-react'
import { useProjects } from '@/features/project/useProjects'
import { useAuth } from '@/features/auth/useAuth'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { FunctionPlot } from '@/widgets/dashboard/FunctionPlot'
import { SectionHeading } from '@/shared/ui/Section'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { WeaknessPanel } from '@/widgets/mistakes/WeaknessPanel'
import { ThemePicker } from '@/widgets/theme/ThemePicker'
import { SUBJECT_LABEL_KEYS, type Project } from '@/entities/project/types'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation()
  const { projects, loading, loaded } = useProjects()
  const { profile } = useAuth()

  const stats = useMemo(() => {
    const total = projects.length
    const subjects = new Set(projects.map((p) => p.subject)).size
    const lastUpdated = projects.map((p) => p.updatedAt).sort((a, b) => b - a)[0]
    return { total, subjects, lastUpdated }
  }, [projects])

  const recent = projects.slice(0, 4)
  const featured = recent[0]
  const others = recent.slice(1)

  return (
    <PageContainer>
      <PageHeader
        icon={<Sparkles className="h-5 w-5" />}
        title={t('dashboard.greeting', { name: profile?.name ?? t('dashboard.student') })}
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
      <PageContent className="space-y-8">
        {!loaded && loading ? (
          <LoadingState label={t('dashboard.loading')} />
        ) : (
          <>
            {/* Hero: the page's focal point. The precision grid sits behind the
                copy; the plotted curve is the page's single authored moment. */}
            <section className="lab-hero blueprint-frame relative isolate overflow-hidden bg-card p-6 sm:p-8 lg:p-10">
              <div aria-hidden className="tech-grid" />
              <div className="relative z-10">
                <div className="grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
                  <div className="max-w-2xl space-y-5">
                    <h2 className="max-w-lg text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl xl:text-[3.4rem]">
                      {stats.total > 0 ? t('dashboard.heroTitleActive') : t('dashboard.heroTitle')}
                    </h2>
                    <div className="tick-rule max-w-[15rem]" aria-hidden />
                    <p className="text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                      {t('dashboard.heroBody')}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Button asChild size="lg">
                        <Link to="/projects">
                          {stats.total > 0
                            ? t('dashboard.continueStudying')
                            : t('dashboard.createFirstProject')}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                      {featured && (
                        <Button asChild variant="outline" size="lg">
                          <Link to={`/projects/${featured.id}`}>{t('dashboard.openLatest')}</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                  <figure className="blueprint-frame m-0 rounded-2xl border border-border/70 bg-background/70 p-4">
                    <FunctionPlot />
                  </figure>
                </div>

                <dl className="mt-8 grid gap-3 sm:grid-cols-3">
                  <StatCell
                    icon={<FolderKanban className="h-4 w-4" />}
                    label={t('dashboard.projects')}
                    value={String(stats.total)}
                    hint={
                      stats.total === 0
                        ? t('dashboard.createFirstProject')
                        : t('dashboard.projectsCount', { count: stats.subjects })
                    }
                  />
                  <StatCell
                    icon={<BookOpen className="h-4 w-4" />}
                    label={t('projects.subject')}
                    value={String(stats.subjects)}
                  />
                  <StatCell
                    icon={<TrendingUp className="h-4 w-4" />}
                    label={t('dashboard.lastActivity')}
                    value={stats.lastUpdated ? relativeTime(stats.lastUpdated) : '—'}
                    hint={stats.lastUpdated ? t('dashboard.autoSaved') : t('dashboard.noActivity')}
                  />
                </dl>
              </div>
            </section>

            {featured && (
              <section>
                <FeaturedProject project={featured} />
              </section>
            )}

            <section className={`grid gap-6 ${!featured || others.length > 0 ? 'lg:grid-cols-3' : ''}`}>
              <div className={featured && others.length === 0 ? 'hidden' : 'lg:col-span-2'}>
                {others.length > 0 ? (
                  <>
                    <SectionHeading
                      title={t('dashboard.otherProjects')}
                      description={t('dashboard.recentProjectsHint')}
                      action={
                        projects.length > recent.length ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link to="/projects">
                              {t('dashboard.viewAllProjects')}
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : undefined
                      }
                    />
                    <Card className="overflow-hidden">
                      <ul className="hairline-list">
                        {others.map((p) => (
                          <li key={p.id}>
                            <Link
                              to={`/projects/${p.id}`}
                              className="focus-ring group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                            >
                              <span
                                aria-hidden
                                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-theme-primary-soft text-sm font-semibold uppercase text-foreground"
                              >
                                {p.name.slice(0, 1)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <TruncatedText
                                  as="div"
                                  text={p.name}
                                  className="text-sm font-medium text-foreground"
                                />
                                <div className="truncate text-xs text-muted-foreground">
                                  {t(SUBJECT_LABEL_KEYS[p.subject])} ·{' '}
                                  {t('dashboard.updatedAt', { date: relativeTime(p.updatedAt) })}
                                </div>
                              </div>
                              <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                                {t(SUBJECT_LABEL_KEYS[p.subject])}
                              </Badge>
                              <ArrowRight
                                aria-hidden
                                className="h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                              />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </>
                ) : !featured ? (
                  <>
                    <SectionHeading
                      title={t('dashboard.recentProjects')}
                      description={t('dashboard.recentProjectsHint')}
                    />
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
                  </>
                ) : null}
              </div>

              <Card variant="accent">
                <CardHeader>
                  <CardTitle>{t('dashboard.whatsNext')}</CardTitle>
                  <CardDescription>{t('dashboard.roadmap')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    <Link to="/settings">
                      <Sparkles />
                      {t('nav.settings')}
                      <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </section>

            <section>
              <ThemePicker />
            </section>

            {featured && (
              <section>
                <WeaknessPanel projectId={featured.id} compact />
              </section>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.localFirstTitle')}</CardTitle>
                <CardDescription>{t('dashboard.localFirstBody')}</CardDescription>
              </CardHeader>
            </Card>
          </>
        )}
      </PageContent>
    </PageContainer>
  )
}

function FeaturedProject({ project }: { project: Project }): JSX.Element {
  const { t } = useTranslation()
  return (
    <Link
      to={`/projects/${project.id}`}
      className="floating-course blueprint-frame focus-ring group block overflow-hidden rounded-[1.5rem] border border-border/60 bg-card p-5 shadow-lift transition-colors hover:border-border sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="plate-grid grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border/70 bg-background font-mono text-lg font-semibold text-primary"
          >
            {project.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <TruncatedText
              as="div"
              text={project.name}
              className="text-lg font-semibold tracking-tight text-foreground"
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="label-mono">{t(SUBJECT_LABEL_KEYS[project.subject])}</span>
              <span aria-hidden>·</span>
              <span>{t('dashboard.updatedAt', { date: relativeTime(project.updatedAt) })}</span>
            </div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground sm:self-auto">
          {t('projects.openProject')}
          <ArrowRight
            aria-hidden
            className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  )
}

function StatCell({
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
    <div className="blueprint-frame rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <dt className="label-mono">{label}</dt>
        <span aria-hidden className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      </div>
      <dd className="data-num mt-2 truncate text-2xl font-semibold leading-none text-foreground">
        {value}
      </dd>
      {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
