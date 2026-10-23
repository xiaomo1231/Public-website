import { Layers } from 'lucide-react'
import type { DuplicateChoice, UploadQueueItem } from '@/features/documents/batchUpload'
import type { QueuePhotoGroup } from '@/features/documents/useBatchUpload'
import { useTranslation } from '@/i18n'
import { isUndecidedDuplicate } from './uploadQueueText'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/Button'

/**
 * Upload-queue extras shared by every upload entrance (the upload dialog and
 * the exam materials picker): 上传重复文件可选 (跳过 / 覆盖 / 保留两份, 全部…)
 * and 考卷照片合并 (one 「合并成一份试卷」 switch per photo group).
 */

export function DuplicateChoiceControl({
  item,
  onChoose,
  disabled,
}: {
  item: UploadQueueItem
  onChoose: (choice: DuplicateChoice) => void
  disabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const current = item.duplicateChoice ?? 'skip'
  const options: DuplicateChoice[] = item.duplicateOf
    ? ['skip', 'replace', 'keep']
    : ['skip', 'keep']
  const label: Record<DuplicateChoice, string> = {
    skip: t('batch.duplicate.skip'),
    replace: t('batch.duplicate.replace'),
    keep: t('batch.duplicate.keep'),
  }
  return (
    <div
      role="group"
      aria-label={t('batch.duplicate.choiceLabel', { name: item.name })}
      className="inline-flex shrink-0 overflow-hidden rounded-md border lab:rounded-none"
      data-duplicate-choice={current}
    >
      {options.map((choice) => (
        <button
          key={choice}
          type="button"
          disabled={disabled}
          aria-pressed={current === choice}
          onClick={() => onChoose(choice)}
          data-choice={choice}
          className={cn(
            'focus-ring min-h-8 px-2 text-xs transition-colors coarse:min-h-11 coarse:px-3',
            'border-l first:border-l-0',
            current === choice
              ? 'bg-primary-strong text-primary-foreground'
              : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {label[choice]}
        </button>
      ))}
    </div>
  )
}

export function DuplicateBulkNotice({
  items,
  onAll,
}: {
  items: readonly UploadQueueItem[]
  onAll: (choice: DuplicateChoice) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const duplicates = items.filter(isUndecidedDuplicate)
  if (duplicates.length === 0) return null
  const canReplace = duplicates.some((item) => item.duplicateOf)
  return (
    <div
      data-duplicate-notice
      className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-50/50 px-3 py-2 text-xs lab:rounded-none dark:bg-amber-950/20"
    >
      <p>{t('batch.duplicate.notice', { count: duplicates.length })}</p>
      {canReplace && <p className="text-muted-foreground">{t('batch.duplicate.replaceHint')}</p>}
      {duplicates.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="coarse:min-h-11"
            onClick={() => onAll('skip')}
          >
            {t('batch.duplicate.allSkip')}
          </Button>
          {canReplace && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="coarse:min-h-11"
              onClick={() => onAll('replace')}
            >
              {t('batch.duplicate.allReplace')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function PhotoGroupNotices({
  groups,
  onToggle,
}: {
  groups: readonly QueuePhotoGroup[]
  onToggle: (key: string, merge: boolean) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (groups.length === 0) return null
  return (
    <div className="space-y-1.5" data-photo-groups>
      {groups.map((group) => {
        const id = `merge-${group.ids[0] ?? group.key}`
        return (
          <label
            key={group.key}
            htmlFor={id}
            data-photo-group={group.name}
            className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs lab:rounded-none coarse:min-h-11"
          >
            <input
              id={id}
              type="checkbox"
              checked={group.merge}
              onChange={(event) => onToggle(group.key, event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary coarse:h-5 coarse:w-5"
            />
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block font-medium">
                {t('batch.merge.toggle')} ·{' '}
                {t('batch.merge.notice', { count: group.ids.length, name: group.name })}
              </span>
              <span className="block text-muted-foreground">
                {t('batch.merge.order', {
                  from: group.numbers[0] ?? '',
                  to: group.numbers[group.numbers.length - 1] ?? '',
                })}
                {' · '}
                {t('batch.merge.hint')}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
