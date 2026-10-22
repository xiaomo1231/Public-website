import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  ChevronDown,
  GraduationCap,
  Languages,
  ListOrdered,
  Sigma,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { cn } from '@/shared/lib/utils'
import { SIDE_COLUMNS_QUERY, useMediaQuery } from '@/shared/lib/useMediaQuery'
import { useThemeStore } from '@/features/theme/themeStore'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import { TutorSymbolsPanel } from '@/widgets/tutor/TutorSymbolsPanel'
import { ClassProgressCard } from '@/widgets/tutor/ClassProgressCard'
import {
  countLessonWords,
  estimateReadingMinutes,
  topicKicker,
  topicNumber,
} from '@/widgets/tutor/lessonStyle'
import { CourseStructurePanel } from '@/widgets/courseStructure/CourseStructurePanel'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { FocusPageHeader } from '@/widgets/focus/FocusPageHeader'
import { StudyModeTabs } from '@/widgets/slides/StudyModeTabs'
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { useTutorLesson } from '@/features/tutor/useTutorLesson'
import { isUnknownTopic } from '@/features/tutor/isUnknownTopic'
import { TopicNotFound } from '@/widgets/tutor/TopicNotFound'
import { useCourseContext } from '@/features/tutor/useCourseContext'
import { useSlideDocuments } from '@/features/slides/useSlideDocuments'
import type { CourseStructureNode } from '@/entities/courseStructure/types'
import { useTranslation, type TranslationKey } from '@/i18n'
import { examModeKey, type ContentLanguage } from '@/entities/user/types'
import type { ExamLanguageKey } from '@/infrastructure/ai/prompts/exam-language/v1'
import { useCourseLanguage } from '@/features/project/useCourseLanguage'

const LANGUAGES: Array<{ value: ContentLanguage; labelKey: TranslationKey }> = [
  { value: 'en', labelKey: 'language.en' },
  { value: 'zh', labelKey: 'language.zh' },
  { value: 'mixed', labelKey: 'language.bilingual' },
]

/** The lesson languages offered: 跟随考试语言 too when the course's exam language is known. */
function languagesFor(examKey: ExamLanguageKey | null) {
  return examKey
    ? [...LANGUAGES, { value: examKey, labelKey: 'questionLanguage.exam' as TranslationKey }]
    : LANGUAGES
}

/**
 * The Topic page: the AI tutor's *teaching material*.
 *
 * It is a reading surface. The lesson is generated once and cached locally, so
 * revisiting a topic never costs tokens again. All interaction — questions,
 * hints, answers — happens on the separate Interactive Tutor page.
 */
