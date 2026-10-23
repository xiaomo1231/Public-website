import { useMemo, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Filter,
  Folder,
  FolderInput,
  Loader2,
  ListPlus,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Tags,
  Trash2,
} from 'lucide-react'
import {
  LEARNING_MATERIAL_TYPES,
  resolveMaterialType,
  type Document,
  type DocumentType,
  type LearningMaterialType,
  type ProcessingStatus,
} from '@/entities/document/types'
import { groupByFolder, type FolderGroup } from '@/entities/document/folders'
import {
  filterDocuments,
  selectionState,
  type DocumentFilters,
} from '@/entities/document/selection'
import type { DocumentSelection } from '@/features/documents/useDocumentSelection'
import { DocumentBatchBar } from './DocumentBatchBar'
import { SelectAllCheckbox, RowCheckbox } from './SelectionCheckbox'
import { isTypingTarget } from '@/shared/lib/typingTarget'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/Dialog'
import { TooltipProvider, TooltipWrapper } from '@/shared/ui/Tooltip'
import { cn, relativeTime } from '@/shared/lib/utils'
import { useUiStyle } from '@/features/theme/useAppearance'
import { LAB_CHIP_CLASS, LAB_TABLE_HEAD_CLASS } from '@/widgets/dashboard/Figures'
import { formatBytes } from '@/shared/lib/format'
import { targetLanguageOf } from '@/shared/lib/language'
import { useProject } from '@/features/project/useProjects'
import { WordListImportDialog } from '@/widgets/vocab/WordListImportDialog'
import { reprocessDocument } from '@/features/documents/uploadPipeline'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { CourseContentService, pausedCourseAnalysis } from '@/services/courseContentService'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation, type TranslationKey } from '@/i18n'
import { MaterialSuggestionNotice } from './MaterialSuggestionNotice'

const TYPE_LABEL_KEY: Record<DocumentType, TranslationKey> = {
  pdf: 'docType.pdf',
  docx: 'docType.word',
  pptx: 'docType.powerpoint',
  image: 'docType.image',
  text: 'docType.text',
}

const STATUS_BADGE: Record<
  ProcessingStatus,
  { labelKey: TranslationKey; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  uploading: { labelKey: 'docStatus.uploading', variant: 'outline' },
  processing: { labelKey: 'docStatus.processing', variant: 'secondary' },
  ready: { labelKey: 'docStatus.ready', variant: 'default' },
  failed: { labelKey: 'docStatus.failed', variant: 'destructive' },
}

const STATUS_ICON: Record<
  ProcessingStatus,
  typeof Loader2 | typeof CheckCircle2 | typeof AlertCircle
> = {
  uploading: Loader2,
  processing: Loader2,
  ready: CheckCircle2,
  failed: AlertCircle,
}

const MATERIAL_LABEL_KEY: Record<LearningMaterialType, TranslationKey> = {
  textbook: 'materialType.textbook',
  user_notes: 'materialType.user_notes',
  lecture_transcript: 'materialType.lecture_transcript',
  professor_practice: 'materialType.professor_practice',
  homework: 'materialType.homework',
  homework_answer: 'materialType.homework_answer',
  syllabus: 'materialType.syllabus',
  walkthrough_import: 'materialType.walkthrough_import',
  past_exam: 'materialType.past_exam',
}

type SortKey = 'newest' | 'oldest' | 'name' | 'size'
type TypeFilter = 'all' | DocumentType
type StatusFilter = 'all' | ProcessingStatus
type MaterialFilter = 'all' | LearningMaterialType

