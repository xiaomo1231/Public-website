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
import { useUiStyle } from '@/features/theme/useAppearance'
import {
  FigureStrip,
  LAB_TABLE_HEAD_CLASS,
  MiniBar,
  SECTION_TITLE_CLASS,
  type FigureItem,
} from '@/widgets/dashboard/Figures'
import { useCourseMastery, type CourseMasteryEstimate } from '@/widgets/dashboard/useCourseMastery'
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

  const { uiStyle } = useUiStyle()
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects])
  const mastery = useCourseMastery(loaded ? projectIds : [])

  const name = profile?.name ?? t('dashboard.student')
  const aiReady = Boolean(settings?.apiKey?.trim())
  const hasProjects = projects.length > 0

  const focus =
    overviewLoading && !overview ? (
      <div className="space-y-4" aria-hidden>
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted/70" />
      </div>
    ) : overview ? (
      <StudyFocus overview={overview} />
    ) : null

  return (
    <PageContainer>
      <PageContent>
        <div className="mx-auto w-full max-w-6xl lecture:max-w-[980px]">
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
            <div className="space-y-8 pt-6 lecture:space-y-11">
              {overview && <HomeFigures overview={overview} />}
              {settingsLoaded && !aiReady && <AiMissingNotice />}
              {error && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('home.loadFailed')}
                </p>
              )}
              {uiStyle === 'lab' ? (
                // Lab: the course table is the page's instrument panel; what to
                // do next and the weak points sit under it.
                <>
                  <CourseTable projects={projects} overview={overview} mastery={mastery} />
                  <div className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-8">{focus}</div>
                    {overview && (
                      <aside className="min-w-0">
                        <WeakPoints courses={overview.courses} />
                      </aside>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-10">{focus}</div>
                  <aside className="min-w-0 space-y-10">
                    <CourseList projects={projects} overview={overview} mastery={mastery} />
                    {overview && <WeakPoints courses={overview.courses} />}
                  </aside>
                </div>
              )}
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  )
}

/* ------------------------------------------------------------------------ */
/* Figures / readouts                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Four counts the overview already holds — nothing estimated or invented.
 * Lecture shows them as a "figures" row, lab as a readout strip.
 */
