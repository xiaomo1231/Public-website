import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FolderOpen, HardDrive, Search } from 'lucide-react'
import {
  LEARNING_MATERIAL_TYPES,
  type DocumentType,
  type LearningMaterialType,
  type ProcessingStatus,
} from '@/entities/document/types'
import {
  DEFAULT_DOCUMENT_FILTERS,
  filterDocuments,
  filtersActive,
  selectionState,
  type DocumentFilters,
  type DocumentSortKey,
} from '@/entities/document/selection'
import { SUBJECT_LABEL_KEYS } from '@/entities/project/types'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { formatBytes } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { useProjects } from '@/features/project/useProjects'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { useDocumentSelection } from '@/features/documents/useDocumentSelection'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { DocumentBatchBar } from '@/widgets/documents/DocumentBatchBar'
import { useFileActions } from '@/widgets/documents/useFileActions'
import { MATERIAL_LABEL_KEY } from '@/widgets/documents/materialLabels'
import { SelectAllCheckbox } from '@/widgets/documents/SelectionCheckbox'
import { DataManagementService } from '@/services/dataManagementService'
import { useTranslation } from '@/i18n'

const STATUSES: ProcessingStatus[] = ['uploading', 'processing', 'ready', 'failed']
const TYPES: DocumentType[] = ['pdf', 'docx', 'pptx', 'image', 'text']
const TYPE_KEYS = {
  pdf: 'docType.pdf',
  docx: 'docType.word',
  pptx: 'docType.powerpoint',
  image: 'docType.image',
  text: 'docType.text',
} as const
const STATUS_KEYS = {
  uploading: 'docStatus.uploading',
  processing: 'docStatus.processing',
  ready: 'docStatus.ready',
  failed: 'docStatus.failed',
} as const

/**
 * 设置 → 文件管理 (2p): every course's files on one page, grouped by course
 * (collapsible; inside by folder or by material type). One search / filter
 * toolbar drives every course's list; the selection may span courses and the
 * batch bar acts on each file in its own course. Files never move between
 * courses (chunks, the course analysis and questions belong to the course) —
 * only into a folder of their own course.
 */
