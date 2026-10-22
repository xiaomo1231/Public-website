import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Brain } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TutorPanel } from '@/widgets/tutor/TutorPanel'
import { topicKicker, topicNumber } from '@/widgets/tutor/lessonStyle'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { FocusPageHeader } from '@/widgets/focus/FocusPageHeader'
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { TopicNotFound } from '@/widgets/tutor/TopicNotFound'
import { useTranslation } from '@/i18n'
import { useAuth } from '@/features/auth/useAuth'
import { resolveContentLanguage } from '@/entities/user/types'
import { useCourseLanguage } from '@/features/project/useCourseLanguage'

/**
 * The interactive half of the tutor.
 *
 * This is where the AI is allowed to ask questions, give hints and react to
 * answers. The Topic page is the reading half and never does any of that.
 */
export function InteractiveTutorPage(): JSX.Element {
  const { id: projectId, topicId } = useParams<{ id: string; topicId: string }>()
  const { t } = useTranslation()
  const { loading, analysis, topics } = useProjectTopics(projectId)
  // Tutor questions follow the student's question-language preference. The
  // language is derived (not seeded with a default) so the TutorPanel is only
  // mounted once it is final: mounting it early would start a session and an
  // AI introduction in the wrong language, then remount and orphan both.
  // The course's own mode wins over the global one; 跟随考试语言 needs the
  // detected exam language.
  const { loaded: profileLoaded } = useAuth()
  const courseLanguage = useCourseLanguage(projectId)
  const language =
    analysis && profileLoaded && courseLanguage.loaded
      ? resolveContentLanguage(courseLanguage.mode, analysis.language, courseLanguage.examLanguage)
      : null

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

  const activeTopic = topics.find((topic) => topic.id === topicId)

  // An analysed course without this topic: the address is wrong, not the course.
  if (analysis && topics.length > 0 && !activeTopic) {
    return <TopicNotFound projectId={projectId} />
  }

  if (!analysis || !activeTopic) {
    return (
      <PageContainer>
        <PageHeader
          title={t('tutor.interactiveTitle')}
          nav={<ProjectFlowNav projectId={projectId} active="tutor" />}
        />
        <PageContent>
          <EmptyState
            icon={<Brain className="h-10 w-10" />}
            title={t('tutor.notAnalysed')}
            description={t('tutor.notAnalysedHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}`}>{t('tutor.goToProject')}</Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* 专注子页面: back to the lesson instead of the course navigation. */}
      <FocusPageHeader
        backTo={`/projects/${projectId}/tutor/${activeTopic.id}`}
        backLabel={t('focus.backToLesson')}
        title={t('tutor.interactiveTitle')}
      />
      <PageContent>
        {/* Reading measure: a lecture-notes column, never full-bleed. Lecture
          sets it on paper under a serif title; lab frames the topic as a
          hairline header cell with mono metadata. */}
        <div className="mx-auto w-full max-w-[48rem] lecture:max-w-[680px] lab:max-w-[54rem]">
          <header className="mb-4 rounded-xl border bg-card p-5 lecture:mb-6 lecture:rounded-none lecture:border-x-0 lecture:border-t-0 lecture:bg-transparent lecture:px-0 lecture:pb-5 lecture:pt-0 lab:rounded-none lab:p-0">
            <p className="text-xs text-muted-foreground lecture:text-[13px] lecture:tracking-[0.14em] lecture:text-primary lab:flex lab:flex-wrap lab:border-b lab:font-mono lab:text-[11.5px]">
              <span className="hidden tabular-nums text-primary lab:inline lab:border-r lab:px-3.5 lab:py-2">
                § {topicNumber(activeTopic, topics.indexOf(activeTopic))}
              </span>
              <span className="lab:px-3.5 lab:py-2 lab:uppercase lab:tracking-[0.06em]">
                {topicKicker(activeTopic) || t('tutor.interactiveTitle')}
              </span>
            </p>
            <div className="lab:px-5 lab:py-4">
              <h2 className="mt-1 break-words font-heading text-lg font-semibold leading-snug text-foreground lecture:mt-2 lecture:text-[28px] lecture:font-bold lecture:leading-[1.35] lab:mt-0 lab:text-[20px]">
                {activeTopic.name}
              </h2>
              {activeTopic.description ? (
                <p className="mt-1.5 break-words text-sm text-muted-foreground lecture:text-[15px] lecture:leading-[1.75]">
                  {activeTopic.description}
                </p>
              ) : null}
            </div>
          </header>

          {language ? (
            <TutorPanel
              key={`${activeTopic.id}-${language}`}
              projectId={projectId}
              topicId={activeTopic.id}
              topicName={activeTopic.name}
              topicDescription={activeTopic.description}
              language={language}
            />
          ) : (
            <LoadingState label={t('tutor.loading')} />
          )}

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 lecture:mt-10 lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:px-0 lab:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground lecture:font-heading lecture:text-[17px] lecture:font-bold lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.06em] lab:text-muted-foreground">
                {t('tutor.nextStepTitle')}
              </p>
              <p className="text-xs text-muted-foreground">{t('tutor.nextStepHint')}</p>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <Link to={`/projects/${projectId}/quiz`}>
                {t('tutor.nextStepQuiz')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </PageContent>
    </PageContainer>
  )
}
