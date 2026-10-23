import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog'
import type { CourseOptions, ExamWorkspaceView } from '@/services/studyPlanService'
import { useDocuments } from '@/features/documents/useDocuments'
import { useDocumentSelection } from '@/features/documents/useDocumentSelection'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { toast } from '@/features/toast/toastStore'
import { normalizeMaterials, resolveExamDocuments } from '@/entities/studyPlan/materials'
import type { PlannedExamMaterials } from '@/entities/studyPlan/types'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { useFileActions } from '@/widgets/documents/useFileActions'
import { ExamMaterialsPicker } from '@/widgets/studyPlan/ExamMaterialsPicker'
import { DocumentDetailPage } from '@/pages/DocumentDetailPage'
import { useTranslation } from '@/i18n'
import { TabSection } from './TabSection'

/** `/projects/:id/documents/:did` → the document id (a row link of `DocumentList`). */
function documentIdFromHref(href: string, projectId: string): { id: string; page?: number } | null {
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return null
  }
  const match = url.pathname.match(/^\/projects\/([^/]+)\/documents\/([^/]+)\/?$/)
  if (!match || decodeURIComponent(match[1]!) !== projectId) return null
  const page = Number(url.searchParams.get('page'))
  return {
    id: decodeURIComponent(match[2]!),
    ...(Number.isInteger(page) && page > 0 ? { page } : {}),
  }
}

/**
 * 资料: the files and folders picked for this exam, the course's other files,
 * uploads (files or whole folders; new files join the exam), and the multi-
 * select batch actions of the course file list. Opening a file shows it in a
 * dialog here instead of leaving the workspace.
 */
export function MaterialsTab({
  view,
  onChanged,
}: {
  view: ExamWorkspaceView
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { exam } = view.context
  const pid = exam.projectId
  const { documents, loading, remove } = useDocuments(pid)
  const actions = useFileActions(documents)
  const examSelection = useDocumentSelection()
  const otherSelection = useDocumentSelection()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [options, setOptions] = useState<CourseOptions | null>(null)
  const [draft, setDraft] = useState<PlannedExamMaterials>(() => normalizeMaterials(exam.materials))
  const [saving, setSaving] = useState(false)
  const [opened, setOpened] = useState<{ id: string; page?: number } | null>(null)
  const uploadedIds = useRef<string[]>([])

  useEffect(() => {
    setDraft(normalizeMaterials(exam.materials))
  }, [exam.materials])

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await service.courseOptions(pid))
    } catch {
      setOptions(null)
    }
  }, [service, pid])
  useEffect(() => {
    if (picking) void loadOptions()
  }, [picking, loadOptions])

  const pickedIds = useMemo(
    () =>
      new Set(
        resolveExamDocuments(normalizeMaterials(exam.materials), documents).map(
          (entry) => entry.document.id,
        ),
      ),
    [exam.materials, documents],
  )
  const examDocs = useMemo(
    () => documents.filter((doc) => pickedIds.has(doc.id)),
    [documents, pickedIds],
  )
  const otherDocs = useMemo(
    () => documents.filter((doc) => !pickedIds.has(doc.id)),
    [documents, pickedIds],
  )
  const examPrune = examSelection.prune
  const otherPrune = otherSelection.prune
  useEffect(() => {
    examPrune(examDocs.map((doc) => doc.id))
    otherPrune(otherDocs.map((doc) => doc.id))
  }, [examDocs, otherDocs, examPrune, otherPrune])

  async function saveMaterials(next: PlannedExamMaterials) {
    setSaving(true)
    try {
      await service.updateExam(exam.id, { materials: next })
      await service.replan()
      toast({ variant: 'success', title: t('examWorkspace.materialsSaved') })
      setPicking(false)
      onChanged()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  /** A row link of a file list: show the file here, not on its own page. */
  function openInPlace(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as HTMLElement).closest('a[href]')
    if (!anchor) return
    const found = documentIdFromHref(anchor.getAttribute('href') ?? '', pid)
    if (!found) return
    event.preventDefault()
    setOpened(found)
  }

  const listProps = {
    loading,
    projectId: pid,
    onUploadClick: () => setUploadOpen(true),
    onRename: async (id: string, name: string) => {
      const doc = documents.find((d) => d.id === id)
      if (doc) await actions.rename(doc, name)
    },
    onDelete: async (id: string) => remove(id),
    showMaterialType: true,
    onDeleteRequest: actions.requestDelete,
    groupFolders: true,
    onMoveToFolder: actions.requestMove,
    onChangeMaterialType: actions.requestMaterialType,
  }

  return (
    <div className="space-y-10" onClickCapture={openInPlace} data-workspace-materials>
      <TabSection
        title={t('examWorkspace.examFiles', { count: examDocs.length })}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              {t('examWorkspace.uploadToExam')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={picking}
              onClick={() => setPicking((open) => !open)}
              data-materials-pick
            >
              <FolderPlus className="h-4 w-4" aria-hidden />
              {t('examWorkspace.pickMaterials')}
            </Button>
          </div>
        }
        data-exam-files
      >
        {picking && (
          <div className="space-y-3 rounded-md border p-3 lab:rounded-none" data-materials-editor>
            {options ? (
              <ExamMaterialsPicker
                projectId={pid}
                idPrefix={`workspace-${exam.id}`}
                documents={options.documents}
                value={draft}
                onChange={setDraft}
                onUploaded={loadOptions}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={saving} onClick={() => void saveMaterials(draft)}>
                {t('examWorkspace.saveMaterials')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setDraft(normalizeMaterials(exam.materials))
                  setPicking(false)
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
        {examDocs.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">{t('examWorkspace.examFilesNone')}</p>
        ) : (
          <DocumentList {...listProps} documents={examDocs} selection={examSelection} />
        )}
      </TabSection>

      <TabSection
        title={t('examWorkspace.otherFiles', { count: otherDocs.length })}
        data-other-files
      >
        <p className="text-sm text-muted-foreground">{t('examWorkspace.otherFilesHint')}</p>
        <DocumentList
          {...listProps}
          documents={otherDocs}
          materialFilter
          selection={otherSelection}
        />
      </TabSection>

      <DocumentUploadDialog
        projectId={pid}
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          // Files uploaded here join the exam once the dialog closes.
          if (!open && uploadedIds.current.length > 0) {
            const ids = uploadedIds.current
            uploadedIds.current = []
            const current = normalizeMaterials(exam.materials)
            void saveMaterials({
              ...current,
              documentIds: [...new Set([...(current.documentIds ?? []), ...ids])],
            })
          }
        }}
        allowMaterialSelect
        onUploaded={(documentId) => {
          uploadedIds.current = [...uploadedIds.current, documentId]
        }}
      />
      {actions.dialogs}

      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="max-w-5xl" data-document-dialog>
          <DialogTitle className="sr-only">{t('examWorkspace.openFile')}</DialogTitle>
          {opened && (
            <DocumentDetailPage
              embedded={{
                projectId: pid,
                documentId: opened.id,
                ...(opened.page ? { page: opened.page } : {}),
                onDeleted: () => setOpened(null),
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
