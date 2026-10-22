import { FileText, Monitor, PenLine } from 'lucide-react'
import { EXAM_ANSWER_MODES, type ExamAnswerMode } from '@/entities/exam/types'
import { cn } from '@/shared/lib/utils'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { useTranslation, type TranslationKey } from '@/i18n'

const ICONS = { online: Monitor, paper: FileText, tablet: PenLine } as const

/**
 * How the mock exam is answered, chosen before the timer starts:
 * 在网站上作答 / 只看题目·纸上作答·拍照上传 / 平板直接在卷面手写.
 */
export function ExamModeChooser({
  value,
  onChange,
  disabled = false,
}: {
  value: ExamAnswerMode
  onChange: (mode: ExamAnswerMode) => void
  disabled?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium" id="exam-mode-label">
        {t('examMode.label')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="exam-mode-label"
        className="grid gap-2 sm:grid-cols-3"
        data-exam-mode-chooser
      >
        {EXAM_ANSWER_MODES.map((mode, index) => {
          const Icon = ICONS[mode]
          const selected = mode === value
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              data-exam-mode={mode}
              disabled={disabled}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(mode)}
              onKeyDown={(event) => onRadioKeyDown(event, EXAM_ANSWER_MODES, index, onChange)}
              className={cn(
                'focus-ring flex min-h-11 flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition-colors duration-150 hover:bg-muted disabled:opacity-60 lecture:rounded-none lab:rounded-none',
                selected && 'border-primary ring-1 ring-primary',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4" aria-hidden />
                {t(`examMode.${mode}` as TranslationKey)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`examMode.${mode}Hint` as TranslationKey)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('examMode.recognitionNote')}</p>
    </div>
  )
}
