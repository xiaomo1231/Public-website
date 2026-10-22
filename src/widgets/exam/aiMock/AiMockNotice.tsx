import { Sparkles } from 'lucide-react'
import type { MockStructureReport } from '@/entities/exam/mockPaper'
import { useTranslation } from '@/i18n'

/**
 * The header of an AI 模拟卷: what it is (written in the style of past papers,
 * not a prediction) and that its answers and marking are the platform's.
 * `detailed` adds the questions the paper is missing (dropped or not written).
 */
export function AiMockNotice({
  report,
  detailed = true,
}: {
  report: MockStructureReport
  detailed?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="space-y-1 rounded-md border border-dashed p-3 text-sm lab:rounded-none"
      data-ai-mock-notice
    >
      <p className="flex items-center gap-2 font-medium">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        {t('aiMock.disclaimer')}
      </p>
      <p className="text-xs text-muted-foreground">{t('aiMock.platformNote')}</p>
      {detailed && report.missing.length > 0 && (
        <div className="pt-1 text-xs text-amber-700 dark:text-amber-400" data-ai-mock-missing>
          <p>
            {t('aiMock.missingSummary', {
              missing: report.missing.length,
              planned: report.planned,
            })}
            {report.marks
              ? ` ${t('aiMock.missingMarks', {
                  present: report.marks.present,
                  planned: report.marks.planned,
                })}`
              : ''}
          </p>
          <ul className="list-disc pl-5">
            {report.missing.map((slot) => (
              <li key={slot.slotId}>
                {t('aiMock.missingSlot', { label: slot.label })}
                {slot.marks !== undefined
                  ? ` · ${t('mockExam.marksBadge', { marks: slot.marks })}`
                  : ''}
                {slot.reason ? ` · ${slot.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
