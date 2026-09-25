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
        eyebrow={t('dashboard.eyebrow')}
        icon={<Sparkles className="h-5 w-5" />}
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
      <PageContent className="space-y-8">
        {!loaded && loading ? (
          <LoadingState label={t('dashboard.loading')} />
        ) : (
          <>
            {/* Hero: the page's focal point. A restrained theme wash plus a slow
                aurora sit behind the text; the copy itself is always solid. */}
            <section className="study-hero relative isolate overflow-hidden p-6 sm:p-8 lg:p-10">
              <div aria-hidden className="app-gradient absolute inset-0" />
              <div aria-hidden className="aurora" />
              <div className="relative z-10">
                <div className="grid items-center gap-6 md:grid-cols-[1.1fr_0.9fr]">
                  <div className="max-w-2xl space-y-5">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-theme-primary" />
                      {t('dashboard.heroEyebrow')}
                    </p>
                    <h2 className="max-w-lg text-balance text-4xl font-semibold leading-[1.12] tracking-tight text-foreground sm:text-5xl xl:text-6xl">
                      {stats.total > 0 ? t('dashboard.heroTitleActive') : t('dashboard.heroTitle')}
                    </h2>
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
                  <StudyOrbit />
                </div>

                <dl className="hero-stats mt-8 grid gap-3 sm:grid-cols-3">
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
              <section className="animate-rise">
                <FeaturedProject project={featured} />
              </section>
            )}

            <section
              className={`grid animate-rise gap-6 ${!featured || others.length > 0 ? 'lg:grid-cols-3' : ''}`}
              style={{ animationDelay: '70ms' }}
            >
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

            <section className="animate-rise" style={{ animationDelay: '140ms' }}>
              <ThemePicker />
            </section>

            {featured && (
              <section className="animate-rise" style={{ animationDelay: '210ms' }}>
                <WeaknessPanel projectId={featured.id} compact />
              </section>
            )}

            <Card className="animate-rise" style={{ animationDelay: '280ms' }}>
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
      className="floating-course focus-ring group relative block overflow-hidden rounded-[1.5rem] border border-border/50 bg-card p-5 shadow-lift transition-colors hover:border-border sm:p-6"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-theme-primary" />
      <div className="flex flex-col gap-4 pl-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-theme-primary-soft text-lg font-semibold uppercase text-foreground"
          >
            {project.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('dashboard.continueLearning')}
            </p>
            <TruncatedText
              as="div"
              text={project.name}
              className="text-lg font-semibold text-foreground"
            />
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
              {t('dashboard.updatedAt', { date: relativeTime(project.updatedAt) })}
            </div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground sm:self-auto">
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
    <div className="flex items-start gap-3 rounded-2xl bg-card/90 p-4 shadow-soft">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-theme-accent-soft text-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-xl font-semibold leading-tight text-foreground">{value}</dd>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

function StudyOrbit(): JSX.Element {
  return (
    <div className="study-orbit" aria-hidden="true">
      <div className="study-orbit__ring" />
      <div className="study-orbit__planet">
        <BookOpen strokeWidth={1.35} />
      </div>
      <div className="study-note study-note--math">
        <span className="study-note__dot" />
        <span>∫ f(x) dx</span>
        <span className="study-note__line" />
        <span className="study-note__line study-note__line--short" />
      </div>
      <div className="study-note study-note--idea">
        <Sparkles />
        <span>Aha!</span>
      </div>
      <div className="study-note study-note--graph">
        <TrendingUp />
        <span>x → ∞</span>
      </div>
      <span className="orbit-spark orbit-spark--one">✦</span>
      <span className="orbit-spark orbit-spark--two">✧</span>
      <span className="orbit-dot" />
    </div>
  )
}
