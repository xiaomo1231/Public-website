import { Link, Outlet, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useProject } from '@/features/project/useProjects'
import { useProjectStore } from '@/features/project/projectStore'
import { Button } from '@/shared/ui/Button'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent } from '@/shared/ui/Page'
import { useTranslation } from '@/i18n'

/**
 * Layout route for every project sub-page (`/projects/:id/...`).
 *
 * Pages under it can assume the course exists: an unknown or deleted project
 * id shows one consistent "course not found" state instead of each page
 * rendering its own empty landing ("No homework yet — upload…") as if the
 * course were real. The project list is already cached by the project store,
 * so this adds no extra database reads on normal navigation.
 */
export function ProjectScope(): JSX.Element {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const { project, loading } = useProject(id)
  const listError = useProjectStore((s) => s.error)
  const reload = useProjectStore((s) => s.load)

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('projectDetail.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (!project) {
    const failed = Boolean(listError)
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={failed ? t('errors.failedToLoadProjects') : t('projectDetail.notFound')}
            description={failed ? listError : t('projectDetail.notFoundHint')}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {failed && (
                  <Button variant="outline" onClick={() => void reload()}>
                    {t('common.tryAgain')}
                  </Button>
                )}
                <Button asChild>
                  <Link to="/projects">
                    <ArrowLeft className="h-4 w-4" />
                    {t('projectDetail.backToProjects')}
                  </Link>
                </Button>
              </div>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  return <Outlet />
}