function HomeFigures({ overview }: { overview: HomeOverview }): JSX.Element {
  const { t } = useTranslation()
  const { courses } = overview
  const open = courses.reduce((sum, c) => sum + (c.homework.questions - c.homework.worked), 0)
  const openCourses = courses.filter((c) => c.homework.questions > c.homework.worked).length
  const mistakes = courses.reduce((sum, c) => sum + c.activeMistakes, 0)
  const mistakeCourses = courses.filter((c) => c.activeMistakes > 0).length
  const topics = courses.reduce((sum, c) => sum + (c.analysis === 'ready' ? c.topicCount : 0), 0)
  const materials = courses.reduce((sum, c) => sum + c.materials.total, 0)
  const latest = courses.reduce((max, c) => Math.max(max, c.lastActivityAt), 0)

  const items: FigureItem[] = [
    {
      label: t('home.fig.homework'),
      value: open,
      sub: openCourses > 0 ? t('home.fig.across', { count: openCourses }) : undefined,
    },
    {
      label: t('home.fig.mistakes'),
      value: mistakes,
      sub: mistakeCourses > 0 ? t('home.fig.across', { count: mistakeCourses }) : undefined,
    },
    {
      label: t('home.fig.topics'),
      value: topics,
      sub: t('home.courses.materials', { count: materials }),
    },
    {
      label: t('home.fig.courses'),
      value: courses.length,
      sub: latest > 0 ? t('home.courses.lastActive', { date: relativeTime(latest) }) : undefined,
    },
  ]
  return <FigureStrip items={items} label={t('home.figures.label')} />
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
    <header className="flex flex-col gap-5 pb-2 pt-2 lecture:pt-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2 lecture:space-y-3">
        <p className="text-muted-foreground lecture:text-[13px] lecture:tracking-[0.14em] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.08em]">
          {date}
        </p>
        <h1 className="text-balance font-heading text-foreground lecture:text-[30px] lecture:font-bold lecture:leading-snug lab:text-[22px] lab:font-semibold lab:leading-tight lab:tracking-[-0.01em] sm:lecture:text-[36px]">
          {t(greetingKey(now.getHours()), { name })}
        </h1>
        <p className="data-num text-muted-foreground lecture:text-[15px] lab:font-mono lab:text-xs">
          {summary}
        </p>
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
        ? {
            title: t('home.step.tutorTopic', { topic: step.topicName }),
            hint: t('home.step.tutor.hint'),
          }
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
          <h2 id="home-resume" className={cn('mb-3', SECTION_TITLE_CLASS)}>
            {t('home.resume.title')}
          </h2>
          <Link
            to={focus.href}
            className={cn(
              'focus-ring group block transition-colors duration-200',
              // lecture: a ruled entry, the title set large in the serif.
              'lecture:border-y lecture:border-y-border lecture:border-t-foreground lecture:py-6',
              // lab: a flat hairline panel.
              'lab:border lab:border-border lab:bg-card lab:p-5 lab:hover:border-primary/40',
            )}
          >
            <p className="min-w-0 break-words text-[13px] text-muted-foreground [overflow-wrap:anywhere] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.06em]">
              {focus.kicker}
            </p>
            <p className="mt-2 break-words font-heading text-foreground transition-colors duration-200 lecture:text-[26px] lecture:font-bold lecture:leading-snug lecture:group-hover:text-primary lab:text-[20px] lab:font-semibold lab:leading-tight">
              {focus.title}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <p className="data-num text-sm text-muted-foreground lab:font-mono lab:text-xs">
                {focus.meta}
              </p>
              <span className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-transform duration-press ease-out lecture:bg-foreground lecture:text-background lab:h-9 lab:rounded-md lab:bg-primary-strong lab:px-4 lab:text-primary-foreground motion-safe:group-active:scale-[0.97]">
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
          <h2 id="home-next" className={cn('mb-3', SECTION_TITLE_CLASS)}>
            {t('home.next.title')}
          </h2>
          <ul className="hairline-list overflow-hidden lecture:border-y lecture:border-border lab:border lab:border-border lab:bg-card">
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
      className="focus-ring group flex min-w-0 items-center gap-4 transition-colors duration-200 lecture:py-4 lab:px-4 lab:py-3 lab:hover:bg-accent/60"
    >
      <span
        aria-hidden
        className="grid shrink-0 place-items-center text-muted-foreground lecture:hidden lab:h-8 lab:w-8 lab:rounded-md lab:border lab:border-border"
      >
        <Icon className={cn('h-4 w-4', busy && 'motion-safe:animate-spin')} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="order-2 block truncate text-foreground transition-colors duration-200 lecture:font-heading lecture:text-[18px] lecture:font-bold lecture:group-hover:text-primary lab:order-1 lab:text-sm lab:font-medium">
          {text.title}
        </span>
        <span className="order-1 block truncate text-[13px] text-muted-foreground lab:order-2 lab:text-xs">
          {course.project.name} · {text.hint}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 lecture:text-primary motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/* ------------------------------------------------------------------------ */
/* Course list + weak points                                                 */
/* ------------------------------------------------------------------------ */

const COURSE_PREVIEW = 5

function courseRows(
  projects: Project[],
  overview: HomeOverview | null,
): Array<{ project: Project; course?: CourseOverview }> {
  // Prefer the overview's activity order; fall back to the store order.
  return overview
    ? overview.courses.map((course) => ({ project: course.project, course }))
    : projects.map((project) => ({ project }))
}

function CoursesHeading({ total }: { total: number }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id="home-courses" className={SECTION_TITLE_CLASS}>
        {t('home.courses.title')}
      </h2>
      {total > COURSE_PREVIEW && (
        <Link
          to="/projects"
          className="focus-ring rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground lab:text-xs"
        >
          {t('home.courses.viewAll')}
        </Link>
      )}
    </div>
  )
}

