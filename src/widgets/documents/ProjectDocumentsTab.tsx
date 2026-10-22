import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, FolderOpen, Mic, NotebookPen, type LucideIcon } from 'lucide-react'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { materialGroupStatus } from '@/widgets/documents/materialGroupStatus'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useUiStyle } from '@/features/theme/useAppearance'
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
  const lab = useUiStyle().uiStyle === 'lab'
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
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-base font-semibold lecture:text-[21px] lecture:font-bold lab:text-[15px]">
            {t('materials.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('materials.subtitle')}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <Link to={`/projects/${projectId}/files`}>
            <FolderOpen className="h-4 w-4" />
            {t('files.openAll')}
          </Link>
        </Button>
      </div>

      <div className="stagger-in grid gap-x-8 gap-y-8 lab:gap-4 lg:lecture:grid-cols-3">
        {GROUPS.map((group) => {
          const docs = docsOf(group.type)
          const Icon = group.icon
          const status = materialGroupStatus(docs)
          const upload = (
            <Button
              variant="outline"
              size="sm"
              className={lab ? 'shrink-0' : 'self-start'}
              onClick={() => setOpenType(group.type)}
            >
              <Icon className="h-4 w-4" />
              {t(group.uploadKey)}
            </Button>
          )
          return (
            <section
              key={group.type}
              aria-labelledby={`materials-${group.type}`}
              className={cn(
                'flex min-w-0 flex-col',
                // lecture: a ruled section, no box.
                'lecture:gap-3 lecture:border-t-[1.5px] lecture:border-foreground lecture:pt-4',
                // lab: a hairline panel with a header bar.
                'lab:border lab:border-border lab:bg-card',
              )}
            >
              <header className="flex min-w-0 flex-col gap-1 lab:border-b lab:border-border lab:px-3.5 lab:py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <h3
                    id={`materials-${group.type}`}
                    className="min-w-0 flex-1 break-words font-heading text-foreground lecture:text-[18px] lecture:font-bold lab:font-mono lab:text-[11px] lab:font-medium lab:uppercase lab:tracking-[0.06em] lab:text-muted-foreground"
                  >
                    {t(group.titleKey)}
                    {lab && docs.length > 0 && (
                      <span className="data-num ml-1.5 text-muted-foreground">/ {docs.length}</span>
                    )}
                  </h3>
                  {lab && upload}
                </div>
                <p className="break-words text-[13px] text-muted-foreground lab:text-[11px]">
                  {t(group.descriptionKey)}
                </p>
                {docs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t(group.emptyKey)}</p>
                ) : (
                  <p className="data-num flex flex-wrap items-center gap-x-1.5 text-xs">
                    <span className="text-muted-foreground lab:font-mono">
                      {t('materials.fileCount', { count: docs.length })}
                    </span>
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                    <span
                      className={cn(
                        'lab:font-mono',
                        status.kind === 'ready'
                          ? 'text-primary'
                          : status.kind === 'failed' || status.kind === 'partial'
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {status.kind === 'ready'
                        ? t('materials.analyzed')
                        : status.kind === 'failed'
                          ? t('materials.failed')
                          : status.kind === 'partial'
                            ? t('materials.partFailed', { count: status.failed })
                            : t('materials.processing')}
                    </span>
                  </p>
                )}
              </header>

              {/* An empty group already says so above and offers its upload
                  button; the list's own empty card would only repeat it. */}
              {(loading || docs.length > 0) && (
                <div className="min-w-0 flex-1 lab:p-3.5">
                  <DocumentList
                    documents={docs}
                    loading={loading}
                    projectId={projectId}
                    onUploadClick={() => setOpenType(group.type)}
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                </div>
              )}

              {!lab && upload}
            </section>
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
