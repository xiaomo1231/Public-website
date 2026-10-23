import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileUp, Folder, FolderUp, Loader2, Search } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import {
  folderOfRelativePath,
  isInFolder,
  listFolders,
  normalizeFolderPath,
  suggestMaterialType,
} from '@/entities/document/folders'
import { LEARNING_MATERIAL_TYPES, type LearningMaterialType } from '@/entities/document/types'
import { normalizeMaterials, toggleIn } from '@/entities/studyPlan/materials'
import type { PlannedExamMaterials } from '@/entities/studyPlan/types'
import type { MaterialOption } from '@/services/studyPlanService'
import { useBatchUpload } from '@/features/documents/useBatchUpload'
import {
  filesFromDataTransfer,
  filesFromInput,
  MAX_FOLDER_FILES,
  type FileWithPath,
} from '@/infrastructure/files/folderEntries'
import { useTranslation, type TranslationKey } from '@/i18n'

/** The picker's role groups (课件/教材, 往年卷, 教授练习, 作业, 大纲, 复习资料, 其它). */
type RoleGroup = 'lecture' | 'past' | 'practice' | 'homework' | 'syllabus' | 'review' | 'other'

const ROLE_GROUPS: RoleGroup[] = [
  'lecture',
  'past',
  'practice',
  'homework',
  'syllabus',
  'review',
  'other',
]

const GROUP_KEYS: Record<RoleGroup, TranslationKey> = {
  lecture: 'plan.materials.group.lecture',
  past: 'plan.materials.group.past',
  practice: 'plan.materials.group.practice',
  homework: 'plan.materials.group.homework',
  syllabus: 'plan.materials.group.syllabus',
  review: 'plan.materials.group.review',
  other: 'plan.materials.group.other',
}

function roleGroupOf(type: LearningMaterialType): RoleGroup {
  switch (type) {
    case 'textbook':
      return 'lecture'
    case 'past_exam':
      return 'past'
    case 'professor_practice':
      return 'practice'
    case 'homework':
      return 'homework'
    case 'syllabus':
      return 'syllabus'
    case 'user_notes':
      return 'review'
    default:
      return 'other'
  }
}