/** Lecture: courses as ruled rows with the name in the serif. */
function CourseList({
  projects,
  overview,
  mastery,
}: {
  projects: Project[]
  overview: HomeOverview | null
  mastery: Record<string, CourseMasteryEstimate>
}): JSX.Element {
  const { t } = useTranslation()
  const rows = courseRows(projects, overview)

  return (
    <section aria-labelledby="home-courses">
      <CoursesHeading total={projects.length} />
      <ul className="border-t border-border">
        {rows.slice(0, COURSE_PREVIEW).map(({ project, course }) => {
          const estimate = mastery[project.id]
          return (
            <li key={project.id} className="border-b border-border">
              <Link
                to={`/projects/${project.id}`}
                className="focus-ring group block min-w-0 py-3.5"
              >
                <TruncatedText
                  as="span"
                  text={project.name}
                  className="block font-heading text-[17px] font-bold text-foreground transition-colors duration-200 group-hover:text-primary"
                />
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
                  {t('home.courses.lastActive', {
                    date: relativeTime(course?.lastActivityAt ?? project.updatedAt),
                  })}
                </span>
                {course && <CourseStats course={course} estimate={estimate} />}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CourseStats({
  course,
  estimate,
}: {
  course: CourseOverview
  estimate?: CourseMasteryEstimate
}): JSX.Element {
  const { t } = useTranslation()
  const items: string[] = [t('home.courses.materials', { count: course.materials.total })]
  if (course.analysis === 'ready')
    items.push(t('home.courses.topics', { count: course.topicCount }))
  else if (course.materials.total > 0) items.push(t('home.courses.notAnalysed'))
  if (course.homework.questions > 0)
    items.push(
      t('home.courses.homework', {
        done: course.homework.worked,
        total: course.homework.questions,
      }),
    )
  if (course.activeMistakes > 0)
    items.push(t('home.courses.mistakes', { count: course.activeMistakes }))
  if (estimate)
    items.push(t('home.courses.masteryEstimate', { value: Math.round(estimate.average * 100) }))
  return (
    <span className="data-num mt-1 flex flex-wrap gap-x-1.5 text-[12.5px] leading-5 text-muted-foreground">
      {items.map((item, index) => (
        <span key={item} className="inline-flex gap-1.5">
          {index > 0 && <span aria-hidden>·</span>}
          <span>{item}</span>
        </span>
      ))}
    </span>
  )
}

/** Lab: a hairline table of courses with mono figures. */
function CourseTable({
  projects,
  overview,
  mastery,
}: {
  projects: Project[]
  overview: HomeOverview | null
  mastery: Record<string, CourseMasteryEstimate>
}): JSX.Element {
  const { t } = useTranslation()
  const rows = courseRows(projects, overview)
  const head = 'px-3.5 py-2 text-left font-medium'
  const cell = 'border-t border-border px-3.5 py-2.5 align-middle'

  return (
    <section aria-labelledby="home-courses">
      <CoursesHeading total={projects.length} />
      <div className="overflow-x-auto border border-border bg-card">
        <table className="data-num w-full min-w-[560px] table-fixed border-collapse text-[13.5px]">
          <thead className={LAB_TABLE_HEAD_CLASS}>
            <tr>
              <th scope="col" className={head}>
                {t('home.table.course')}
              </th>
              <th scope="col" className={cn(head, 'w-20')}>
                {t('home.table.topics')}
              </th>
              <th scope="col" className={cn(head, 'w-40')}>
                {t('home.table.mastery')}
              </th>
              <th scope="col" className={cn(head, 'w-20')}>
                {t('home.table.mistakes')}
              </th>
              <th scope="col" className={cn(head, 'w-24')}>
                {t('home.table.homework')}
              </th>
              <th scope="col" className={cn(head, 'w-20')}>
                <span className="sr-only">{t('home.table.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, COURSE_PREVIEW).map(({ project, course }) => {
              const estimate = mastery[project.id]
              return (
                <tr key={project.id} className="transition-colors duration-150 hover:bg-accent/50">
                  <td className={cell}>
                    <Link
                      to={`/projects/${project.id}`}
                      className="focus-ring block min-w-0 rounded-sm"
                    >
                      <TruncatedText
                        as="span"
                        text={project.name}
                        className="font-medium text-foreground"
                      />
                      <span className="block truncate text-xs text-muted-foreground">
                        {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
                        {relativeTime(course?.lastActivityAt ?? project.updatedAt)}
                      </span>
                    </Link>
                  </td>
                  <td className={cn(cell, 'font-mono')}>
                    {course && course.analysis === 'ready' ? course.topicCount : '—'}
                  </td>
                  <td className={cell}>
                    {estimate ? (
                      <span className="flex items-center gap-2.5">
                        <span className="font-mono">{estimate.average.toFixed(2)}</span>
                        <MiniBar value={estimate.average} className="w-16" />
                      </span>
                    ) : (
                      <span className="font-mono text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(cell, 'font-mono')}>{course ? course.activeMistakes : '—'}</td>
                  <td className={cn(cell, 'font-mono')}>
                    {course && course.homework.questions > 0
                      ? `${course.homework.worked}/${course.homework.questions}`
                      : '—'}
                  </td>
                  <td className={cn(cell, 'text-right')}>
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/projects/${project.id}`}
                        aria-label={`${t('home.table.open')} ${project.name}`}
                      >
                        {t('home.table.open')}
                      </Link>
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
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
      <h2 id="home-weak" className={SECTION_TITLE_CLASS}>
        {t('home.weak.title')}
      </h2>
      <p className="mb-3 mt-1 text-[13px] text-muted-foreground">{t('home.weak.hint')}</p>
      <ul className="hairline-list lecture:border-y lecture:border-border lab:border lab:border-border lab:bg-card">
        {points.map((point) => {
          const value = Math.round(point.mastery * 100)
          return (
            <li key={`${point.project.id}:${point.knowledgePoint}`}>
              <Link
                to={`/projects/${point.project.id}/mastery`}
                className="focus-ring group block py-2.5 transition-colors duration-200 lecture:py-3 lab:px-3.5 lab:hover:bg-accent/60"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground transition-colors duration-200 lecture:group-hover:text-primary">
                    {point.knowledgePoint}
                  </span>
                  <span className="data-num shrink-0 text-[13px] text-muted-foreground lab:font-mono lab:text-xs">
                    {t('home.weak.mastery', { value })}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                  {point.project.name}
                </span>
                <MiniBar
                  value={Math.max(4, value) / 100}
                  className="mt-2 rounded-full lab:rounded-none"
                />
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
      <h2 id="home-onboarding" className={cn('mb-4', SECTION_TITLE_CLASS)}>
        {t('home.onboarding.title')}
      </h2>
      <ol className="hairline-list overflow-hidden lecture:border-y lecture:border-border lab:border lab:border-border lab:bg-card">
        {steps.map((step, index) => {
          const active = index === current
          return (
            <li
              key={step.title}
              className="flex flex-col gap-4 py-5 lab:px-5 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden
                className={cn(
                  'data-num grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold lab:h-8 lab:w-8 lab:rounded-md lab:font-mono lab:text-xs',
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
