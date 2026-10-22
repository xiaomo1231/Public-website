import { Link } from 'react-router-dom'
import { AlertCircle, Loader2, RefreshCw, Settings } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface TutorErrorNoticeProps {
  /** Optional one-line heading above the cause ("Couldn't refresh the lesson"). */
  title?: string
  /** The plain-language cause (from `tutorErrorInfo`). */
  message: string
  /** What is on screen meanwhile ("Showing the previously saved lesson."). */
  note?: string
  /** Offer "Open settings" — the fix lives in the AI configuration. */
  needsSettings?: boolean
  onRetry?: () => void
  retryLabel?: string
  retrying?: boolean
  /** `warning`: something readable is still on screen; `error`: nothing is. */
  tone?: 'error' | 'warning'
  className?: string
}

/**
 * One error notice for the tutor's lesson and interactive pages: the cause,
 * then what the student can do about it (try again / open settings). AGENTS
 * principle 6: never a bare "something went wrong".
 */
export function TutorErrorNotice({
  title,
  message,
  note,
  needsSettings = false,
  onRetry,
  retryLabel,
  retrying = false,
  tone = 'error',
  className,
}: TutorErrorNoticeProps): JSX.Element {
  const { t } = useTranslation()
  const warning = tone === 'warning'
  return (
    <div
      role={warning ? 'status' : 'alert'}
      className={cn(
        'space-y-3 rounded-lg border px-4 py-3.5 lab:rounded-none',
        warning
          ? 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20'
          : 'border-destructive/40 bg-destructive/5',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            warning ? 'text-amber-700 dark:text-amber-300' : 'text-destructive',
          )}
          aria-hidden
        />
        <div className="min-w-0 space-y-0.5 text-sm">
          {title && (
            <p
              className={cn(
                'font-medium',
                warning ? 'text-amber-900 dark:text-amber-200' : 'text-destructive',
              )}
            >
              {title}
            </p>
          )}
          <p
            className={cn(
              'break-words',
              warning
                ? 'text-amber-800 dark:text-amber-300/90'
                : title
                  ? 'text-foreground'
                  : 'text-destructive',
            )}
          >
            {message}
          </p>
          {note && (
            <p
              className={
                warning ? 'text-amber-800 dark:text-amber-300/90' : 'text-muted-foreground'
              }
            >
              {note}
            </p>
          )}
        </div>
      </div>
      {(onRetry || needsSettings) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {retryLabel ?? t('common.retry')}
            </Button>
          )}
          {needsSettings && (
            <Button asChild variant={onRetry ? 'ghost' : 'outline'} size="sm">
              <Link to="/settings">
                <Settings />
                {t('tutor.openSettings')}
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
