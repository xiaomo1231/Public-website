import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { QuestionHabitsService } from '@/services/questionHabitsService'
import { Button } from '@/shared/ui/Button'
import { useTranslation } from '@/i18n'

/**
 * After an assignment is recognised: a quiet suggestion to update the
 * professor question-habit profile with it. Only a link to the course home
 * section — never an automatic AI request. Hidden while nothing is new.
 */
export function HabitsSuggestion({
  projectId,
  version,
}: {
  projectId: string
  /** Changes when the assignments change, so the check runs again. */
  version: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const service = useMemo(() => new QuestionHabitsService(), [])
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    service
      .status(projectId)
      .then((status) => {
        if (alive)
          setCount(
            status.pending.filter((doc) => doc.kind === 'homework' || doc.kind === 'exam').length,
          )
      })
      .catch(() => {
        if (alive) setCount(0)
      })
    return () => {
      alive = false
    }
  }, [service, projectId, version])

  if (count === 0) return null
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm lab:rounded-none"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{t('habits.suggestion', { count })}</span>
      <Button asChild variant="outline" size="sm">
        <Link to={`/projects/${projectId}?tab=habits`}>{t('habits.suggestionAction')}</Link>
      </Button>
    </div>
  )
}
