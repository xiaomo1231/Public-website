import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { Button } from '@/shared/ui/Button'
import { Plus, Upload } from 'lucide-react'
import { useDocuments } from '@/features/documents/useDocuments'
import { toast } from '@/features/toast/toastStore'

export function ProjectDocumentsTab({ projectId }: { projectId: string }): JSX.Element {
  const { documents, loading, remove, rename } = useDocuments(projectId)
  const [open, setOpen] = useState(false)

  async function handleRename(id: string, name: string) {
    try {
      await rename(id, name)
      toast({ variant: 'success', title: 'Document renamed' })
    } catch (err) {
      toast({ variant: 'error', title: 'Rename failed', description: (err as Error).message })
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove(id)
      toast({ variant: 'success', title: 'Document deleted' })
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: (err as Error).message })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Content Library</h2>
          <p className="text-sm text-muted-foreground">
            Upload PDFs, slides, images, or paste text. Files are processed locally.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Upload
        </Button>
      </div>

      <DocumentList
        documents={documents}
        loading={loading}
        projectId={projectId}
        onUploadClick={() => setOpen(true)}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      <DocumentUploadDialog projectId={projectId} open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function ProjectDocumentsRoute(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  if (!id) return <div />
  return <ProjectDocumentsTab projectId={id} />
}

// Suppress unused-import warning for icon
void Upload