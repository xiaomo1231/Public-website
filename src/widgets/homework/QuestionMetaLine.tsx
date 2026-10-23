import { Link } from 'react-router-dom'
import { useTranslation } from '@/i18n'
import type { HomeworkQuestion } from '@/entities/homework/types'
import { EVAL_ROLE_LABEL_KEYS, resolveEvalRole } from '@/entities/evaluation/evalRole'

/**
 * The question header's metadata: knowledge points and exam-scope links
 * (matched locally), 已核对, and the evaluation role.
 */
export function QuestionMetaLine({ question }: { question: HomeworkQuestion }): JSX.Element | null {
  const { t } = useTranslation()
  const meta = question.meta
  const role = resolveEvalRole(question.evalRole)
  const points = meta?.knowledgePoints ?? []
  const exams = meta?.examTopics ?? []
  if (points.length === 0 && exams.length === 0 && !role) return null
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-question-meta
    >
      {points.length > 0 && (
        <span>
          {t('questionMeta.knowledgePoints')}: {points.join(' · ')}
        </span>
      )}
      {exams.length > 0 && (
        <span>
          {t('questionMeta.examScope')}:{' '}
          {exams.map((exam, index) => (
            <span key={exam.topicId}>
              {index > 0 && ' · '}
              <Link
                to={`/projects/${question.projectId}?tab=exams`}
                className="focus-ring rounded text-primary underline-offset-2 hover:underline"
                title={exam.scopeLabel}
              >
                {exam.text.length > 40 ? `${exam.text.slice(0, 40)}…` : exam.text}
              </Link>
            </span>
          ))}
        </span>
      )}
      {role && <span>{t(EVAL_ROLE_LABEL_KEYS[role])}</span>}
    </div>
  )
}
