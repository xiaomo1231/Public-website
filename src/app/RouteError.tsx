import { useEffect } from 'react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Home, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ErrorState } from '@/shared/ui/ErrorState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { logger } from '@/infrastructure/logger/logger'
import { isAppError } from '@/infrastructure/errors/AppError'
import { useTranslation } from '@/i18n'

/**
 * Router `errorElement`: replaces react-router's English developer screen
 * with the app's localized error state and a way back. `fullScreen` is used
 * outside the app shell (no sidebar / header around it).
 */
export function RouteError({ fullScreen = false }: { fullScreen?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const error = useRouteError()

  useEffect(() => {
    logger.error('Route render failed', undefined, error)
  }, [error])

  const notFound = isRouteErrorResponse(error) && error.status === 404
  const detail = notFound
    ? t('common.pageNotFoundHint')
    : isAppError(error) && error.message
      ? error.message
      : t('common.pageErrorHint')

  const state = (
    <ErrorState
      title={notFound ? t('common.pageNotFound') : t('common.somethingWrong')}
      description={detail}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!notFound && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RotateCcw className="h-4 w-4" />
              {t('common.reloadPage')}
            </Button>
          )}
          <Button asChild>
            <Link to="/dashboard">
              <Home className="h-4 w-4" />
              {t('common.backHome')}
            </Link>
          </Button>
        </div>
      }
    />
  )

  if (fullScreen) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-md">{state}</div>
      </div>
    )
  }
  return (
    <PageContainer>
      <PageContent>{state}</PageContent>
    </PageContainer>
  )
}

/** Signed-in fallback for addresses that match no page. */
export function NotFoundPage(): JSX.Element {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageContent>
        <ErrorState
          title={t('common.pageNotFound')}
          description={t('common.pageNotFoundHint')}
          action={
            <Button asChild>
              <Link to="/dashboard">
                <Home className="h-4 w-4" />
                {t('common.backHome')}
              </Link>
            </Button>
          }
        />
      </PageContent>
    </PageContainer>
  )
}
