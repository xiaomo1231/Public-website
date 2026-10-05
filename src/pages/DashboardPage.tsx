import { useMemo, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookX,
  Check,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  Upload,
} from 'lucide-react'
import { useProjects } from '@/features/project/useProjects'
import { useAuth } from '@/features/auth/useAuth'
import { useAISettings } from '@/features/settings/useAISettings'
import { useHomeOverview } from '@/features/home/useHomeOverview'
import type {
  CourseNextStep,
  CourseOverview,
  HomeOverview,
  ResumeItem,
} from '@/services/homeOverviewService'
import { SUBJECT_LABEL_KEYS, type Project } from '@/entities/project/types'
import { Button } from '@/shared/ui/Button'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { cn, relativeTime } from '@/shared/lib/utils'
import { LOCALE_TAGS, useTranslation, type TranslationKey } from '@/i18n'

type T = ReturnType<typeof useTranslation>['t']

/**
 * Homepage: answers "what should I study now?" from the student's own data —
 * where they left off, the next step for each course, their courses at a
 * glance and the knowledge points worth revisiting. No decoration that is not
 * information.
 */
export function DashboardPage(): JSX.Element {
  const { t, language } = useTranslation()
  const { projects, loading, loaded } = useProjects()
  const { profile } = useAuth()
  const { settings, loaded: settingsLoaded } = useAISettings()
  const { overview, loading: overviewLoading, error } = useHomeOverview(projects, loaded)

  const name = profile?.name ?? t('dashboard.student')
  const aiReady = Boolean(settings?.apiKey?.trim())
  const hasProjects = projects.length > 0

  return (
    <PageContainer>
      <PageContent>
        <div className="mx-auto w-full max-w-6xl">
          <HomeHeader
            name={name}
            language={language}
            overview={hasProjects ? overview : null}
            projectCount={projects.length}
          />

          {!loaded && loading ? (
            <LoadingState label={t('dashboard.loading')} />
          ) : !hasProjects ? (
            <Onboarding aiReady={aiReady} />
          ) : (
            <div className="space-y-8 pt-8">
              {settingsLoaded && !aiReady && <AiMissingNotice />}
              {error && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('home.loadFailed')}
                </p>
              )}
              <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-10">
                  {overviewLoading && !overview ? (
                    <div className="space-y-4" aria-hidden>
                      <div className="h-48 animate-pulse rounded-3xl bg-muted" />
                      <div className="h-40 animate-pulse rounded-2xl bg-muted/70" />
                    </div>
                  ) : overview ? (
                    <StudyFocus overview={overview} />
                  ) : null}
                </div>
                <aside className="min-w-0 space-y-10">
                  <CourseList projects={projects} overview={overview} />
                  {overview && <WeakPoints courses={overview.courses} />}
                </aside>
              </div>
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  )
}

/* ------------------------------------------------------------------------ */
/* Header                                                                   */
/* ------------------------------------------------------------------------ */

function greetingKey(hour: number): TranslationKey {
  if (hour >= 5 && hour < 11) return 'home.greeting.morning'
  if (hour >= 11 && hour < 13) return 'home.greeting.noon'
  if (hour >= 13 && hour < 18) return 'home.greeting.afternoon'
  return 'home.greeting.evening'
}