export function FileManagerPage(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, loading: projectsLoading, loaded: projectsLoaded } = useProjects()
  const byProject = useDocumentsStore((s) => s.byProject)
  const loadedMap = useDocumentsStore((s) => s.loaded)
  const loadingMap = useDocumentsStore((s) => s.loading)
  const load = useDocumentsStore((s) => s.load)
  const selection = useDocumentSelection()
  const [filters, setFilters] = useState<DocumentFilters>(DEFAULT_DOCUMENT_FILTERS)
  const [course, setCourse] = useState<string>('all')
  const [groupBy, setGroupBy] = useState<'folder' | 'material'>('folder')
  const [storedBytes, setStoredBytes] = useState<number | null>(null)
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    for (const project of projects) {
      if (!loadedMap[project.id] && !loadingMap[project.id]) void load(project.id)
    }
  }, [projects, loadedMap, loadingMap, load])

  // Storage: the same stored-bytes figure as 数据管理, plus the browser's estimate.
  useEffect(() => {
    let alive = true
    void new DataManagementService()
      .inventory()
      .then((inventory) => {
        if (alive) setStoredBytes(inventory.estimatedTotalBytes)
      })
      .catch(() => undefined)
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (alive && estimate.quota) {
          setQuota({ usage: estimate.usage ?? 0, quota: estimate.quota })
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [byProject])

  const allDocuments = useMemo(
    () => projects.flatMap((project) => byProject[project.id] ?? []),
    [projects, byProject],
  )
  const actions = useFileActions(allDocuments)
  // Keep the selection to files that still exist.
  const { prune } = selection
  useEffect(() => {
    prune(allDocuments.map((doc) => doc.id))
  }, [allDocuments, prune])

  const shownProjects = useMemo(
    () => projects.filter((project) => course === 'all' || project.id === course),
    [projects, course],
  )
  const narrowed = filtersActive(filters)
  const allMatches = useMemo(
    () => shownProjects.flatMap((project) => filterDocuments(byProject[project.id] ?? [], filters)),
    [shownProjects, byProject, filters],
  )
  const allMatchIds = allMatches.map((doc) => doc.id)
  const totalBytes = allDocuments.reduce((sum, doc) => sum + doc.sizeBytes, 0)
  const loadingDocs = projects.some((project) => !loadedMap[project.id])

  const setFilter = <K extends keyof DocumentFilters>(key: K, value: DocumentFilters[K]): void =>
    setFilters((current) => ({ ...current, [key]: value }))

  return (
    <PageContainer>
      <PageHeader
        icon={<FolderOpen className="h-5 w-5" />}
        eyebrow={
          <Link
            to="/settings#settings-files"
            className="focus-ring inline-flex items-center gap-1 rounded-sm hover:text-foreground coarse:min-h-11"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('fileManager.back')}
          </Link>
        }
        title={t('fileManager.title')}
        description={t('fileManager.subtitle')}
      />
      <PageContent>
        <div className="space-y-4">
          <section
            aria-label={t('fileManager.storage')}
            className="flex flex-wrap items-center gap-x-6 gap-y-1 border border-border bg-card px-3 py-2.5 text-sm lecture:rounded-lg lab:rounded-none"
            data-storage-summary
          >
            <span className="inline-flex items-center gap-2 font-medium">
              <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('fileManager.storage')}
            </span>
            <span className="data-num text-muted-foreground">
              {t('fileManager.storageFiles', {
                count: allDocuments.length,
                size: formatBytes(totalBytes),
              })}
            </span>
            {storedBytes !== null && (
              <span className="data-num text-muted-foreground">
                {t('fileManager.storageStored', { size: formatBytes(storedBytes) })}
              </span>
            )}
            {quota && (
              <span className="data-num text-muted-foreground">
                {t('fileManager.storageBrowser', {
                  used: formatBytes(quota.usage),
                  quota: formatBytes(quota.quota),
                })}
              </span>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2" data-file-manager-toolbar>
            <div className="relative min-w-[200px] flex-1">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={filters.query}
                onChange={(e) => setFilter('query', e.target.value)}
                placeholder={t('fileManager.searchPlaceholder')}
                aria-label={t('fileManager.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger className="w-[170px]" aria-label={t('fileManager.filter.course')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('fileManager.filter.allCourses')}</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.material}
              onValueChange={(v) => setFilter('material', v as 'all' | LearningMaterialType)}
            >
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
            <Select
              value={filters.type}
              onValueChange={(v) => setFilter('type', v as 'all' | DocumentType)}
            >
              <SelectTrigger className="w-[130px]" aria-label={t('fileManager.filter.type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('documents.filter.allTypes')}</SelectItem>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(TYPE_KEYS[type])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.status}
              onValueChange={(v) => setFilter('status', v as 'all' | ProcessingStatus)}
            >
              <SelectTrigger className="w-[130px]" aria-label={t('fileManager.filter.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('documents.filter.allStatus')}</SelectItem>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(STATUS_KEYS[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.sort}
              onValueChange={(v) => setFilter('sort', v as DocumentSortKey)}
            >
              <SelectTrigger className="w-[130px]" aria-label={t('fileManager.filter.sort')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t('documents.sort.newest')}</SelectItem>
                <SelectItem value="oldest">{t('documents.sort.oldest')}</SelectItem>
                <SelectItem value="name">{t('documents.sort.name')}</SelectItem>
                <SelectItem value="size">{t('documents.sort.size')}</SelectItem>
              </SelectContent>
            </Select>
            <div
              role="group"
              aria-label={t('fileManager.groupBy')}
              className="inline-flex border border-border lecture:rounded-full lab:rounded-sm"
            >
              {(['folder', 'material'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  size="sm"
                  aria-pressed={groupBy === mode}
                  className={cn(groupBy === mode && 'bg-accent text-accent-foreground')}
                  onClick={() => setGroupBy(mode)}
                  data-group-by={mode}
                >
                  {t(mode === 'folder' ? 'fileManager.byFolder' : 'fileManager.byType')}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {allMatchIds.length > 0 && (
              <SelectAllCheckbox
                state={selectionState(selection.selected, allMatchIds)}
                label={t('fileManager.selectAllMatches', { count: allMatchIds.length })}
                onChange={(on) => selection.setMany(allMatchIds, on)}
              />
            )}
            <p className="text-xs text-muted-foreground" data-cross-course-hint>
              {t('fileManager.crossCourseHint')}
            </p>
          </div>

          <DocumentBatchBar selection={selection} documents={allDocuments} />

          {projectsLoading && !projectsLoaded ? (
            <LoadingState label={t('documents.loading')} />
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-10 w-10" />}
              title={t('fileManager.noCourses')}
              action={
                <Button onClick={() => navigate('/projects')}>{t('fileManager.toCourses')}</Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {shownProjects.map((project) => {
                const docs = byProject[project.id] ?? []
                const matches = narrowed ? filterDocuments(docs, filters).length : docs.length
                // A narrowing filter hides the courses it leaves empty.
                if (narrowed && matches === 0) return null
                const bytes = docs.reduce((sum, doc) => sum + doc.sizeBytes, 0)
                return (
                  <details
                    key={project.id}
                    open
                    className="border-b border-border pb-3 lab:border lab:bg-card lab:p-3"
                    data-course-group={project.id}
                  >
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 py-2 coarse:min-h-11">
                      <span className="break-words font-heading text-base font-semibold lab:font-sans lab:text-sm">
                        {project.name}
                      </span>
                      {project.subject && (
                        <span className="text-xs text-muted-foreground">
                          {t(SUBJECT_LABEL_KEYS[project.subject])}
                        </span>
                      )}
                      <span className="data-num text-xs text-muted-foreground lab:font-mono">
                        {t('fileManager.courseStats', {
                          count: docs.length,
                          size: formatBytes(bytes),
                        })}
                      </span>
                      <Link
                        to={`/projects/${project.id}/files`}
                        className="focus-ring ml-auto rounded-sm text-xs text-primary hover:underline coarse:py-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {t('fileManager.openCourseFiles')}
                      </Link>
                    </summary>
                    <div className="pt-2">
                      <DocumentList
                        documents={docs}
                        loading={!loadedMap[project.id]}
                        projectId={project.id}
                        onUploadClick={() => navigate(`/projects/${project.id}/files`)}
                        onRename={async (id, name) => {
                          const doc = docs.find((d) => d.id === id)
                          if (doc) await actions.rename(doc, name)
                        }}
                        onDelete={async () => undefined}
                        onDeleteRequest={actions.requestDelete}
                        onMoveToFolder={actions.requestMove}
                        onChangeMaterialType={actions.requestMaterialType}
                        showMaterialType
                        groupFolders
                        groupBy={groupBy}
                        filters={filters}
                        selection={selection}
                        batchBar={false}
                      />
                    </div>
                  </details>
                )
              })}
              {narrowed && allMatches.length === 0 && !loadingDocs && (
                <EmptyState
                  title={t('documents.noMatches')}
                  description={t('documents.noMatchesHint')}
                />
              )}
            </div>
          )}
        </div>
      </PageContent>
      {actions.dialogs}
    </PageContainer>
  )
}
