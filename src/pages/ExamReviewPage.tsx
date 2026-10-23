import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, NotebookText } from 'lucide-react'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Button } from '@/shared/ui/Button'
import { formatDateTime } from '@/shared/lib/utils'
import { useProject } from '@/features/project/useProjects'
import { examWorkspacePath } from '@/features/studyPlan/examReturn'
import { ExamReviewContent } from '@/widgets/studyPlan/ExamReviewContent'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { useTranslation } from '@/i18n'

/**
 * 复习提纲 of one exam as a page of its own (plan tasks link here); the same
 * content is the 复习提纲 tab of the 考试工作台.
 */
export function ExamReviewPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId = '', examId = '' } = useParams<{ id: string; examId: string }>()
  const { project } = useProject(projectId)
  const [exam, setExam] = useState<PlannedExam | null>(null)

  return (
    <PageContainer>
      <PageHeader
        icon={<NotebookText className="h-5 w-5" />}
        title={exam ? t('plan.review.title', { exam: exam.name }) : t('plan.review.titleShort')}
        description={
          exam
            ? `${project?.name ?? ''} · ${formatDateTime(exam.at)}`
            : t('plan.review.description')
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild size="sm" variant="ghost">
              <Link to={exam ? examWorkspacePath(exam.id) : '/plan?tab=exams'}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {exam ? t('examWorkspace.backTo', { name: exam.name }) : t('plan.review.back')}
              </Link>
            </Button>
          </div>
        }
      />
      <PageContent>
        <ExamReviewContent projectId={projectId} examId={examId} onExam={setExam} />
      </PageContent>
    </PageContainer>
  )
}