export function TutorPage(): JSX.Element {
  const { id: projectId, topicId } = useParams<{ id: string; topicId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { loading, analysis, topics } = useProjectTopics(projectId)
  const { context: courseContext } = useCourseContext(projectId)
  const { documents: slideDocuments } = useSlideDocuments(projectId)
  /** "Learn by slide" is offered only when the project has a presentation. */
  const hasPresentations = slideDocuments.length > 0
  const studyMode = hasPresentations ? (
    <StudyModeTabs projectId={projectId ?? ''} active="knowledge" />
  ) : null
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(topicId)
  /** When set, only topics inside this chapter/section are shown. */
  const [structureFilter, setStructureFilter] = useState<CourseStructureNode | null>(null)
  const [language, setLanguage] = useState<ContentLanguage>('en')
  // 跟随考试语言: offered (and chosen by default) when the course uses it.
  const courseLanguage = useCourseLanguage(projectId)
  const examKey = examModeKey('exam', courseLanguage.examLanguage)
  const defaultExam = courseLanguage.mode === 'exam' ? examKey : null
  const languages = languagesFor(examKey)
  /*
   * Narrower than the side-column breakpoint (iPad portrait; lecture also on
   * iPad landscape) the contents fold into a toggle above the lesson, so the
   * lesson starts on the first screen instead of under a long list.
   */
  const uiStyle = useThemeStore((s) => s.uiStyle)
  const sideColumns = useMediaQuery(SIDE_COLUMNS_QUERY[uiStyle])
  const [tocOpen, setTocOpen] = useState(false)
  const tocFolded = !sideColumns && !tocOpen

  useEffect(() => {
    if (topicId) setActiveTopicId(topicId)
  }, [topicId])

  useEffect(() => {
    if (defaultExam) setLanguage(defaultExam)
    else if (analysis?.language) setLanguage(analysis.language)
  }, [analysis?.language, defaultExam])

  const visibleTopics = structureFilter
    ? topics.filter((topic) =>
        structureFilter.type === 'section'
          ? topic.sectionId === structureFilter.id
          : topic.chapterId === structureFilter.id,
      )
    : topics
  /** The address names a topic this course does not have: never fall back to another one. */
  const unknownTopic = !loading && isUnknownTopic(topicId, topics)
  const activeTopic = unknownTopic
    ? undefined
    : (visibleTopics.find((topic) => topic.id === activeTopicId) ?? visibleTopics[0])

  const lessonState = useTutorLesson({
    projectId: projectId ?? '',
    // Wait for the course's language mode, so a lesson is not requested in
    // the textbook language just before switching to the exam language.
    topicId: courseLanguage.loaded ? (activeTopic?.id ?? '') : '',
    topicName: activeTopic?.name ?? '',
    topicDescription: activeTopic?.description ?? '',
    language,
  })

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('tutor.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (analysis && unknownTopic && topics.length > 0) {
    return <TopicNotFound projectId={projectId} />
  }

  if (!analysis || topics.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title={t('tutor.title')}
          description={t('tutor.notAnalysedPageHint')}
          nav={<ProjectFlowNav projectId={projectId} active="tutor" />}
          {...(studyMode ? { actions: studyMode } : {})}
        />
        <PageContent>
          <EmptyState
            icon={<Brain className="h-10 w-10" />}
            title={t('tutor.notAnalysed')}
            description={t('tutor.notAnalysedHint')}
            action={
              <Button onClick={() => navigate(`/projects/${projectId}`)}>
                {t('tutor.goToProject')}
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  const symbols = lessonState.lesson?.symbols ?? []
  const readyLesson = lessonState.status === 'ready' ? lessonState.lesson : null

  const symbolsPanel = <TutorSymbolsPanel symbols={symbols} />

  const activeIndex = activeTopic ? topics.indexOf(activeTopic) : -1
  const visibleIndex = activeTopic ? visibleTopics.indexOf(activeTopic) : -1
  const nextTopic = visibleIndex >= 0 ? visibleTopics[visibleIndex + 1] : undefined
  /** Topics the professor's class has reached: the lab contents' tick marks. */
  const classProgress = courseContext?.classProgress
  const coveredIds = new Set([
    ...(classProgress?.completedTopicIds ?? []),
    ...(classProgress?.currentTopicId ? [classProgress.currentTopicId] : []),
  ])

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {studyMode}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Languages className="h-4 w-4" />
            {t(languages.find((l) => l.value === language)?.labelKey ?? 'language.en')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('tutor.teachingLanguage')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {languages.map((l) => (
            <DropdownMenuItem key={l.value} onSelect={() => setLanguage(l.value)}>
              {t(l.labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <PageContainer>
      {topicId ? (
        // 专注子页面 (a lesson being read): back header instead of the course navigation.
        <FocusPageHeader
          backTo={`/projects/${projectId}`}
          backLabel={t('projectNav.home')}
          title={activeTopic?.name ?? t('tutor.title')}
          meta={t('tutor.title')}
          actions={toolbar}
        />
      ) : (
        <PageHeader
          title={
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="icon" aria-label={t('tutor.backToProject')}>
                <Link to={`/projects/${projectId}`}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <GraduationCap className="h-4 w-4" />
              {t('tutor.title')}
            </div>
          }
          description={t('tutor.subtitle')}
          nav={<ProjectFlowNav projectId={projectId} active="tutor" />}
          actions={toolbar}
        />
      )}
      <PageContent>
        {/* Lab: an instrument readout above the panel. Only figures the page
          already holds — no mastery estimate is loaded here, so none is shown. */}
        {readyLesson && activeTopic && (
          <LessonReadouts
            text={readyLesson.content}
            drawn={readyLesson.visualizations?.length ?? 0}
            course={readyLesson.visuals?.filter((visual) => visual.hasImage).length ?? 0}
            symbols={readyLesson.symbols.length}
            position={activeIndex + 1}
            total={topics.length}
          />
        )}
        {/*
          lecture: margin contents | ~680px reading column | marginalia, from
          1200px. lab: one hairline panel — contents | document from lg, plus
          the inspector from xl. Narrower, the side columns fold away: the
          contents sit above the lesson and the symbols drop into the
          <details> under it, so neither can squeeze the reading measure.
        */}
        <div className="grid gap-8 lab:gap-0 lab:border lab:bg-card lg:lab:grid-cols-[232px_minmax(0,1fr)] min-[1200px]:lecture:grid-cols-[minmax(210px,1fr)_minmax(0,680px)_minmax(200px,1fr)] min-[1200px]:lecture:gap-10 xl:lab:grid-cols-[232px_minmax(0,1fr)_248px] min-[1400px]:lecture:gap-12">
          <aside className="min-w-0 space-y-3 lecture:mx-auto lecture:w-full lecture:max-w-[680px] lab:space-y-0 lab:border-b lab:py-3.5 lg:lab:border-b-0 lg:lab:border-r min-[1200px]:lecture:sticky min-[1200px]:lecture:top-8 min-[1200px]:lecture:mx-0 min-[1200px]:lecture:max-h-[calc(100vh-4rem)] min-[1200px]:lecture:w-full min-[1200px]:lecture:max-w-[248px] min-[1200px]:lecture:self-start min-[1200px]:lecture:justify-self-end min-[1200px]:lecture:overflow-y-auto">
            {!sideColumns && (
              <button
                type="button"
                aria-expanded={tocOpen}
                aria-controls="tutor-contents"
                data-testid="tutor-toc-toggle"
                onClick={() => setTocOpen((open) => !open)}
                className="focus-ring flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50 lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:px-0 lecture:hover:bg-transparent lab:mx-3.5 lab:w-[calc(100%-1.75rem)] lab:rounded-sm"
              >
                <ListOrdered className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="shrink-0 font-medium">{t('tutor.toc')}</span>
                {activeTopic && (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {topicNumber(activeTopic, activeIndex)} {activeTopic.name}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 opacity-60 transition-transform duration-200',
                    tocOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            )}
            <div
              id="tutor-contents"
              hidden={tocFolded}
              className="space-y-3 lab:space-y-0 lab:pt-3 lg:lab:pt-0"
            >
              <div className="empty:hidden lab:px-3 lab:pb-3">
                <CourseStructurePanel
                  projectId={projectId}
                  {...(structureFilter ? { selectedId: structureFilter.id } : {})}
                  onSelect={(node) =>
                    setStructureFilter((current) => (current?.id === node.id ? null : node))
                  }
                />
              </div>
              <nav aria-label={t('tutor.topics')} className="min-w-0">
                <h2 className="mb-2 text-sm font-semibold text-foreground lecture:text-xs lecture:font-normal lecture:tracking-[0.14em] lecture:text-muted-foreground lab:mx-3.5 lab:font-mono lab:text-[10.5px] lab:font-medium lab:uppercase lab:tracking-[0.08em] lab:text-muted-foreground">
                  {t('tutor.toc')}
                  <span className="hidden tabular-nums lab:inline"> / {visibleTopics.length}</span>
                </h2>
                <p className="sr-only">{t('tutor.pickTopic')}</p>
                {/* Above the lesson (lecture below 1200px) a long contents list scrolls in
                  its own box instead of pushing the lesson down. */}
                <ul className="space-y-1 lecture:space-y-0 lab:space-y-0 max-[1199px]:lecture:grid max-[1199px]:lecture:max-h-[min(18rem,40vh)] max-[1199px]:lecture:grid-cols-2 max-[1199px]:lecture:gap-x-6 max-[1199px]:lecture:overflow-y-auto">
                  {visibleTopics.map((topic) => {
                    const current = activeTopic?.id === topic.id
                    const covered = coveredIds.has(topic.id)
                    return (
                      <li key={topic.id}>
                        <button
                          type="button"
                          aria-current={current ? 'true' : undefined}
                          onClick={() => {
                            setActiveTopicId(topic.id)
                            setTocOpen(false)
                            navigate(`/projects/${projectId}/tutor/${topic.id}`)
                          }}
                          className={cn(
                            'focus-ring flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                            'lecture:rounded-none lecture:border-l lecture:py-1.5 lecture:pl-3 lecture:pr-0 lecture:text-[13.5px] lecture:leading-[1.5] lecture:text-muted-foreground lecture:hover:text-foreground',
                            'lab:grid lab:grid-cols-[2.25rem_minmax(0,1fr)_0.875rem] lab:items-baseline lab:gap-1 lab:rounded-none lab:px-3.5 lab:py-1.5 lab:text-[13px] lab:leading-[1.45] lab:text-muted-foreground lab:hover:bg-muted lab:hover:text-foreground',
                            current
                              ? 'bg-accent text-accent-foreground lecture:border-l-2 lecture:border-primary lecture:bg-transparent lecture:pl-[11px] lecture:text-foreground lab:bg-theme-primary-soft lab:text-foreground lab:shadow-[inset_2px_0_0_hsl(var(--primary))] lab:hover:bg-theme-primary-soft'
                              : 'hover:bg-accent/50 lecture:hover:bg-transparent',
                          )}
                        >
                          <span
                            className={cn(
                              'data-num mt-0.5 shrink-0 font-mono text-xs text-muted-foreground lecture:mt-0 lecture:font-sans lecture:text-[13px] lecture:tabular-nums lab:mt-0 lab:text-[11px]',
                              current && 'lab:text-primary',
                            )}
                          >
                            {topicNumber(topic, topics.indexOf(topic))}
                          </span>
                          {/* Two lines before clipping: a topic name is rarely readable in one. */}
                          <TruncatedText
                            text={topic.name}
                            className="min-w-0 flex-1 lecture:line-clamp-2 lecture:whitespace-normal lecture:break-words lab:line-clamp-2 lab:whitespace-normal lab:break-words"
                          />
                          {/* Lab tick: filled once the professor's class has reached the topic. */}
                          <span
                            aria-hidden
                            title={covered ? t('tutor.coveredInClass') : undefined}
                            className={cn(
                              'hidden h-1.5 w-1.5 self-center justify-self-end rounded-full border lab:block',
                              covered ? 'border-primary bg-primary' : 'border-input',
                            )}
                          />
                          {covered && <span className="sr-only">{t('tutor.coveredInClass')}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>
            </div>
          </aside>

          <section className="min-w-0 lab:px-5 lab:py-6 sm:lab:px-9 xl:lab:border-r">
            <div className="mx-auto mb-6 w-full max-w-[46rem] empty:hidden lecture:max-w-[680px] lab:mx-0 lab:max-w-[54rem]">
              <ClassProgressCard topics={topics} context={courseContext} />
            </div>
            {activeTopic ? (
              <TutorLessonView
                topicName={activeTopic.name}
                topicDescription={activeTopic.description}
                kicker={topicKicker(activeTopic)}
                number={topicNumber(activeTopic, activeIndex)}
                state={lessonState}
                footer={
                  <div className="mt-2 rounded-lg border border-border/70 bg-muted/20 p-5 lecture:mt-10 lecture:rounded-none lecture:border-0 lecture:border-t lecture:bg-transparent lecture:px-0 lab:bg-muted/40">
                    <h2 className="text-base font-semibold text-foreground lecture:font-heading lecture:text-[17px] lecture:font-bold">
                      {t('tutor.readyToPractice')}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('tutor.readyToPracticeHint')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
                      <Button asChild>
                        <Link to={`/projects/${projectId}/tutor/${activeTopic.id}/interactive`}>
                          {t('tutor.openInteractive')}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                      {nextTopic && (
                        <Link
                          to={`/projects/${projectId}/tutor/${nextTopic.id}`}
                          onClick={() => setActiveTopicId(nextTopic.id)}
                          className="focus-ring ml-auto min-w-0 max-w-full rounded-md text-right text-foreground lab:inline-flex lab:items-center lab:gap-2 lab:border lab:bg-card lab:px-3.5 lab:py-1.5 lab:text-left lab:text-sm lab:transition-colors lab:hover:bg-muted coarse:min-h-11"
                        >
                          <small className="block text-[12.5px] text-muted-foreground lab:inline lab:shrink-0 lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.06em]">
                            {t('tutor.nextTopic')}
                          </small>
                          <span className="block break-words font-heading text-[17px] font-bold lab:inline lab:min-w-0 lab:text-sm lab:font-medium">
                            <span className="tabular-nums lab:font-mono">
                              {topicNumber(nextTopic, topics.indexOf(nextTopic))}
                            </span>{' '}
                            {nextTopic.name}
                            <span aria-hidden className="ml-1 text-primary">
                              →
                            </span>
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>
                }
              />
            ) : (
              <EmptyState
                title={t('tutor.pickTopicTitle')}
                description={t('tutor.pickTopicHint')}
              />
            )}

            {/* Below the side-column breakpoint the symbols fold under the lesson. */}
            <details className="mx-auto mt-6 w-full max-w-[46rem] rounded-lg border border-border/70 lecture:max-w-[680px] lab:mx-0 lab:max-w-[54rem] min-[1200px]:lecture:hidden xl:lab:hidden">
              <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <Sigma className="h-4 w-4" aria-hidden />
                {t('tutor.symbols')}
              </summary>
              <div className="px-4 pb-4 lab:px-0">{symbolsPanel}</div>
            </details>
          </section>

          {/* lecture: sticky marginalia beside the column. lab: the inspector cell. */}
          <aside className="hidden min-w-0 lab:py-3.5 min-[1200px]:lecture:sticky min-[1200px]:lecture:top-8 min-[1200px]:lecture:block min-[1200px]:lecture:max-h-[calc(100vh-4rem)] min-[1200px]:lecture:w-full min-[1200px]:lecture:max-w-[220px] min-[1200px]:lecture:self-start min-[1200px]:lecture:overflow-y-auto xl:lab:block">
            {symbolsPanel}
          </aside>
        </div>
      </PageContent>
    </PageContainer>
  )
}

interface LessonReadoutsProps {
  text: string
  drawn: number
  course: number
  symbols: number
  position: number
  total: number
}

/** Lab-only instrument strip: four hairline cells of LABEL / mono value / sub line. */
function LessonReadouts({
  text,
  drawn,
  course,
  symbols,
  position,
  total,
}: LessonReadoutsProps): JSX.Element {
  const { t } = useTranslation()
  const minutes = estimateReadingMinutes(text)
  const percent = total > 0 ? Math.round((position / total) * 100) : 0
  const cells: Array<{ label: string; value: ReactNode; sub: ReactNode }> = [
    {
      label: t('tutor.readout.reading'),
      value: (
        <>
          {String(minutes).padStart(2, '0')}
          <small className="text-xs font-normal text-muted-foreground">
            {' '}
            {t('tutor.readout.minutesUnit')}
          </small>
        </>
      ),
      sub: t('tutor.readout.readingSub', { count: countLessonWords(text) }),
    },
    {
      label: t('tutor.readout.figures'),
      value: drawn + course,
      sub: t('tutor.readout.figuresSub', { drawn, course }),
    },
    { label: t('tutor.symbols'), value: symbols, sub: t('tutor.readout.symbolsSub') },
    {
      label: t('tutor.readout.position'),
      value: (
        <>
          {position}
          <small className="text-xs font-normal text-muted-foreground">/{total}</small>
        </>
      ),
      sub: (
        <span className="mt-2.5 block h-1 bg-border" aria-hidden>
          <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
        </span>
      ),
    },
  ]
  return (
    <dl className="mb-4 hidden grid-cols-2 border bg-card lab:grid sm:grid-cols-4">
      {cells.map((cell, index) => (
        <div
          key={index}
          className="min-w-0 px-3.5 py-3 sm:[&:not(:last-child)]:border-r [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0 [&:nth-child(odd)]:border-r"
        >
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
            {cell.label}
          </dt>
          <dd className="mt-1.5 font-mono text-[22px] font-medium tabular-nums leading-tight tracking-[-0.01em] text-foreground">
            {cell.value}
          </dd>
          <dd className="mt-0.5 truncate text-xs text-muted-foreground">{cell.sub}</dd>
        </div>
      ))}
    </dl>
  )
}
