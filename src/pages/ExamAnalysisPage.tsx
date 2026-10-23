import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { ExamAnalysisContent } from '@/widgets/exam/ExamAnalysisContent'
import { useTranslation } from '@/i18n'

/**
 * 题型与覆盖分析 of the course's past papers (the 考试工作台's 考题 tab shows
 * the same analysis for an exam's papers).
 */
export function ExamAnalysisPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()

  if (!projectId) return <div />
  return (
    <PageContainer>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('mockExam.back')}>
              <Link to={`/projects/${projectId}/homework`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            {t('examAnalysis.title')}
          </div>
        }
        description={t('examAnalysis.disclaimer')}
        nav={<ProjectFlowNav projectId={projectId} active="homework" />}
        actions={
          <Button asChild variant="outline">
            <Link to={`/projects/${projectId}/homework?aiMock=new`}>
              <Sparkles className="h-4 w-4" aria-hidden />
              {t('aiMock.generate')}
            </Link>
          </Button>
        }
      />
      <PageContent className="space-y-5">
        <ExamAnalysisContent projectId={projectId} />
      </PageContent>
    </PageContainer>
  )
}