const MATERIAL_KEYS: Record<LearningMaterialType, TranslationKey> = {
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

/**
 * 每场考试的资料: browse the course's files by folder or by role, search,
 * pick files or whole folders (a folder includes files added to it later),
 * and upload files or folders into the course right here. New uploads are
 * selected for the exam. Role suggestions come from the file and folder
 * names and can be changed before the upload starts.
 */
export function ExamMaterialsPicker({
  projectId,
  idPrefix,
  documents,
  value,
  onChange,
  onUploaded,
}: {
  projectId: string
  idPrefix: string
  documents: MaterialOption[]
  value: PlannedExamMaterials
  onChange: (next: PlannedExamMaterials) => void
  /** Reload the course's files after an upload. */
  onUploaded: () => Promise<void> | void
}): JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<'folder' | 'role'>(() =>
    documents.some((doc) => doc.folderPath) ? 'folder' : 'role',
  )
  const [query, setQuery] = useState('')
  const materials = normalizeMaterials(value)
  const pickedIds = new Set([...(materials.documentIds ?? []), ...materials.reviewDocumentIds])
  const folders = useMemo(() => listFolders(documents), [documents])
  const q = query.trim().toLowerCase()
  const shown = documents.filter(
    (doc) =>
      !q || doc.name.toLowerCase().includes(q) || (doc.folderPath ?? '').toLowerCase().includes(q),
  )
  const viaFolder = (doc: MaterialOption): string | undefined =>
    (materials.folderPaths ?? []).find((folder) => isInFolder(doc.folderPath, folder))
  const selectedCount = documents.filter((doc) => pickedIds.has(doc.id) || viaFolder(doc)).length

  const toggleDoc = (id: string) =>
    onChange({
      ...materials,
      documentIds: toggleIn(materials.documentIds, id),
      // An older pick (review documents) is cleared with the same click.
      reviewDocumentIds: materials.reviewDocumentIds.filter((each) => each !== id),
    })
  const toggleFolder = (folder: string) =>
    onChange({ ...materials, folderPaths: toggleIn(materials.folderPaths, folder) })
  const toggleGroup = (ids: string[], on: boolean) =>
    onChange({
      ...materials,
      documentIds: on
        ? [...new Set([...(materials.documentIds ?? []), ...ids])]
        : (materials.documentIds ?? []).filter((id) => !ids.includes(id)),
      reviewDocumentIds: on
        ? materials.reviewDocumentIds
        : materials.reviewDocumentIds.filter((id) => !ids.includes(id)),
    })

  const fileRow = (doc: MaterialOption, nested = false) => {
    const folder = viaFolder(doc)
    const checked = pickedIds.has(doc.id) || !!folder
    const inputId = `${idPrefix}-doc-${doc.id}`
    return (
      <li key={doc.id} className={cn('flex min-w-0 items-center gap-2', nested && 'pl-5')}>
        <input
          id={inputId}
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={checked}
          disabled={!!folder}
          onChange={() => toggleDoc(doc.id)}
        />
        <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer text-sm coarse:py-2">
          <span className="break-words">{doc.name}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {t(MATERIAL_KEYS[doc.materialType])}
            {doc.pages ? ` · ${t('plan.materials.pages', { count: doc.pages })}` : ''}
            {doc.status !== 'ready' ? ` · ${t('plan.materials.notReady')}` : ''}
            {folder ? ` · ${t('plan.materials.viaFolder')}` : ''}
          </span>
        </label>
      </li>
    )
  }

  return (
    <div className="space-y-3" data-exam-materials>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm font-medium">
          {t('plan.materials.title')}
          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
            {t('plan.materials.selected', {
              files: selectedCount,
              folders: materials.folderPaths?.length ?? 0,
            })}
          </span>
        </p>
        <div role="group" aria-label={t('plan.materials.view')} className="flex gap-1">
          {(['folder', 'role'] as const).map((each) => (
            <Button
              key={each}
              size="sm"
              variant={view === each ? 'default' : 'outline'}
              aria-pressed={view === each}
              onClick={() => setView(each)}
            >
              {t(each === 'folder' ? 'plan.materials.byFolder' : 'plan.materials.byRole')}
            </Button>
          ))}
        </div>
      </div>

      {documents.length > 0 && (
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('plan.materials.search')}
            aria-label={t('plan.materials.search')}
            className="pl-9"
          />
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('plan.materials.noFiles')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('plan.materials.noMatches')}</p>
      ) : view === 'folder' ? (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1" data-materials-folders>
          {folders
            .filter((folder) => shown.some((doc) => isInFolder(doc.folderPath, folder)))
            .map((folder) => {
              const own = shown.filter((doc) => normalizeFolderPath(doc.folderPath) === folder)
              const depth = folder.split('/').length - 1
              const inputId = `${idPrefix}-folder-${folder}`
              const parentPicked = (materials.folderPaths ?? []).some(
                (each) => each !== folder && isInFolder(folder, each),
              )
              return (
                <details key={folder} open style={{ marginLeft: `${depth * 1.25}rem` }}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 break-words font-medium">
                      {folder.split('/').pop()}
                    </span>
                    <input
                      id={inputId}
                      type="checkbox"
                      className="h-4 w-4"
                      checked={(materials.folderPaths ?? []).includes(folder) || parentPicked}
                      disabled={parentPicked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleFolder(folder)}
                      data-folder-toggle={folder}
                    />
                    <label htmlFor={inputId} className="text-xs text-muted-foreground">
                      {t('plan.materials.wholeFolder')}
                    </label>
                  </summary>
                  {own.length > 0 && (
                    <ul className="mt-1 space-y-1">{own.map((doc) => fileRow(doc, true))}</ul>
                  )}
                </details>
              )
            })}
          {shown.some((doc) => !normalizeFolderPath(doc.folderPath)) && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('plan.materials.noFolder')}</p>
              <ul className="space-y-1">
                {shown
                  .filter((doc) => !normalizeFolderPath(doc.folderPath))
                  .map((doc) => fileRow(doc))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1" data-materials-roles>
          {ROLE_GROUPS.map((group) => {
            const docs = shown.filter((doc) => roleGroupOf(doc.materialType) === group)
            if (docs.length === 0) return null
            const ids = docs.map((doc) => doc.id)
            const all = docs.every((doc) => pickedIds.has(doc.id) || viaFolder(doc))
            return (
              <div key={group} className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs font-medium text-muted-foreground">
                    {t(GROUP_KEYS[group])} · {docs.length}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => toggleGroup(ids, !all)}>
                    {all ? t('plan.materials.clearGroup') : t('plan.materials.selectGroup')}
                  </Button>
                </div>
                <ul className="space-y-1">{docs.map((doc) => fileRow(doc))}</ul>
              </div>
            )
          })}
        </div>
      )}

      <MaterialUpload
        projectId={projectId}
        onDone={async (result) => {
          await onUploaded()
          if (result.documentIds.length === 0 && result.folders.length === 0) return
          onChange({
            ...materials,
            documentIds: [...new Set([...(materials.documentIds ?? []), ...result.documentIds])],
            folderPaths: [...new Set([...(materials.folderPaths ?? []), ...result.folders])],
          })
        }}
      />
      <p className="text-xs text-muted-foreground">{t('plan.materials.hint')}</p>
    </div>
  )
}

