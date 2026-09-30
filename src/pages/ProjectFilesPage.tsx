import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FolderOpen, Loader2, Trash2, Upload } from 'lucide-react'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { useDocuments } from '@/features/documents/useDocuments'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { toast } from '@/features/toast/toastStore'
import type { Document } from '@/entities/document/types'
import type { DocumentDeleteImpact } from '@/services/documentService'
import { useTranslation } from '@/i18n'

/**
 * Project files: every file uploaded to this project, regardless of the
 * learning-material role or processing state it was stored with.
 *
 * It exists because the "Learning Materials" tab only surfaces the three
 * tutor roles — homework and professor-practice files have their own pages and
 * were otherwise invisible here. Deleting goes through the document service so
 * derived data is cleaned up and student work is never silently destroyed.
 */
export function ProjectFilesPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()
  const { documents, loading, remove, rename } = useDocuments(projectId)
  const describeDelete = useDocumentsStore((s) => s.describeDelete)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [impact, setImpact] = useState<DocumentDeleteImpact | null>(null)
  const [deleting, setDeleting] = useState(false)

  const pid = projectId
  if (!pid) return <div />

  const handleRename = async (id: string, name: string): Promise<void> => {
    try {
      await rename(id, name)
      toast({ variant: 'success', title: t('documents.renamed') })
    } catch (err) {
      toast({ variant: 'error', title: t('documents.renameFailed'), description: (err as Error).message })
    }
  }

  const requestDelete = async (doc: Document): Promise<void> => {
    try {
      setImpact(await describeDelete(doc.id, pid))
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documents.deleteFailed'),
        description: (err as Error).message,
      })
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!impact) return
    setDeleting(true)
    try {
      await remove(impact.document.id)
      toast({ variant: 'success', title: t('documents.deleted') })
      setImpact(null)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documents.deleteFailed'),
        description: (err as Error).message,
      })
    } finally {
      setDeleting(false)
    }
  }

  const removes: string[] = impact
    ? [
        impact.removes.chunks > 0 ? t('files.removes.chunks', { count: impact.removes.chunks }) : '',
        impact.removes.courseStructures > 0 ? t('files.removes.structures') : '',
        impact.removes.visualSources > 0
          ? t('files.removes.visuals', { count: impact.removes.visualSources })
          : '',
        impact.removes.homeworkSets > 0 ? t('files.removes.homework') : '',
        impact.removes.practiceSets > 0 ? t('files.removes.practice') : '',
        impact.removes.slideLessons > 0
          ? t('files.removes.slides', { count: impact.removes.slideLessons })
          : '',
      ].filter((entry) => entry.length > 0)
    : []

  const blockedWork = impact
    ? [
        impact.studentWork.homeworkAnswers > 0 && t('files.deleteBlockedHomework'),
        impact.studentWork.practiceAttempts > 0 && t('files.deleteBlockedPractice'),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <PageContainer>
      <PageHeader
        icon={<FolderOpen className="h-5 w-5" />}
        title={t('files.title')}
        description={t('files.subtitle')}
        nav={<ProjectFlowNav projectId={pid} active="files" />}
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            {t('files.upload')}
          </Button>
        }
      />
      <PageContent>
        <DocumentList
          documents={documents}
          loading={loading}
          projectId={pid}
          onUploadClick={() => setUploadOpen(true)}
          onRename={handleRename}
          onDelete={async (id) => remove(id)}
          showMaterialType
          materialFilter
          onDeleteRequest={requestDelete}
        />
      </PageContent>

      <DocumentUploadDialog
        projectId={pid}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        allowMaterialSelect
      />

      <Dialog
        open={impact !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setImpact(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {impact?.blocked ? t('files.deleteBlockedTitle') : t('files.deleteTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('files.deleteIntro', { name: impact?.document.name ?? '' })}
            </DialogDescription>
          </DialogHeader>

          {impact?.blocked ? (
            <p className="text-sm text-muted-foreground">
              {t('files.deleteBlockedBody', { work: blockedWork })}
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <p className="font-medium">{t('files.deleteRemoves')}</p>
                {removes.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {removes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{t('files.removes.none')}</p>
                )}
              </div>
              <p className="text-muted-foreground">{t('files.deleteKeeps')}</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImpact(null)} disabled={deleting}>
              {impact?.blocked ? t('common.close') : t('common.cancel')}
            </Button>
            {!impact?.blocked && (
              <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t('files.deleteConfirm')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
