import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Brain, Languages, Sigma, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
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
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { useTutorLesson } from '@/features/tutor/useTutorLesson'
import { useTranslation, type TranslationKey } from '@/i18n'

const LANGUAGES: Array<{ value: 'zh' | 'en' | 'mixed'; labelKey: TranslationKey }> = [
  { value: 'en', labelKey: 'language.en' },
  { value: 'zh', labelKey: 'language.zh' },
  { value: 'mixed', labelKey: 'language.bilingual' },
]

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
  const [activeTopicId, setActiveTopicId] = useState<string | undefined>(topicId)
  const [language, setLanguage] = useState<'zh' | 'en' | 'mixed'>('en')

  useEffect(() => {
    if (topicId) setActiveTopicId(topicId)
  }, [topicId])

  useEffect(() => {
    if (analysis?.language) setLanguage(analysis.language)
  }, [analysis?.language])

  const activeTopic = topics.find((topic) => topic.id === activeTopicId) ?? topics[0]

  const lessonState = useTutorLesson({
    projectId: projectId ?? '',
    topicId: activeTopic?.id ?? '',
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

  if (!analysis || topics.length === 0) {
    return (
      <PageContainer>
        <PageHeader title={t('tutor.title')} description={t('tutor.notAnalysedPageHint')} />
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

  const symbolsPanel = <TutorSymbolsPanel symbols={symbols} />

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('tutor.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Sparkles className="h-4 w-4" />
            {t('tutor.title')}
          </div>
        }
        description={t('tutor.subtitle')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Languages className="h-4 w-4" />
                {t(LANGUAGES.find((l) => l.value === language)?.labelKey ?? 'language.en')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('tutor.teachingLanguage')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LANGUAGES.map((l) => (
                <DropdownMenuItem key={l.value} onSelect={() => setLanguage(l.value)}>
                  {t(l.labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <PageContent>
        {/*
          Two columns from lg, the third only from xl. The app sidebar already
          takes 16rem, so showing topics + article + symbols at 1024px would
          squeeze the article to a few hundred pixels. The symbols panel is
          worth less than the reading measure (see the mobile <details> below).
        */}
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_220px]">
          <aside className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('tutor.topics')}</CardTitle>
                <CardDescription>{t('tutor.pickTopic')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {topics.map((topic, index) => (
                  <button
                    key={topic.id}
                    onClick={() => {
                      setActiveTopicId(topic.id)
                      navigate(`/projects/${projectId}/tutor/${topic.id}`)
                    }}
                    className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      activeTopic?.id === topic.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">{index + 1}.</span>
                    <TruncatedText text={topic.name} className="min-w-0 flex-1" />
                  </button>
                ))}
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0">
            {activeTopic ? (
              <TutorLessonView
                topicName={activeTopic.name}
                topicDescription={activeTopic.description}
                state={lessonState}
                footer={
                  <div className="mt-2 rounded-lg border border-border/70 bg-muted/20 p-5">
                    <h2 className="text-base font-semibold text-foreground">
                      {t('tutor.readyToPractice')}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('tutor.readyToPracticeHint')}
                    </p>
                    <Button asChild className="mt-3">
                      <Link to={`/projects/${projectId}/tutor/${activeTopic.id}/interactive`}>
                        {t('tutor.openInteractive')}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <EmptyState title={t('tutor.pickTopicTitle')} description={t('tutor.pickTopicHint')} />
            )}

            {/* Below xl the symbols collapse under the lesson so they cannot squeeze the text. */}
            <details className="mt-6 rounded-lg border border-border/70 xl:hidden">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium focus-ring">
                <Sigma className="h-4 w-4" aria-hidden />
                {t('tutor.symbols')}
              </summary>
              <div className="px-4 pb-4">{symbolsPanel}</div>
            </details>
          </section>

          <aside className="hidden xl:block">
            {symbolsPanel}
          </aside>
        </div>
      </PageContent>
    </PageContainer>
  )
}
