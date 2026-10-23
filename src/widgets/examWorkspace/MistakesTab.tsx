import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookX, ListChecks, Loader2, Repeat } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { RichText } from '@/shared/ui/RichText'
import type { ExamWorkspaceView } from '@/services/studyPlanService'
import { buildAIServices } from '@/services/aiServices'
import { MISTAKE_TYPE_LABEL_KEYS } from '@/entities/mistake/types'
import { isRetestDue } from '@/entities/mistake/followUp'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { RetestBanner } from '@/widgets/mistakes/RetestSession'
import { useTranslation } from '@/i18n'
import { examQuizLink, fromWorkspace } from './examLinks'
import { TabSection } from './TabSection'
import { TopicMasteryList } from './TopicMastery'
import { byMastery } from './workspaceHelpers'

/** Mistakes listed before 「显示全部」. */
const SHOWN = 20

/**
 * 错题与掌握度 (this exam's scope): the re-tests due today as a short quiz,
 * the open mistakes with 「练相似题」, and the mastery estimate of every topic
 * in scope with lesson / practice links.
 */
export function MistakesTab({
  view,
  onChanged,
}: {
  view: ExamWorkspaceView
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { exam, topics } = view.context
  const [busy, setBusy] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const now = Date.now()
  const shown = all ? view.mistakes : view.mistakes.slice(0, SHOWN)

  async function practice(mistakeId: string) {
    setBusy(mistakeId)
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({ variant: 'error', title: t('mistakes.noProvider') })
        return
      }
      const session = await bundle.reviewSession.practiceMistake(mistakeId, 'similar')
      await bundle.quiz.startQuiz(session.id)
      navigate(fromWorkspace(exam, `/projects/${exam.projectId}/quiz/${session.id}`))
    } catch (err) {
      toast({
        variant: 'error',
        title: t('mistakes.practiceFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-10" data-workspace-mistakes>
      <RetestBanner
        projectId={exam.projectId}
        onlyIds={view.mistakes.map((m) => m.id)}
        onChanged={onChanged}
      />

      <TabSection
        title={t('examWorkspace.mistakesTitle', { count: view.mistakes.length })}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to={`/projects/${exam.projectId}/mistakes`}>
              <BookX className="h-4 w-4" aria-hidden />
              {t('examWorkspace.openMistakeBook')}
            </Link>
          </Button>
        }
        data-workspace-mistake-list
      >
        {view.mistakes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('examWorkspace.mistakesNone')}</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border lab:rounded-none">
              {shown.map((mistake) => (
                <li
                  key={mistake.id}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start"
                  data-mistake-row={mistake.id}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant="outline">{mistake.knowledgePoint}</Badge>
                      <Badge variant="secondary">
                        {t(MISTAKE_TYPE_LABEL_KEYS[mistake.mistakeType])}
                      </Badge>
                      {isRetestDue(mistake, now) && (
                        <Badge data-retest-due>{t('examWorkspace.retestDueBadge')}</Badge>
                      )}
                    </div>
                    <div className="line-clamp-3 break-words text-sm">
                      <RichText text={mistake.question} paragraphClassName="text-sm" />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void practice(mistake.id)}
                  >
                    {busy === mistake.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Repeat className="h-4 w-4" aria-hidden />
                    )}
                    {t('examWorkspace.practiceSimilar')}
                  </Button>
                </li>
              ))}
            </ul>
            {view.mistakes.length > SHOWN && !all && (
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                {t('examWorkspace.showAll', { count: view.mistakes.length })}
              </Button>
            )}
          </>
        )}
      </TabSection>

      <TabSection
        title={t('examWorkspace.masteryTitle')}
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={examQuizLink(exam, view.link)}>
              <ListChecks className="h-4 w-4" aria-hidden />
              {t('examWorkspace.quick.quiz')}
            </Link>
          </Button>
        }
        data-workspace-mastery
      >
        {topics.length === 0 ? (
          <EmptyState
            title={t('examWorkspace.noTopics')}
            description={t('examWorkspace.noTopicsHint')}
          />
        ) : (
          <TopicMasteryList exam={exam} topics={byMastery(topics)} />
        )}
        <p className="text-xs text-muted-foreground">{t('examWorkspace.estimateNote')}</p>
      </TabSection>
    </div>
  )
}
