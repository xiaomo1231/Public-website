import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FolderKanban, Sparkles } from 'lucide-react'
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
import { cn, relativeTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

/**
 * The homepage entrance plays once per session: the first visit gets a short
 * staggered rise, and returning to the page later skips it. The flag is set
 * only after the animation would have finished, so React StrictMode's dev
 * double-mount still shows it.
 */
let homeIntroShown = false

function useHomeIntro(): boolean {
  const [play] = useState(() => !homeIntroShown)
  useEffect(() => {
    if (!play) return
    const id = window.setTimeout(() => {
      homeIntroShown = true
    }, 1000)
    return () => window.clearTimeout(id)
  }, [play])
  return play
}

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation()
  const { projects, loading, loaded } = useProjects()
  const { profile } = useAuth()
  const playIntro = useHomeIntro()

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
            {/* Hero: the live coordinate plane is the left, larger half — the
                page's main visual, with real room to read the curve. The copy
                and the loose counts sit in a compact rail beside it, so the
                recent-course row stays close to the first screen. */}
            <section className="lab-hero blueprint-frame relative isolate overflow-hidden bg-card p-6 sm:p-8">
              <div className="mx-auto grid w-full max-w-[86rem] gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
                <div
                  className={cn(
                    'order-2 rounded-2xl border border-border/70 bg-background/60 p-4 sm:p-5 lg:order-1',
                    playIntro && 'intro-item',
                  )}
                  style={playIntro ? { animationDelay: '140ms' } : undefined}
                >
                  <FunctionPlot />
                </div>

                <div className="order-1 max-w-xl space-y-4 lg:order-2">
                  <p
                    className={cn(
                      'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
                      playIntro && 'intro-item',
                    )}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-primary" />
                    {t('dashboard.heroEyebrow')}
                  </p>
                  <h2
                    className={cn(
                      'text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[2.25rem]',
                      playIntro && 'intro-item',
                    )}
                    style={playIntro ? { animationDelay: '70ms' } : undefined}
                  >
                    {stats.total > 0 ? t('dashboard.heroTitleActive') : t('dashboard.heroTitle')}
                  </h2>
                  <p
                    className={cn(
                      'text-sm leading-relaxed text-muted-foreground sm:text-[15px]',
                      playIntro && 'intro-item',
                    )}
                    style={playIntro ? { animationDelay: '130ms' } : undefined}
                  >
                    {t('dashboard.heroBody')}
                  </p>
                  <div
                    className={cn('flex flex-wrap items-center gap-3 pt-1', playIntro && 'intro-item')}
                    style={playIntro ? { animationDelay: '190ms' } : undefined}
                  >
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
                  <p
                    className={cn('label-mono pt-1', playIntro && 'intro-item')}
                    style={playIntro ? { animationDelay: '250ms' } : undefined}
                  >
                    {`${stats.total} ${t('dashboard.projects')} · ${t('dashboard.projectsCount', {
                      count: stats.subjects,
                    })} · ${
                      stats.lastUpdated
                        ? t('dashboard.updatedAt', { date: relativeTime(stats.lastUpdated) })
                        : t('dashboard.noActivity')
                    }`}
                  </p>
                </div>
              </div>
            </section>

            {featured ? (
              <section className="space-y-3">
                <SectionHeading
                  title={t('dashboard.continueLearning')}
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
                <FeaturedProject project={featured} />
                {others.length > 0 && (
                  <Card className="overflow-hidden">
                    <ul className="hairline-list">
                      {others.map((p) => (
                        <li key={p.id}>
                          <ProjectRow project={p} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </section>
            ) : (
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
            )}

            {featured && (
              <section>
                <WeaknessPanel projectId={featured.id} compact />
              </section>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
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
              <ThemePicker />
            </div>

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
            className="plate-grid grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border/70 bg-background font-mono text-xl font-semibold text-primary"
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

function ProjectRow({ project }: { project: Project }): JSX.Element {
  const { t } = useTranslation()
  return (
    <Link
      to={`/projects/${project.id}`}
      className="focus-ring group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-theme-primary-soft text-sm font-semibold uppercase text-foreground"
      >
        {project.name.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <TruncatedText as="div" text={project.name} className="text-sm font-medium text-foreground" />
        <div className="truncate text-xs text-muted-foreground">
          {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
          {t('dashboard.updatedAt', { date: relativeTime(project.updatedAt) })}
        </div>
      </div>
      <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
        {t(SUBJECT_LABEL_KEYS[project.subject])}
      </Badge>
      <ArrowRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  )
}