interface UploadResult {
  /** Loose files uploaded (selected one by one). */
  documentIds: string[]
  /** Top folders uploaded (selected whole). */
  folders: string[]
}

/** 上传文件 / 上传文件夹 into the course, with role suggestions the student can change. */
function MaterialUpload({
  projectId,
  onDone,
}: {
  projectId: string
  onDone: (result: UploadResult) => Promise<void> | void
}): JSX.Element {
  const { t } = useTranslation()
  const batch = useBatchUpload(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [reported, setReported] = useState(false)
  const queued = batch.items.filter((item) => item.status === 'queued')

  // webkitdirectory is not in React's typings.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
    folderInput.current?.setAttribute('directory', '')
  }, [])

  async function add(entries: FileWithPath[]) {
    if (entries.length === 0) return
    // A new selection starts a new batch (finished rows were reported already).
    if (!batch.running) batch.clearFinished()
    setReported(false)
    const folderOf = new Map(entries.map((entry) => [entry.file, folderOfRelativePath(entry.path)]))
    await batch.addFiles(
      entries.map((entry) => entry.file),
      'textbook',
      {
        limit: MAX_FOLDER_FILES,
        folderOf: (file) => folderOf.get(file) || undefined,
        roleOf: (file) => suggestMaterialType(file.name, folderOf.get(file) ?? ''),
      },
    )
  }

  async function start() {
    await batch.start()
  }

  // Report the finished batch once: loose files by id, folders by their top folder.
  useEffect(() => {
    if (reported || !batch.summary.finished || batch.summary.completed === 0) return
    setReported(true)
    const done = batch.items.filter((item) => item.status === 'completed' && item.documentId)
    const folders = [
      ...new Set(
        done
          .map((item) => normalizeFolderPath(item.folderPath).split('/')[0] ?? '')
          .filter(Boolean),
      ),
    ]
    const loose = done.filter((item) => !item.folderPath).map((item) => item.documentId!)
    void onDone({ documentIds: loose, folders })
  }, [batch.items, batch.summary.finished, batch.summary.completed, onDone, reported])

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border border-dashed p-3 lab:rounded-none',
        dragOver && 'ring-2 ring-ring',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        void filesFromDataTransfer(event.dataTransfer).then(add)
      }}
      data-materials-upload
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
          <FileUp className="h-4 w-4" aria-hidden />
          {t('plan.materials.uploadFiles')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => folderInput.current?.click()}>
          <FolderUp className="h-4 w-4" aria-hidden />
          {t('plan.materials.uploadFolder')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('plan.materials.dropHint')}</span>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          data-upload-files
          onChange={(event) => {
            void add(filesFromInput(event.target.files))
            event.target.value = ''
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          data-upload-folder
          onChange={(event) => {
            void add(filesFromInput(event.target.files))
            event.target.value = ''
          }}
        />
      </div>
      {batch.items.length > 0 && (
        <ul
          className="max-h-56 space-y-1 overflow-y-auto text-sm"
          aria-label={t('plan.materials.queue')}
        >
          {batch.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words">
                {item.folderPath ? (
                  <span className="text-muted-foreground">{item.folderPath}/</span>
                ) : null}
                {item.name}
              </span>
              {item.status === 'queued' ? (
                <select
                  aria-label={t('plan.materials.roleOf', { name: item.name })}
                  className="focus-ring h-9 rounded-md border bg-background px-2 text-xs lab:rounded-none"
                  value={item.materialType ?? 'textbook'}
                  onChange={(event) =>
                    batch.setMaterial([item.id], event.target.value as LearningMaterialType)
                  }
                >
                  {LEARNING_MATERIAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(MATERIAL_KEYS[type])}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {(item.status === 'uploading' || item.status === 'processing') && (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  )}
                  {t(`plan.materials.status.${item.status}` as TranslationKey)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {queued.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={batch.running} onClick={() => void start()} data-upload-start>
            {t('plan.materials.startUpload', { count: queued.length })}
          </Button>
          <Button size="sm" variant="ghost" disabled={batch.running} onClick={batch.reset}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
