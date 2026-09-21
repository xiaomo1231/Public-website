import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { BookOpen, Mic, NotebookPen, type LucideIcon } from 'lucide-react'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { useDocuments } from '@/features/documents/useDocuments'
import { toast } from '@/features/toast/toastStore'
import {
  resolveMaterialType,
  type Document,
  type LearningMaterialType,
} from '@/entities/document/types'
import { useTranslation, type TranslationKey } from '@/i18n'

interface MaterialGroupSpec {
  type: LearningMaterialType
  icon: LucideIcon
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  uploadKey: TranslationKey
  emptyKey: TranslationKey
}

const GROUPS: readonly MaterialGroupSpec[] = [
  {
    type: 'textbook',
    icon: BookOpen,
    titleKey: 'materials.textbook.title',
    descriptionKey: 'materials.textbook.description',
    uploadKey: 'materials.textbook.upload',
    emptyKey: 'materials.textbook.empty',
  },
  {
    type: 'user_notes',
    icon: NotebookPen,
    titleKey: 'materials.notes.title',
    descriptionKey: 'materials.notes.description',
    uploadKey: 'materials.notes.upload',
    emptyKey: 'materials.notes.empty',
  },
  {
    type: 'lecture_transcript',
    icon: Mic,
    titleKey: 'materials.transcript.title',
    descriptionKey: 'materials.transcript.description',
    uploadKey: 'materials.transcript.upload',
    emptyKey: 'materials.transcript.empty',
  },
]

/**
 * The three learning-material entrances.
 *
 * The three roles are kept visually and structurally separate — they are not
 * one mixed document list — because the tutor treats them very differently.
 */
export function ProjectDocumentsTab({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const { documents, loading, remove, rename } = useDocuments(projectId)
  const [openType, setOpenType] = useState<LearningMaterialType | null>(null)

  function docsOf(type: LearningMaterialType): Document[] {
    return documents.filter((doc) => resolveMaterialType(doc.materialType) === type)
  }

  async function handleRename(id: string, name: string) {
    try {
      await rename(id, name)
      toast({ variant: 'success', title: t('documents.renamed') })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documents.renameFailed'),
        description: (err as Error).message,
      })
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove(id)
      toast({ variant: 'success', title: t('documents.deleted') })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documents.deleteFailed'),
        description: (err as Error).message,
      })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t('materials.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('materials.subtitle')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((group) => {
          const docs = docsOf(group.type)
          const Icon = group.icon
          const ready = docs.filter((doc) => doc.status === 'ready').length
          return (
            <Card key={group.type} className="flex min-w-0 flex-col">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 break-words">{t(group.titleKey)}</span>
                </CardTitle>
                <CardDescription className="break-words">
                  {t(group.descriptionKey)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
                {docs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t(group.emptyKey)}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {t('materials.fileCount', { count: docs.length })}
                    </Badge>
                    <Badge variant={ready === docs.length ? 'secondary' : 'outline'}>
                      {ready === docs.length
                        ? t('materials.analyzed')
                        : t('materials.processing')}
                    </Badge>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <DocumentList
                    documents={docs}
                    loading={loading}
                    projectId={projectId}
                    onUploadClick={() => setOpenType(group.type)}
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                </div>

                <Button variant="outline" className="w-full" onClick={() => setOpenType(group.type)}>
                  <Icon className="h-4 w-4" />
                  {t(group.uploadKey)}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <DocumentUploadDialog
        projectId={projectId}
        open={openType !== null}
        onOpenChange={(next) => {
          if (!next) setOpenType(null)
        }}
        materialType={openType ?? 'textbook'}
      />
    </div>
  )
}

export function ProjectDocumentsRoute(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  if (!id) return <div />
  return <ProjectDocumentsTab projectId={id} />
}
