import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Brain, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { TutorPanel } from '@/widgets/tutor/TutorPanel'
import { useProjectTopics } from '@/features/tutor/useProjectTopics'
import { useTranslation } from '@/i18n'

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
  const [language, setLanguage] = useState<'zh' | 'en' | 'mixed'>('en')

  useEffect(() => {
    if (analysis?.language) setLanguage(analysis.language)
  }, [analysis?.language])

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

  if (!analysis || !activeTopic) {
    return (
      <PageContainer>
        <PageHeader title={t('tutor.interactiveTitle')} />
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
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('tutor.backToLesson')}>
              <Link to={`/projects/${projectId}/tutor/${activeTopic.id}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Sparkles className="h-4 w-4" />
            {t('tutor.interactiveTitle')}
          </div>
        }
        description={t('tutor.interactiveSubtitle')}
      />
      <PageContent>
        {/* Reading measure: a lecture-notes column, never full-bleed. */}
        <div className="mx-auto w-full max-w-[48rem]">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">
                <TruncatedText text={activeTopic.name} className="min-w-0 max-w-full" />
              </CardTitle>
              {activeTopic.description ? (
                <CardDescription className="break-words">
                  {activeTopic.description}
                </CardDescription>
              ) : null}
            </CardHeader>
          </Card>

          <TutorPanel
            key={`${activeTopic.id}-${language}`}
            projectId={projectId}
            topicId={activeTopic.id}
            topicName={activeTopic.name}
            topicDescription={activeTopic.description}
            language={language}
          />
        </div>
      </PageContent>
    </PageContainer>
  )
}
