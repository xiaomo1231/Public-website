import { useEffect, useState } from 'react'
import { BookOpenCheck, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { WeaknessService, type WeaknessReport } from '@/services/weaknessService'
import { useTranslation } from '@/i18n'

/** Lecture: set on the page under a rule with a serif title. Lab: a hairline panel with a mono label bar. */
const PANEL =
  'lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:shadow-none'
const PANEL_HEAD = 'lecture:px-0 lab:border-b lab:px-3.5 lab:py-2.5'
const PANEL_TITLE =
  'flex items-center gap-2 text-base lecture:font-heading lecture:text-lg lecture:font-bold lab:font-mono lab:text-[11px] lab:font-normal lab:uppercase lab:tracking-wider lab:text-muted-foreground'

export interface WeaknessPanelProps {
  projectId: string
  onReview?: () => void
  /** Compact mode is used on the dashboard. */
  compact?: boolean
}

/**
 * "Areas that may need review" — deliberately non-judgemental wording.
 */
export function WeaknessPanel({ projectId, onReview, compact }: WeaknessPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [report, setReport] = useState<WeaknessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await new WeaknessService().analyze(projectId, { limit: compact ? 4 : 8 })
        if (!cancelled) setReport(data)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, compact])

  if (loading) return <LoadingState label={t('weakness.checking')} inline />

  if (error) {
    return (
      <Card className={PANEL}>
        <CardHeader className="lecture:px-0 lab:px-3.5 lab:py-2.5">
          <CardTitle className={PANEL_TITLE}>
            <BookOpenCheck className="h-4 w-4 lecture:hidden lab:h-3.5 lab:w-3.5" />
            {t('weakness.title')}
          </CardTitle>
          <CardDescription>{t('weakness.unavailable')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!report || report.areas.length === 0) {
    return (
      <Card className={PANEL}>
        <CardHeader className="lecture:px-0 lab:px-3.5 lab:py-2.5">
          <CardTitle className={PANEL_TITLE}>
            <BookOpenCheck className="h-4 w-4 lecture:hidden lab:h-3.5 lab:w-3.5" />
            {t('weakness.title')}
          </CardTitle>
          <CardDescription>{t('weakness.none')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={PANEL}>
      <CardHeader className={`flex flex-row items-start justify-between space-y-0 ${PANEL_HEAD}`}>
        <div>
          <CardTitle className={PANEL_TITLE}>
            <BookOpenCheck className="h-4 w-4 lecture:hidden lab:h-3.5 lab:w-3.5" />
            {t('weakness.title')}
          </CardTitle>
          <CardDescription>
            {t('weakness.summary', { count: report.totalMistakes })}
          </CardDescription>
        </div>
        {onReview && (
          <Button variant="outline" size="sm" onClick={onReview}>
            {t('weakness.reviewNow')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 lecture:space-y-0 lecture:divide-y lecture:border-t lecture:px-0 lecture:pb-0 lab:space-y-0 lab:divide-y lab:p-0">
        {report.areas.map((area) => (
          <div key={area.knowledgePoint} className="space-y-1 lecture:py-3 lab:px-3.5 lab:py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{area.knowledgePoint}</span>
              <Badge variant="outline">{t('weakness.count', { count: area.mistakeCount })}</Badge>
              {area.mastery !== null && (
                <Badge variant="secondary">
                  {t('weakness.mastery', { value: `${Math.round(area.mastery * 100)}%` })}
                </Badge>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground lab:font-mono">
                {Math.round(area.weaknessScore * 100)}%
              </span>
            </div>
            <Progress
              value={area.weaknessScore * 100}
              className="h-1.5 lecture:h-1 lab:h-1 lab:rounded-none"
            />
            {area.recentMistakeCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('weakness.recent', { count: area.recentMistakeCount })}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