export interface DocumentListProps {
  documents: Document[]
  loading: boolean
  projectId: string
  onUploadClick: () => void
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Show the learning-material badge on each row (project files overview). */
  showMaterialType?: boolean
  /** Offer a material-type filter (project files overview). */
  materialFilter?: boolean
  /**
   * When provided, the delete action asks the owner to confirm instead of
   * opening the built-in dialog — used to show the full delete impact.
   */
  onDeleteRequest?: (doc: Document) => void
  /** Group the rows by `Document.folderPath` (collapsible) when any file has one. */
  groupFolders?: boolean
  /** Offer 移动到文件夹 in each row's menu. */
  onMoveToFolder?: (doc: Document) => void
  /** Offer 改资料类型 in each row's menu. */
  onChangeMaterialType?: (doc: Document) => void
  /**
   * Multi-select (2o): row checkboxes, header 全选 over the filtered rows,
   * Shift range, Space / Ctrl+A / Esc. Share one selection between lists to
   * select across them (设置 → 文件管理).
   */
  selection?: DocumentSelection
  /** Render the batch bar above the list (default: when `selection` is given). */
  batchBar?: boolean
  /**
   * Controlled filters: the built-in search / filter toolbar is hidden and the
   * parent renders its own (one toolbar for several lists).
   */
  filters?: DocumentFilters
  /** Group rows by folder (with `groupFolders`) or by material type. */
  groupBy?: 'folder' | 'material'
}

