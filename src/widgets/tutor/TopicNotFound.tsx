import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ErrorState } from '@/shared/ui/ErrorState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useTranslation } from '@/i18n'

/**
 * An address names a topic this course does not have (deleted, renamed by a
 * re-analysis, or mistyped). Shown instead of silently opening another topic —
 * which would also generate (and pay for) a lesson nobody asked for.
 */
export function TopicNotFound({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageHeader
        title={t('tutor.title')}
        nav={<ProjectFlowNav projectId={projectId} active="tutor" />}
      />
      <PageContent>
        <ErrorState
          title={t('tutor.topicNotFound')}
          description={t('tutor.topicNotFoundHint')}
          action={
            <Button asChild>
              <Link to={`/projects/${projectId}/tutor`}>
                <ArrowLeft className="h-4 w-4" />
                {t('tutor.viewAllTopics')}
              </Link>
            </Button>
          }
        />
      </PageContent>
    </PageContainer>
  )
}
