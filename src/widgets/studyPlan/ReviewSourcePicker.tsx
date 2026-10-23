import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { REVIEW_SOURCE_GROUPS, type ReviewSourceGroup } from '@/entities/studyPlan/reviewOutline'
import type { ReviewSourceOption } from '@/services/examReviewService'
import { useTranslation, type TranslationKey } from '@/i18n'

const GROUP_KEYS: Record<ReviewSourceGroup, TranslationKey> = {
  lecture: 'plan.review.sources.group.lecture',
  past: 'plan.review.sources.group.past',
  answers: 'plan.review.sources.group.answers',
  homework: 'plan.review.sources.group.homework',
  practice: 'plan.review.sources.group.practice',
  notes: 'plan.review.sources.group.notes',
  reading: 'plan.review.sources.group.reading',
  syllabus: 'plan.review.sources.group.syllabus',
}

/**
 * 用哪些资料: the course's files grouped by role, one checkbox each, with
 * all / none per group. Every change is reported at once (the caller stores
 * it on the review).
 */
export function ReviewSourcePicker({
  options,
  selected,
  disabled = false,
  onChange,
}: {
  options: ReviewSourceOption[]
  selected: string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}): JSX.Element {
  const { t } = useTranslation()
  const baseId = useId()
  const chosen = new Set(selected)
  const count = options.filter((option) => chosen.has(option.id)).length

  if (options.length === 0)
    return <p className="text-sm text-muted-foreground">{t('plan.review.sources.empty')}</p>

  const setGroup = (ids: string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(options.filter((option) => next.has(option.id)).map((option) => option.id))
  }

  return (
    <div className="space-y-3" data-review-sources>
      <p className="text-xs text-muted-foreground">{t('plan.review.sources.hint')}</p>
      <p className="text-xs tabular-nums text-muted-foreground" data-review-sources-count>
        {t('plan.review.sources.count', { count, total: options.length })}
      </p>
      {REVIEW_SOURCE_GROUPS.map((group) => {
        const files = options.filter((option) => option.group === group)
        if (files.length === 0) return null
        const ids = files.map((file) => file.id)
        const headingId = `${baseId}-${group}`
        return (
          <fieldset
            key={group}
            className="space-y-1 border-t pt-2 lab:border-border"
            aria-labelledby={headingId}
            data-review-source-group={group}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span id={headingId} className="flex-1 text-sm font-medium">
                {t(GROUP_KEYS[group])}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setGroup(ids, true)}
              >
                {t('plan.review.sources.all')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setGroup(ids, false)}
              >
                {t('plan.review.sources.none')}
              </Button>
            </div>
            <ul className="space-y-0.5">
              {files.map((file) => {
                const id = `${baseId}-${file.id}`
                return (
                  <li key={file.id}>
                    <label
                      htmlFor={id}
                      className={cn(
                        'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-1 text-sm hover:bg-muted/60 lab:rounded-none coarse:min-h-11',
                        disabled && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary coarse:h-5 coarse:w-5"
                        checked={chosen.has(file.id)}
                        disabled={disabled}
                        onChange={(event) => setGroup([file.id], event.target.checked)}
                        data-review-source={file.id}
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {file.folderPath ? (
                          <span className="text-muted-foreground">{file.folderPath} / </span>
                        ) : null}
                        {file.name}
                      </span>
                      {file.inExam && (
                        <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground lab:rounded-none lab:font-mono">
                          {t('plan.review.sources.inExam')}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )
      })}
    </div>
  )
}