export function DocumentList({
  documents,
  loading,
  projectId,
  onUploadClick,
  onRename,
  onDelete,
  showMaterialType = false,
  materialFilter = false,
  onDeleteRequest,
  groupFolders = false,
  onMoveToFolder,
  onChangeMaterialType,
  selection,
  batchBar,
  filters: controlledFilters,
  groupBy = 'folder',
}: DocumentListProps): JSX.Element {
  const { t } = useTranslation()
  const { uiStyle } = useUiStyle()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [material, setMaterial] = useState<MaterialFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [renaming, setRenaming] = useState<Document | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<Document | null>(null)
  /** A delete is running: a second click must not delete twice. */
  const [deleteBusy, setDeleteBusy] = useState(false)
  // A language course can read a textbook's word list into its vocabulary book.
  const { project } = useProject(projectId)
  const languageCourse = Boolean(targetLanguageOf(project))
  const [wordListDoc, setWordListDoc] = useState<Document | null>(null)
  // Rows mounted so far: each row carries a dropdown and a tooltip, so a
  // course with thousands of files renders in batches instead of all at once.
  const [revealed, setRevealed] = useState(DOCUMENT_PAGE_SIZE)

  const filtered = useMemo(
    () => filterDocuments(documents, controlledFilters ?? { query, type, material, status, sort }),
    [documents, controlledFilters, query, type, material, status, sort],
  )
  const visible = filtered.slice(0, revealed)
  const remaining = filtered.length - visible.length
  // 按文件夹: collapsible groups when any file sits in a folder; 按类型:
  // one group per material role, in the roles' usual order.
  const byMaterial = groupBy === 'material'
  const grouping = byMaterial || (groupFolders && documents.some((doc) => doc.folderPath))
  const folderGroups: FolderGroup<Document>[] = byMaterial
    ? LEARNING_MATERIAL_TYPES.map((role) => ({
        folder: role,
        documents: visible.filter((doc) => resolveMaterialType(doc.materialType) === role),
      })).filter((group) => group.documents.length > 0)
    : grouping
      ? groupByFolder(visible)
      : [{ folder: '', documents: visible }]
  // Multi-select: 全选 covers every filtered row (not only the ones mounted
  // so far); Shift ranges follow the order the rows are shown in.
  const filteredIds = useMemo(() => filtered.map((doc) => doc.id), [filtered])
  const shownIds = folderGroups.flatMap((group) => group.documents.map((doc) => doc.id))
  const toggleRow = (id: string, range: boolean): void =>
    selection?.toggle(id, { range, orderedIds: shownIds })
  const onListKeyDown = (event: KeyboardEvent): void => {
    if (!selection || isTypingTarget(event.target)) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selection.setMany(filteredIds, true)
    } else if (event.key === 'Escape' && selection.count > 0) {
      event.preventDefault()
      selection.clear()
    }
  }
  const onRowKeyDown = (event: KeyboardEvent, id: string): void => {
    // Space on the row's link (or the row itself) toggles it; buttons and the
    // checkbox keep their own Space.
    if (!selection || event.key !== ' ' || isTypingTarget(event.target)) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, [role="menuitem"]')) return
    event.preventDefault()
    toggleRow(id, event.shiftKey)
  }
  const wrapFolder = (group: FolderGroup<Document>, rows: JSX.Element): JSX.Element =>
    grouping ? (
      <details key={group.folder || '-'} open className="mb-3" data-folder-group={group.folder}>
        <summary className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm font-medium coarse:py-2">
          {byMaterial ? (
            <Tags className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <Folder className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 break-words">
            {byMaterial
              ? t(MATERIAL_LABEL_KEY[group.folder as LearningMaterialType])
              : group.folder || t('files.noFolder')}
          </span>
          <span className="data-num text-xs font-normal text-muted-foreground">
            {group.documents.length}
          </span>
        </summary>
        {rows}
      </details>
    ) : (
      <div key="all">{rows}</div>
    )

  if (loading) {
    return <LoadingState label={t('documents.loading')} />
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title={t('documents.empty')}
        description={t('documents.emptyHint')}
        action={<Button onClick={onUploadClick}>{t('documents.uploadFirst')}</Button>}
      />
    )
  }

  const headerState = selection ? selectionState(selection.selected, filteredIds) : 'none'
  const rowCheckbox = (doc: Document): JSX.Element | null =>
    selection ? (
      <RowCheckbox
        checked={selection.isSelected(doc.id)}
        label={t('fileBatch.selectFile', { name: doc.name })}
        onToggle={(range) => toggleRow(doc.id, range)}
      />
    ) : null

  return (
    <div className="space-y-4">
      {selection && (batchBar ?? true) && (
        <DocumentBatchBar selection={selection} documents={documents} />
      )}
      {!controlledFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('documents.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          {materialFilter && (
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialFilter)}>
              <SelectTrigger className="w-[150px]" aria-label={t('files.filter.material')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('files.filter.material')}</SelectItem>
                {LEARNING_MATERIAL_TYPES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(MATERIAL_LABEL_KEY[m])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('documents.filter.allTypes')}</SelectItem>
              <SelectItem value="pdf">{t('docType.pdf')}</SelectItem>
              <SelectItem value="docx">{t('docType.word')}</SelectItem>
              <SelectItem value="pptx">{t('docType.powerpoint')}</SelectItem>
              <SelectItem value="image">{t('docType.image')}</SelectItem>
              <SelectItem value="text">{t('docType.text')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('documents.filter.allStatus')}</SelectItem>
              <SelectItem value="uploading">{t('docStatus.uploading')}</SelectItem>
              <SelectItem value="processing">{t('docStatus.processing')}</SelectItem>
              <SelectItem value="ready">{t('docStatus.ready')}</SelectItem>
              <SelectItem value="failed">{t('docStatus.failed')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t('documents.sort.newest')}</SelectItem>
              <SelectItem value="oldest">{t('documents.sort.oldest')}</SelectItem>
              <SelectItem value="name">{t('documents.sort.name')}</SelectItem>
              <SelectItem value="size">{t('documents.sort.size')}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={onUploadClick}>{t('documents.upload')}</Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title={t('documents.noMatches')} description={t('documents.noMatchesHint')} />
      ) : (
        <TooltipProvider delayDuration={300}>
          <section
            aria-label={t('documents.title')}
            className="min-w-0"
            onKeyDown={selection ? onListKeyDown : undefined}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {selection && (
                <SelectAllCheckbox
                  state={headerState}
                  label={t('fileBatch.selectAll', { count: filteredIds.length })}
                  onChange={(on) => selection.setMany(filteredIds, on)}
                />
              )}
              <p className="data-num text-xs text-muted-foreground lab:font-mono lab:text-[11px]">
                {t('documents.title')} ·{' '}
                {t('documents.count', {
                  shown: filtered.length,
                  total: documents.length,
                  count: documents.length,
                })}
              </p>
            </div>
            {folderGroups.map((group) =>
              wrapFolder(
                group,
                uiStyle === 'lab' ? (
                  <div className="overflow-x-auto border border-border bg-card">
                    <table className="data-num w-full min-w-[520px] table-fixed border-collapse text-[13px]">
                      <thead className={LAB_TABLE_HEAD_CLASS}>
                        <tr>
                          {selection && (
                            <th scope="col" className={cn(LAB_HEAD, 'w-11 px-1')}>
                              <span className="sr-only">{t('fileBatch.colSelect')}</span>
                            </th>
                          )}
                          <th scope="col" className={LAB_HEAD}>
                            {t('documents.col.file')}
                          </th>
                          {showMaterialType && (
                            <th scope="col" className={cn(LAB_HEAD, 'hidden w-36 md:table-cell')}>
                              {t('documents.col.role')}
                            </th>
                          )}
                          <th scope="col" className={cn(LAB_HEAD, 'hidden w-24 sm:table-cell')}>
                            {t('documents.col.size')}
                          </th>
                          <th scope="col" className={cn(LAB_HEAD, 'w-28')}>
                            {t('documents.col.status')}
                          </th>
                          <th scope="col" className={cn(LAB_HEAD, 'hidden w-28 lg:table-cell')}>
                            {t('documents.col.uploaded')}
                          </th>
                          <th scope="col" className={cn(LAB_HEAD, 'w-11')}>
                            <span className="sr-only">{t('documents.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.documents.map((doc) => {
                          const busy = doc.status === 'processing' || doc.status === 'uploading'
                          const StatusIcon = STATUS_ICON[doc.status]
                          return (
                            <tr
                              key={doc.id}
                              className={cn(
                                'transition-colors duration-150 hover:bg-accent/50',
                                selection?.isSelected(doc.id) && 'bg-primary/5',
                              )}
                              data-selected={selection?.isSelected(doc.id) || undefined}
                              onKeyDown={(event) => onRowKeyDown(event, doc.id)}
                            >
                              {selection && (
                                <td className={cn(LAB_CELL, 'px-1')}>{rowCheckbox(doc)}</td>
                              )}
                              <td className={LAB_CELL}>
                                <span className="flex min-w-0 items-center gap-2.5">
                                  <span className="w-10 shrink-0 truncate font-mono text-[10.5px] uppercase text-muted-foreground">
                                    {doc.type}
                                  </span>
                                  <DocumentLink doc={doc} projectId={projectId} />
                                </span>
                                <MaterialSuggestionNotice doc={doc} projectId={projectId} />
                              </td>
                              {showMaterialType && (
                                <td className={cn(LAB_CELL, 'hidden md:table-cell')}>
                                  <span className={LAB_CHIP_CLASS}>
                                    {t(MATERIAL_LABEL_KEY[resolveMaterialType(doc.materialType)])}
                                  </span>
                                </td>
                              )}
                              <td
                                className={cn(
                                  LAB_CELL,
                                  'hidden font-mono text-xs text-muted-foreground sm:table-cell',
                                )}
                              >
                                {formatBytes(doc.sizeBytes)}
                              </td>
                              <td className={LAB_CELL}>
                                <span
                                  className={cn(
                                    LAB_CHIP_CLASS,
                                    'gap-1',
                                    doc.status === 'ready' && 'border-primary/40 text-primary',
                                    doc.status === 'failed' &&
                                      'border-destructive/40 text-destructive',
                                  )}
                                >
                                  <StatusIcon
                                    aria-hidden
                                    className={cn('h-3 w-3', busy && 'motion-safe:animate-spin')}
                                  />
                                  {t(STATUS_BADGE[doc.status].labelKey)}
                                </span>
                              </td>
                              <td
                                className={cn(
                                  LAB_CELL,
                                  'hidden font-mono text-xs text-muted-foreground lg:table-cell',
                                )}
                              >
                                {relativeTime(doc.uploadedAt)}
                              </td>
                              <td className={cn(LAB_CELL, 'px-1 text-right')}>
                                <RowMenu
                                  doc={doc}
                                  projectId={projectId}
                                  onRename={() => {
                                    setRenaming(doc)
                                    setRenameValue(doc.name)
                                  }}
                                  onDelete={() =>
                                    onDeleteRequest ? onDeleteRequest(doc) : setDeleting(doc)
                                  }
                                  {...(languageCourse && doc.status === 'ready'
                                    ? { onImportWordList: () => setWordListDoc(doc) }
                                    : {})}
                                  {...(onMoveToFolder
                                    ? { onMoveToFolder: () => onMoveToFolder(doc) }
                                    : {})}
                                  {...(onChangeMaterialType
                                    ? { onChangeMaterialType: () => onChangeMaterialType(doc) }
                                    : {})}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ul className="border-t border-border">
                    {group.documents.map((doc) => {
                      const busy = doc.status === 'processing' || doc.status === 'uploading'
                      return (
                        <li
                          key={doc.id}
                          className={cn(
                            'flex min-w-0 items-center gap-3 border-b border-border py-2.5',
                            selection?.isSelected(doc.id) && 'bg-primary/5',
                          )}
                          data-selected={selection?.isSelected(doc.id) || undefined}
                          onKeyDown={(event) => onRowKeyDown(event, doc.id)}
                        >
                          {rowCheckbox(doc)}
                          <span className="min-w-0 flex-1">
                            <DocumentLink doc={doc} projectId={projectId} />
                            <span className="data-num mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                              {showMaterialType && (
                                <>
                                  <span>
                                    {t(MATERIAL_LABEL_KEY[resolveMaterialType(doc.materialType)])}
                                  </span>
                                  <span aria-hidden>·</span>
                                </>
                              )}
                              <span>{t(TYPE_LABEL_KEY[doc.type])}</span>
                              <span aria-hidden>·</span>
                              <span>{formatBytes(doc.sizeBytes)}</span>
                              <span aria-hidden className="hidden sm:inline">
                                ·
                              </span>
                              <span className="hidden sm:inline">
                                {relativeTime(doc.uploadedAt)}
                              </span>
                            </span>
                            <MaterialSuggestionNotice doc={doc} projectId={projectId} />
                          </span>
                          <span
                            className={cn(
                              'inline-flex shrink-0 items-center gap-1 text-xs',
                              doc.status === 'ready' && 'text-primary',
                              doc.status === 'failed' && 'text-destructive',
                              busy && 'text-muted-foreground',
                            )}
                          >
                            {busy && (
                              <Loader2 aria-hidden className="h-3 w-3 motion-safe:animate-spin" />
                            )}
                            {doc.status === 'failed' && (
                              <AlertCircle aria-hidden className="h-3 w-3" />
                            )}
                            {t(STATUS_BADGE[doc.status].labelKey)}
                          </span>
                          <RowMenu
                            doc={doc}
                            projectId={projectId}
                            onRename={() => {
                              setRenaming(doc)
                              setRenameValue(doc.name)
                            }}
                            onDelete={() =>
                              onDeleteRequest ? onDeleteRequest(doc) : setDeleting(doc)
                            }
                            {...(languageCourse && doc.status === 'ready'
                              ? { onImportWordList: () => setWordListDoc(doc) }
                              : {})}
                            {...(onMoveToFolder
                              ? { onMoveToFolder: () => onMoveToFolder(doc) }
                              : {})}
                            {...(onChangeMaterialType
                              ? { onChangeMaterialType: () => onChangeMaterialType(doc) }
                              : {})}
                          />
                        </li>
                      )
                    })}
                  </ul>
                ),
              ),
            )}
            {remaining > 0 && (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevealed((current) => current + DOCUMENT_PAGE_SIZE)}
                >
                  <ChevronDown className="h-4 w-4" />
                  {t('progressiveList.showMore', {
                    count: Math.min(DOCUMENT_PAGE_SIZE, remaining),
                  })}
                  <span className="text-muted-foreground">
                    {t('progressiveList.remaining', { count: remaining })}
                  </span>
                </Button>
              </div>
            )}
          </section>
        </TooltipProvider>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('documents.renameTitle')}</DialogTitle>
            <DialogDescription>{t('documents.renameDescription')}</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={async () => {
                if (!renaming || !renameValue.trim()) return
                await onRename(renaming.id, renameValue.trim())
                setRenaming(null)
              }}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!onDeleteRequest && (
        <Dialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('documents.deleteTitle')}</DialogTitle>
              <DialogDescription>
                {t('documents.deleteBody', { name: deleting?.name ?? '' })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteBusy}
                onClick={async () => {
                  if (!deleting || deleteBusy) return
                  setDeleteBusy(true)
                  try {
                    await onDelete(deleting.id)
                  } finally {
                    setDeleteBusy(false)
                    setDeleting(null)
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {wordListDoc && (
        <WordListImportDialog
          projectId={projectId}
          documentId={wordListDoc.id}
          open
          onOpenChange={(open) => !open && setWordListDoc(null)}
        />
      )}
    </div>
  )
}

const DOCUMENT_PAGE_SIZE = 100
const LAB_HEAD = 'px-3 py-2 text-left font-medium'
const LAB_CELL = 'border-t border-border px-3 py-2 align-middle'

function DocumentLink({ doc, projectId }: { doc: Document; projectId: string }): JSX.Element {
  return (
    // The TooltipProvider is hoisted to the list so rows do not each mount one.
    <TooltipWrapper content={doc.name}>
      <Link
        to={`/projects/${projectId}/documents/${doc.id}`}
        aria-label={doc.name}
        className="focus-ring block min-w-0 flex-1 truncate rounded-sm text-sm font-medium text-foreground transition-colors duration-150 hover:text-primary lecture:text-[15px] coarse:py-3"
      >
        {doc.name}
      </Link>
    </TooltipWrapper>
  )
}

function RowMenu({
  doc,
  projectId,
  onRename,
  onDelete,
  onImportWordList,
  onMoveToFolder,
  onChangeMaterialType,
}: {
  doc: Document
  projectId: string
  onRename: () => void
  onDelete: () => void
  /** Files pages: change the learning-material role. */
  onChangeMaterialType?: () => void
  /** Files page: move to another folder. */
  onMoveToFolder?: () => void
  /** Language courses: read this document's word list into the course vocabulary. */
  onImportWordList?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const refresh = useDocumentsStore((s) => s.refresh)
  // A failed file, or one whose processing was interrupted, can be read again
  // from its stored bytes instead of being deleted and uploaded once more.
  const canReprocess =
    doc.hasBlob !== false &&
    (doc.status === 'failed' || (doc.status === 'ready' && Boolean(doc.errorMessage)))
  async function reprocess(): Promise<void> {
    toast({ variant: 'info', title: t('documents.reprocessing', { name: doc.name }) })
    try {
      await reprocessDocument(doc.id)
      toast({ variant: 'success', title: t('documents.reprocessDone', { name: doc.name }) })
      if (!pausedCourseAnalysis(projectId)) {
        void new CourseContentService().ensureAnalyzed(projectId).catch((err: unknown) => {
          logger.debug('Automatic course analysis skipped', { error: String(err) })
        })
      }
    } catch (err) {
      toast({
        variant: 'error',
        title: t('documents.reprocessFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      await refresh(projectId).catch(() => undefined)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('documents.actions')}
          className="shrink-0"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/projects/${projectId}/documents/${doc.id}`}>{t('documents.open')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-4 w-4" />
          {t('documents.rename')}
        </DropdownMenuItem>
        {onMoveToFolder && (
          <DropdownMenuItem onSelect={onMoveToFolder}>
            <FolderInput className="h-4 w-4" />
            {t('files.moveToFolder')}
          </DropdownMenuItem>
        )}
        {onChangeMaterialType && (
          <DropdownMenuItem onSelect={onChangeMaterialType}>
            <Tags className="h-4 w-4" />
            {t('fileBatch.changeType')}
          </DropdownMenuItem>
        )}
        {canReprocess && (
          <DropdownMenuItem onSelect={() => void reprocess()}>
            <RotateCcw className="h-4 w-4" />
            {t('documents.reprocess')}
          </DropdownMenuItem>
        )}
        {onImportWordList && (
          <DropdownMenuItem onSelect={onImportWordList}>
            <ListPlus className="h-4 w-4" />
            {t('wordList.open')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4" />
          {t('documents.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
