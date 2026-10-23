import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FolderOpen, Upload } from 'lucide-react'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { useFileActions } from '@/widgets/documents/useFileActions'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { Button } from '@/shared/ui/Button'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { useDocuments } from '@/features/documents/useDocuments'
import { useDocumentSelection } from '@/features/documents/useDocumentSelection'
import { useTranslation } from '@/i18n'

/**
 * Project files: every file uploaded to this project, regardless of the
 * learning-material role or processing state it was stored with.
 *
 * It exists because the "Learning Materials" tab only surfaces the three
 * tutor roles — homework and professor-practice files have their own pages and
 * were otherwise invisible here. Deleting goes through the document service so
 * derived data is cleaned up and student work is never silently destroyed.
 * Rows can be multi-selected for the batch actions (2o).
 */
export function ProjectFilesPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId } = useParams<{ id: string }>()
  const { documents, loading, remove } = useDocuments(projectId)
  const actions = useFileActions(documents)
  const selection = useDocumentSelection()
  const [uploadOpen, setUploadOpen] = useState(false)

  const { prune } = selection
  useEffect(() => {
    prune(documents.map((doc) => doc.id))
  }, [documents, prune])

  const pid = projectId
  if (!pid) return <div />

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
          onRename={async (id, name) => {
            const doc = documents.find((d) => d.id === id)
            if (doc) await actions.rename(doc, name)
          }}
          onDelete={async (id) => remove(id)}
          showMaterialType
          materialFilter
          onDeleteRequest={actions.requestDelete}
          groupFolders
          onMoveToFolder={actions.requestMove}
          onChangeMaterialType={actions.requestMaterialType}
          selection={selection}
        />
      </PageContent>

      <DocumentUploadDialog
        projectId={pid}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        allowMaterialSelect
      />
      {actions.dialogs}
    </PageContainer>
  )
}