function HomeHeader({
  name,
  language,
  overview,
  projectCount,
}: {
  name: string
  language: keyof typeof LOCALE_TAGS
  overview: HomeOverview | null
  projectCount: number
}): JSX.Element {
  const { t } = useTranslation()
  const now = useMemo(() => new Date(), [])
  const date = new Intl.DateTimeFormat(LOCALE_TAGS[language], {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now)

  const summary = useMemo(() => {
    if (projectCount === 0) return t('home.summary.empty')
    const parts = [t('home.summary.projects', { count: projectCount })]
    if (overview) {
      const open = overview.courses.reduce(
        (sum, c) => sum + (c.homework.questions - c.homework.worked),
        0,
      )
      const mistakes = overview.courses.reduce((sum, c) => sum + c.activeMistakes, 0)
      if (open > 0) parts.push(t('home.summary.homework', { count: open }))
      if (mistakes > 0) parts.push(t('home.summary.mistakes', { count: mistakes }))
      // "Nothing pending" only when every course is fully set up, otherwise it
      // would contradict a setup step suggested right below.
      const allSetUp = overview.courses.every((c) => c.nextStep.kind === 'tutor')
      if (parts.length === 1 && allSetUp) return `${parts[0]} · ${t('home.summary.clear')}`
    }
    return parts.join(' · ')
  }, [overview, projectCount, t])

  return (
    <header className="flex flex-col gap-5 border-b border-border/80 pb-8 pt-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        <p className="text-sm text-muted-foreground">{date}</p>
        <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[2.6rem]">
          {t(greetingKey(now.getHours()), { name })}
        </h1>
        <p className="data-num text-[15px] text-muted-foreground">{summary}</p>
      </div>
      {projectCount > 0 && (
        <Button asChild variant="outline" className="self-start sm:self-auto">
          <Link to="/projects?new=1">
            <Plus />
            {t('home.newProject')}
          </Link>
        </Button>
      )}
    </header>
  )
}

/* ------------------------------------------------------------------------ */
/* Next-step mapping                                                         */
/* ------------------------------------------------------------------------ */

const STEP_ICONS: Record<CourseNextStep['kind'], ComponentType<{ className?: string }>> = {
  upload: Upload,
  processing: Loader2,
  analyze: Layers,
  analyzing: Loader2,
  quiz: ListChecks,
  homework: ClipboardList,
  mistakes: BookX,
  tutor: GraduationCap,
}

function stepHref(projectId: string, step: CourseNextStep): string {
  const base = `/projects/${projectId}`
  switch (step.kind) {
    case 'upload':
    case 'processing':
      return base
    case 'analyze':
    case 'analyzing':
      return `${base}?tab=analysis`
    case 'quiz':
      return `${base}/quiz/${step.quizId}`
    case 'homework':
      return `${base}/homework/${step.setId}`
    case 'mistakes':
      return `${base}/mistakes`
    case 'tutor':
      return step.topicId ? `${base}/tutor/${step.topicId}` : `${base}/tutor`
  }
}

function stepText(step: CourseNextStep, t: T): { title: string; hint: string } {
  switch (step.kind) {
    case 'upload':
      return { title: t('home.step.upload'), hint: t('home.step.upload.hint') }
    case 'processing':
      return { title: t('home.step.processing'), hint: t('home.step.processing.hint') }
    case 'analyze':
      return { title: t('home.step.analyze'), hint: t('home.step.analyze.hint') }
    case 'analyzing':
      return { title: t('home.step.analyzing'), hint: t('home.step.analyzing.hint') }
    case 'quiz':
      return { title: t('home.step.quiz', { title: step.title }), hint: t('home.step.quiz.hint') }
    case 'homework':
      return {
        title: t('home.step.homework', { title: step.title }),
        hint: t('home.resume.remaining', { count: step.remaining }),
      }
    case 'mistakes':
      return {
        title: t('home.step.mistakes'),
        hint: t('home.step.mistakes.hint', { count: step.count }),
      }
    case 'tutor':
      return step.topicName
        ? { title: t('home.step.tutorTopic', { topic: step.topicName }), hint: t('home.step.tutor.hint') }
        : { title: t('home.step.tutor'), hint: t('home.step.tutor.hint') }
  }
}

function resumeHref(item: ResumeItem): string {
  const base = `/projects/${item.projectId}`
  if (item.kind === 'tutor') return item.topicId ? `${base}/tutor/${item.topicId}` : `${base}/tutor`
  if (item.kind === 'homework') return `${base}/homework/${item.setId}`
  return `${base}/quiz/${item.quizId}`
}

/* ------------------------------------------------------------------------ */
/* Resume + up next                                                          */
/* ------------------------------------------------------------------------ */

interface FocusCard {
  href: string
  kicker: string
  title: string
  meta: string
  action: string
}

function StudyFocus({ overview }: { overview: HomeOverview }): JSX.Element {
  const { t } = useTranslation()
  const { resume, courses } = overview

  // The large card is the real last activity; without one, it is the most
  // recent course's next step, so the page always opens on one clear action.
  let focus: FocusCard | null = null
  if (resume) {
    const kicker = t(`home.resume.kind.${resume.kind}` as TranslationKey)
    focus = {
      href: resumeHref(resume),
      kicker: `${kicker} · ${resume.projectName}`,
      title: resume.kind === 'tutor' ? resume.topicName : resume.title,
      meta:
        resume.kind === 'homework'
          ? `${relativeTime(resume.at)} · ${t('home.resume.remaining', { count: resume.remaining })}`
          : relativeTime(resume.at),
      action: t('home.resume.continue'),
    }
  } else if (courses[0]) {
    const step = stepText(courses[0].nextStep, t)
    focus = {
      href: stepHref(courses[0].project.id, courses[0].nextStep),
      kicker: `${t('home.resume.kind.nextStep')} · ${courses[0].project.name}`,
      title: step.title,
      meta: step.hint,
      action: t('home.resume.start'),
    }
  }

  const upNext = courses
    .map((course) => ({ course, href: stepHref(course.project.id, course.nextStep) }))
    .filter((item) => item.href !== focus?.href)
    .slice(0, 5)

  return (
    <>
      {focus && (
        <section aria-labelledby="home-resume">
          <h2 id="home-resume" className="mb-3 text-sm font-semibold text-foreground">
            {t('home.resume.title')}
          </h2>
          <Link
            to={focus.href}
            className="focus-ring group block rounded-3xl bg-theme-primary-soft p-7 text-secondary-foreground transition-[box-shadow,transform] duration-300 hover:shadow-lift motion-safe:hover:-translate-y-0.5 sm:p-9"
          >
            <p className="text-sm font-medium">{focus.kicker}</p>
            <p className="mt-3 break-words text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2rem]">
              {focus.title}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <p className="data-num text-sm">{focus.meta}</p>
              <span className="inline-flex h-11 items-center gap-2 rounded-full bg-primary-strong px-5 text-sm font-medium text-primary-foreground shadow-soft">
                {focus.action}
                <ArrowRight
                  aria-hidden
                  className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
                />
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* With a single course its step is already the large card above. */}
      {upNext.length > 0 && (
        <section aria-labelledby="home-next">
          <h2 id="home-next" className="mb-3 text-sm font-semibold text-foreground">
            {t('home.next.title')}
          </h2>
          <ul className="hairline-list overflow-hidden rounded-2xl border border-border/80 bg-card">
            {upNext.map(({ course, href }) => (
              <li key={course.project.id}>
                <NextStepRow course={course} href={href} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function NextStepRow({ course, href }: { course: CourseOverview; href: string }): JSX.Element {
  const { t } = useTranslation()
  const Icon = STEP_ICONS[course.nextStep.kind]
  const busy = course.nextStep.kind === 'processing' || course.nextStep.kind === 'analyzing'
  const text = stepText(course.nextStep, t)
  return (
    <Link
      to={href}
      className="focus-ring group flex min-w-0 items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/50"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
      >
        <Icon className={cn('h-[18px] w-[18px]', busy && 'motion-safe:animate-spin')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-foreground">{text.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {course.project.name} · {text.hint}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/* ------------------------------------------------------------------------ */
/* Course list + weak points                                                 */
/* ------------------------------------------------------------------------ */

const COURSE_PREVIEW = 5

function CourseList({
  projects,
  overview,
}: {
  projects: Project[]
  overview: HomeOverview | null
}): JSX.Element {
  const { t } = useTranslation()
  // Prefer the overview's activity order; fall back to the store order.
  const rows: Array<{ project: Project; course?: CourseOverview }> = overview
    ? overview.courses.map((course) => ({ project: course.project, course }))
    : projects.map((project) => ({ project }))

  return (
    <section aria-labelledby="home-courses">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-courses" className="text-sm font-semibold text-foreground">
          {t('home.courses.title')}
        </h2>
        {projects.length > COURSE_PREVIEW && (
          <Link
            to="/projects"
            className="focus-ring rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('home.courses.viewAll')}
          </Link>
        )}
      </div>
      <ul className="hairline-list overflow-hidden rounded-2xl border border-border/80 bg-card">
        {rows.slice(0, COURSE_PREVIEW).map(({ project, course }) => (
          <li key={project.id}>
            <Link
              to={`/projects/${project.id}`}
              className="focus-ring group flex min-w-0 items-start gap-3 px-5 py-4 transition-colors hover:bg-accent/50"
            >
              <span
                aria-hidden
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-theme-primary-soft text-sm font-semibold text-secondary-foreground"
              >
                {project.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <TruncatedText
                  as="span"
                  text={project.name}
                  className="block text-[15px] font-medium text-foreground"
                />
                <span className="block truncate text-[13px] text-muted-foreground">
                  {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
                  {t('home.courses.lastActive', {
                    date: relativeTime(course?.lastActivityAt ?? project.updatedAt),
                  })}
                </span>
                {course && <CourseStats course={course} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CourseStats({ course }: { course: CourseOverview }): JSX.Element {
  const { t } = useTranslation()
  const items: string[] = [t('home.courses.materials', { count: course.materials.total })]
  if (course.analysis === 'ready') items.push(t('home.courses.topics', { count: course.topicCount }))
  else if (course.materials.total > 0) items.push(t('home.courses.notAnalysed'))
  if (course.homework.questions > 0)
    items.push(
      t('home.courses.homework', { done: course.homework.worked, total: course.homework.questions }),
    )
  if (course.activeMistakes > 0)
    items.push(t('home.courses.mistakes', { count: course.activeMistakes }))
  return (
    <span className="data-num mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-lg bg-muted px-1.5 py-0.5 text-[12px] leading-5 text-muted-foreground"
        >
          {item}
        </span>
      ))}
    </span>
  )
}

function WeakPoints({ courses }: { courses: CourseOverview[] }): JSX.Element | null {
  const { t } = useTranslation()
  const points = courses
    .flatMap((course) => course.weakPoints.map((point) => ({ ...point, project: course.project })))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 4)
  if (points.length === 0) return null

  return (
    <section aria-labelledby="home-weak">
      <h2 id="home-weak" className="text-sm font-semibold text-foreground">
        {t('home.weak.title')}
      </h2>
      <p className="mb-3 text-[13px] text-muted-foreground">{t('home.weak.hint')}</p>
      <ul className="space-y-1">
        {points.map((point) => {
          const value = Math.round(point.mastery * 100)
          return (
            <li key={`${point.project.id}:${point.knowledgePoint}`}>
              <Link
                to={`/projects/${point.project.id}/mastery`}
                className="focus-ring block rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {point.knowledgePoint}
                  </span>
                  <span className="data-num shrink-0 text-[13px] text-muted-foreground">
                    {t('home.weak.mastery', { value })}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                  {point.project.name}
                </span>
                <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(4, value)}%` }}
                  />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------------ */
/* First run                                                                 */
/* ------------------------------------------------------------------------ */

function AiMissingNotice(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center">
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
      >
        <KeyRound className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-foreground">{t('home.aiMissing.title')}</p>
        <p className="text-[13px] text-muted-foreground">{t('home.aiMissing.body')}</p>
      </div>
      <Button asChild variant="outline" className="self-start sm:self-auto">
        <Link to="/settings">
          {t('home.aiMissing.action')}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}

function Onboarding({ aiReady }: { aiReady: boolean }): JSX.Element {
  const { t } = useTranslation()
  const steps: Array<{
    title: string
    hint: string
    done: boolean
    href?: string
  }> = [
    {
      title: t('home.onboarding.step1'),
      hint: t('home.onboarding.step1.hint'),
      done: aiReady,
      href: '/settings',
    },
    {
      title: t('home.onboarding.step2'),
      hint: t('home.onboarding.step2.hint'),
      done: false,
      href: '/projects?new=1',
    },
    { title: t('home.onboarding.step3'), hint: t('home.onboarding.step3.hint'), done: false },
  ]
  // The first unfinished step is the one to do now; later ones wait for it.
  const current = steps.findIndex((step) => !step.done)

  return (
    <section aria-labelledby="home-onboarding" className="max-w-3xl pt-8">
      <h2 id="home-onboarding" className="mb-4 text-sm font-semibold text-foreground">
        {t('home.onboarding.title')}
      </h2>
      <ol className="hairline-list overflow-hidden rounded-2xl border border-border/80 bg-card">
        {steps.map((step, index) => {
          const active = index === current
          return (
            <li
              key={step.title}
              className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6"
            >
              <span
                aria-hidden
                className={cn(
                  'data-num grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold',
                  step.done
                    ? 'bg-theme-primary-soft text-secondary-foreground'
                    : active
                      ? 'bg-primary-strong text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-[15px] font-medium',
                    active || step.done ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.title}
                </p>
                <p className="text-[13px] text-muted-foreground">{step.hint}</p>
              </div>
              {step.done ? (
                <span className="text-sm text-muted-foreground">{t('home.onboarding.done')}</span>
              ) : step.href ? (
                <Button
                  asChild
                  variant={active ? 'default' : 'outline'}
                  className="self-start sm:self-auto"
                >
                  <Link to={step.href}>
                    {t('home.onboarding.go')}
                    <ArrowRight />
                  </Link>
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
