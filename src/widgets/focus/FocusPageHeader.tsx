import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { useExamReturn } from '@/features/studyPlan/examReturn'

export interface FocusPageHeaderProps {
  /**
   * Where "back" goes (the parent list or course page). Omitted only while a
   * timed exam is being written, where leaving is done by handing in.
   */
  backTo?: string
  /** Name of the parent page, e.g. 作业. */
  backLabel?: string
  /** The page title (homework file, quiz, topic…). */
  title: ReactNode
  /** Short context after the title, e.g. "8 道题". */
  meta?: ReactNode
  /** The page's own toolbar, kept on the right. */
  actions?: ReactNode
  className?: string
}

/**
 * Header of a 专注子页面 (homework, mock exam, quiz, lesson, interactive tutor,
 * interview session). Replaces the title block + course navigation with one
 * compact row: 「← 作业 / HW4.pdf · 8 道题」 and the page's toolbar, so the
 * learning area starts right under it. The back link sits in its own
 * navigation landmark, so keyboard and screen-reader users still have a way
 * out where the course navigation was removed.
 */
export function FocusPageHeader({
  backTo,
  backLabel,
  title,
  meta,
  actions,
  className,
}: FocusPageHeaderProps): JSX.Element {
  const { t } = useTranslation()
  // Opened from a 考试工作台 (`?fromExam=`): back leads to that exam.
  const examReturn = useExamReturn()
  const backHref = backTo && examReturn ? examReturn.to : backTo
  const backText = backTo && examReturn ? examReturn.label : backLabel
  return (
    <header
      data-focus-header
      className={cn(
        'flex flex-col gap-1 border-b px-4 py-1.5 lab:bg-card/80 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 lg:px-8',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {backHref && backText ? (
          <>
            <nav aria-label={t('focus.backNav')} className="min-w-0 shrink-0">
              <Link
                to={backHref}
                data-focus-back
                {...(examReturn && backTo ? { 'data-exam-return': examReturn.examId } : {})}
                className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground lecture:rounded-none lab:rounded-sm"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                <span className="sr-only">{t('focus.backPrefix')}</span>
                {backText}
              </Link>
            </nav>
            <span aria-hidden className="text-muted-foreground/70">
              /
            </span>
          </>
        ) : null}
        <h1 className="min-w-0 truncate font-heading text-[15px] font-semibold leading-tight text-foreground lecture:text-base lab:text-sm">
          {title}
        </h1>
        {meta ? (
          <span className="hidden min-w-0 shrink truncate text-sm text-muted-foreground lab:font-mono lab:text-xs sm:inline">
            <span aria-hidden>· </span>
            {meta}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end [&>*]:min-w-0 [&>*]:max-w-full">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
