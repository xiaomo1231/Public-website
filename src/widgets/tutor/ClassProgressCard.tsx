import { useState } from 'react'
import { Check, Circle, ChevronDown, ChevronUp, GraduationCap } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Progress } from '@/shared/ui/Progress'
import { cn } from '@/shared/lib/utils'
import type { CourseContext } from '@/entities/courseContext/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import { useTranslation } from '@/i18n'

export interface ClassProgressCardProps {
  topics: Topic[]
  context: CourseContext | null
}

/**
 * Where the professor's class has reached.
 *
 * This is *not* the learner's own progress, and it is never folded into the
 * lesson cache: updating it does not regenerate any teaching content.
 */
export function ClassProgressCard({ topics, context }: ClassProgressCardProps): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const progress = context?.classProgress
  if (!progress) return null

  const coveredIds = new Set([
    ...progress.completedTopicIds,
    ...(progress.currentTopicId ? [progress.currentTopicId] : []),
  ])
  const currentTopic = topics.find((topic) => topic.id === progress.currentTopicId)
  const covered = topics.filter((topic) => coveredIds.has(topic.id))
  const upcoming = topics.filter((topic) => !coveredIds.has(topic.id))
  // Prefer the textbook position over the teaching topic when it is known.
  const position = [
    progress.currentChapterNumber ?? progress.currentChapterTitle,
    progress.currentSectionNumber ?? progress.currentSectionTitle,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3" aria-label={t('classProgress.title')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {t('classProgress.title')}
        </span>
        {progress.progressPercent !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('classProgress.percent', { value: progress.progressPercent })}
          </span>
        )}
        {position && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {t('classProgress.currentPosition', { position })}
          </span>
        )}
        {currentTopic && (
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {t('classProgress.currently', { topic: currentTopic.name })}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
          {t('classProgress.details')}
        </Button>
      </div>

      {progress.progressPercent !== undefined && (
        <Progress value={progress.progressPercent} className="mt-2 h-1.5" />
      )}

      {open && (
        <div className="mt-3 space-y-2 text-xs">
          {progress.progressPercent === undefined && (
            <p className="text-muted-foreground">{t('classProgress.unavailable')}</p>
          )}
          {covered.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-foreground">{t('classProgress.covered')}</p>
              <ul className="space-y-0.5">
                {covered.map((topic) => (
                  <li
                    key={topic.id}
                    className={cn(
                      'flex items-start gap-1.5 text-muted-foreground',
                      topic.id === progress.currentTopicId && 'text-foreground',
                    )}
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {topic.name}
                      {topic.id === progress.currentTopicId
                        ? ` · ${t('classProgress.currentLabel')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-foreground">{t('classProgress.upcoming')}</p>
              <ul className="space-y-0.5">
                {upcoming.map((topic) => (
                  <li key={topic.id} className="flex items-start gap-1.5 text-muted-foreground">
                    <Circle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{topic.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
