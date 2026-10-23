import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Sparkles, Timer, Trash2 } from 'lucide-react'
import type { HomeworkSet } from '@/entities/homework/types'
import { structureReport } from '@/entities/exam/mockPaper'
import type { AiMockPaperService } from '@/services/aiMockPaperService'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import { withExamReturn } from '@/features/studyPlan/examReturn'

/**
 * The AI 模拟卷 written in the style of one past paper, listed under its card
 * on the homework page: take it, see / continue its build, delete it.
 */
export function AiMockRows({
  projectId,
  sets,
  service,
  onOpen,
  onChanged,
  fromExam,
  percentOf,
}: {
  projectId: string
  sets: HomeworkSet[]
  service: AiMockPaperService | null
  onOpen: (setId: string) => void
  onChanged: () => void
  /** Listed in a 考试工作台: the mock exam returns there. */
  fromExam?: string
  /** The latest checked result of a paper (0–100), when known. */
  percentOf?: (setId: string) => number | undefined
}): JSX.Element | null {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState<HomeworkSet | null>(null)
  if (sets.length === 0) return null
  return (
    <div className="space-y-1.5 border-t pt-3 lecture:border-t-0 lecture:pt-0" data-ai-mock-rows>
      <p className="text-xs font-medium text-muted-foreground">{t('aiMock.listTitle')}</p>
      <ul className="space-y-1.5">
        {sets.map((set) => {
          const info = set.exam?.aiMock
          const report = info ? structureReport(info) : null
          return (
            <li key={set.id} className="space-y-1 text-sm" data-ai-mock-row={set.status}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {t('aiMock.badge')}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{set.title}</span>
                {info && (
                  <span className="text-xs text-muted-foreground">
                    {t(`aiMock.difficulty.${info.config.difficulty}` as const)}
                  </span>
                )}
                {percentOf?.(set.id) !== undefined && (
                  <span className="text-xs tabular-nums" data-ai-mock-score>
                    {t('examWorkspace.lastScore', { percent: percentOf(set.id)! })}
                  </span>
                )}
              </div>
              {report && report.missing.length > 0 && set.status === 'ready' && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t('aiMock.missingSummary', {
                    missing: report.missing.length,
                    planned: report.planned,
                  })}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {set.status === 'ready' ? (
                  <Button asChild size="sm">
                    <Link
                      to={withExamReturn(
                        `/projects/${projectId}/homework/${set.id}/exam`,
                        fromExam,
                      )}
                    >
                      <Timer className="h-4 w-4" aria-hidden />
                      {t('aiMock.take')}
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onOpen(set.id)}>
                    <ListChecks className="h-4 w-4" aria-hidden />
                    {t(set.status === 'failed' ? 'aiMock.viewFailed' : 'aiMock.viewProgress')}
                  </Button>
                )}
                {set.status === 'ready' && (
                  <Button size="sm" variant="ghost" onClick={() => onOpen(set.id)}>
                    {t('aiMock.viewReport')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('aiMock.delete', { title: set.title })}
                  disabled={!service || service.isRunning(set.id)}
                  onClick={() => setDeleting(set)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('aiMock.deleteTitle')}
        description={t('aiMock.deleteHint', { title: deleting?.title ?? '' })}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={async () => {
          const target = deleting
          setDeleting(null)
          if (!service || !target) return
          try {
            await service.deletePaper(target.id, projectId)
            onChanged()
          } catch (err) {
            toast({ variant: 'error', title: friendlyAIError(err) })
          }
        }}
      />
    </div>
  )
}
