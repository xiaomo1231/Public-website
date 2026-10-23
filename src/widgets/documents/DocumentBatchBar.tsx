import { useMemo, useRef, useState } from 'react'
import {
  FlaskConical,
  FolderInput,
  Layers,
  Loader2,
  RotateCcw,
  Square,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import { listFolders } from '@/entities/document/folders'
import {
  EVAL_ROLES,
  EVAL_ROLE_LABEL_KEYS,
  resolveEvalRole,
  type EvalRole,
} from '@/entities/evaluation/evalRole'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Progress } from '@/shared/ui/Progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/utils'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import type { DocumentSelection } from '@/features/documents/useDocumentSelection'
import {
  runDocumentBatch,
  type DocumentBatchAction,
  type DocumentBatchDeps,
  type DocumentBatchProgress,
  type DocumentBatchResult,
} from '@/features/documents/documentBatch'
import { canMergePhotos, defaultMergedName } from '@/features/documents/photoMerge'
import { useTranslation, type TranslationKey } from '@/i18n'
import { MaterialTypeSelect } from './MaterialTypeSelect'

/**
 * The 已选 n 个文件 bar with the batch actions (2o). Shared by the course
 * files page, 设置 → 文件管理 (selection across courses) and the exam
 * workspace's 资料 tab. Renders nothing while nothing is selected and no
 * batch is running or reporting.
 */
export interface DocumentBatchBarProps {
  selection: DocumentSelection
  /** Every file the selection may refer to (ids are resolved against it). */
  documents: readonly Document[]
  /** After a batch finished (lists are already refreshed). */
  onDone?: (result: DocumentBatchResult) => void
  /** Test seam: the batch runner's dependencies. */
  deps?: DocumentBatchDeps
  className?: string
}

type Pending =
  'delete' | 'materialType' | 'folder' | 'reprocess' | 'evalRole' | 'mergePhotos' | null

const ACTION_TITLE: Record<DocumentBatchAction['kind'], TranslationKey> = {
  delete: 'fileBatch.action.delete',
  materialType: 'fileBatch.action.materialType',
  folder: 'fileBatch.action.folder',
  reprocess: 'fileBatch.action.reprocess',
  evalRole: 'fileBatch.action.evalRole',
  mergePhotos: 'fileBatch.action.mergePhotos',
}

export function DocumentBatchBar({
  selection,
  documents,
  onDone,
  deps,
  className,
}: DocumentBatchBarProps): JSX.Element | null {
  const { t } = useTranslation()
  const refresh = useDocumentsStore((s) => s.refresh)
  const [pending, setPending] = useState<Pending>(null)
  const [materialType, setMaterialType] = useState<LearningMaterialType>('textbook')
  const [folder, setFolder] = useState('')
  const [evalRole, setEvalRole] = useState<EvalRole | ''>('')
  const [mergeName, setMergeName] = useState('')
  const [deleteOriginals, setDeleteOriginals] = useState(false)
  const [progress, setProgress] = useState<DocumentBatchProgress | null>(null)
  const [stopping, setStopping] = useState(false)
  const [result, setResult] = useState<DocumentBatchResult | null>(null)
  const stopRef = useRef(false)

  const chosen = useMemo(
    () => documents.filter((doc) => selection.selected.has(doc.id)),
    [documents, selection.selected],
  )
  const courseCount = useMemo(() => new Set(chosen.map((d) => d.projectId)).size, [chosen])
  const folders = useMemo(() => {
    const courses = new Set(chosen.map((d) => d.projectId))
    return listFolders(documents.filter((d) => courses.has(d.projectId)))
  }, [chosen, documents])

  // 合并为一份试卷: ≥2 photos of one course.
  const mergeable = useMemo(() => canMergePhotos(chosen), [chosen])
  const running = progress !== null
  const showBar = chosen.length > 0 || running
  if (!showBar && !result) return null

  const start = async (action: DocumentBatchAction): Promise<void> => {
    const targets = chosen
    setPending(null)
    stopRef.current = false
    setStopping(false)
    setProgress({ completed: 0, total: targets.length })
    try {
      const outcome = await runDocumentBatch(targets, action, {
        ...(deps ? { deps } : {}),
        shouldContinue: () => !stopRef.current,
        onProgress: setProgress,
      })
      await Promise.all(outcome.projectIds.map((pid) => refresh(pid).catch(() => undefined)))
      if (action.kind === 'delete' || (action.kind === 'mergePhotos' && action.deleteOriginals)) {
        selection.setMany(
          outcome.outcomes.filter((o) => o.status === 'done').map((o) => o.document.id),
          false,
        )
      }
      setResult(outcome)
      onDone?.(outcome)
    } finally {
      setProgress(null)
      setStopping(false)
    }
  }

  const btn = 'coarse:min-h-11'
  const current = progress?.current

  return (
    <>
      {showBar && (
        <div
          role="region"
          aria-label={t('fileBatch.barLabel')}
          data-batch-bar
          className={cn(
            'sticky top-0 z-20 flex flex-wrap items-center gap-2 border border-primary/40 bg-card px-3 py-2 text-sm shadow-sm lecture:rounded-lg lab:rounded-none lab:shadow-none',
            className,
          )}
        >
          {running ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3" aria-live="polite">
              <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
              <span className="data-num min-w-0 break-words">
                {stopping
                  ? t('fileBatch.stopping')
                  : t('fileBatch.progress', {
                      done: progress.completed,
                      total: progress.total,
                      name: current?.name ?? '',
                    })}
              </span>
              <Progress
                value={progress.total ? (progress.completed / progress.total) * 100 : 0}
                className="h-1.5 w-32"
              />
              <Button
                variant="outline"
                size="sm"
                className={btn}
                disabled={stopping}
                onClick={() => {
                  stopRef.current = true
                  setStopping(true)
                }}
                data-batch-stop
              >
                <Square className="h-3.5 w-3.5" />
                {t('fileBatch.stop')}
              </Button>
            </div>
          ) : (
            <>
              <span className="data-num font-medium" data-batch-count>
                {courseCount > 1
                  ? t('fileBatch.selectedCourses', { count: chosen.length, courses: courseCount })
                  : t('fileBatch.selected', { count: chosen.length })}
              </span>
              {chosen.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className={btn}
                    onClick={() => setPending('materialType')}
                  >
                    <Tags className="h-4 w-4" />
                    {t('fileBatch.action.materialType')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={btn}
                    onClick={() => {
                      setFolder('')
                      setPending('folder')
                    }}
                  >
                    <FolderInput className="h-4 w-4" />
                    {t('fileBatch.action.folder')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={btn}
                    onClick={() => setPending('reprocess')}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('fileBatch.action.reprocess')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={btn}
                    onClick={() => {
                      const roles = new Set(chosen.map((d) => resolveEvalRole(d.evalRole) ?? ''))
                      setEvalRole(roles.size === 1 ? [...roles][0]! : '')
                      setPending('evalRole')
                    }}
                  >
                    <FlaskConical className="h-4 w-4" />
                    {t('fileBatch.action.evalRole')}
                  </Button>
                  {mergeable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={btn}
                      onClick={() => {
                        setMergeName(defaultMergedName(chosen))
                        setDeleteOriginals(false)
                        setPending('mergePhotos')
                      }}
                      data-batch-merge
                    >
                      <Layers className="h-4 w-4" />
                      {t('fileBatch.action.mergePhotos')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(btn, 'text-destructive hover:text-destructive')}
                    onClick={() => setPending('delete')}
                    data-batch-delete
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('fileBatch.action.delete')}
                  </Button>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className={cn(btn, 'ml-auto')}
                onClick={() => {
                  selection.clear()
                  setResult(null)
                }}
              >
                <X className="h-4 w-4" />
                {t('fileBatch.clear')}
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending
                ? t('fileBatch.confirmTitle', {
                    action: t(ACTION_TITLE[pending]),
                    count: chosen.length,
                  })
                : ''}
            </DialogTitle>
            <DialogDescription>
              {pending === 'delete' && t('fileBatch.deleteHint')}
              {pending === 'materialType' && t('fileBatch.typeHint')}
              {pending === 'folder' && t('fileBatch.folderHint')}
              {pending === 'reprocess' && t('fileBatch.reprocessHint')}
              {pending === 'evalRole' && t('fileBatch.evalRoleHint')}
              {pending === 'mergePhotos' && t('fileBatch.mergeHint')}
            </DialogDescription>
          </DialogHeader>
          {pending === 'materialType' && (
            <MaterialTypeSelect value={materialType} onChange={setMaterialType} id="batch-type" />
          )}
          {pending === 'folder' && (
            <div className="space-y-1.5">
              <Label htmlFor="batch-folder">{t('files.folder')}</Label>
              <Input
                id="batch-folder"
                list="batch-folder-options"
                value={folder}
                placeholder={t('files.folderPlaceholder')}
                onChange={(event) => setFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void start({ kind: 'folder', folderPath: folder })
                  }
                }}
                autoFocus
              />
              <datalist id="batch-folder-options">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              {courseCount > 1 && (
                <p className="text-xs text-muted-foreground" data-cross-course-note>
                  {t('fileBatch.folderCrossCourse', { courses: courseCount })}
                </p>
              )}
            </div>
          )}
          {pending === 'evalRole' && (
            <div className="space-y-1.5">
              <Label htmlFor="batch-eval-role">{t('evalRole.label')}</Label>
              <select
                id="batch-eval-role"
                value={evalRole}
                onChange={(event) => setEvalRole(resolveEvalRole(event.target.value) ?? '')}
                className="focus-ring h-11 w-full rounded-lg border border-input bg-background px-2 text-sm lab:rounded-sm"
              >
                <option value="">{t('evalRole.none')}</option>
                {EVAL_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(EVAL_ROLE_LABEL_KEYS[role])}
                  </option>
                ))}
              </select>
            </div>
          )}
          {pending === 'mergePhotos' && (
            <div className="space-y-3" data-merge-form>
              <div className="space-y-1.5">
                <Label htmlFor="batch-merge-name">{t('fileBatch.merge.name')}</Label>
                <Input
                  id="batch-merge-name"
                  value={mergeName}
                  onChange={(event) => setMergeName(event.target.value)}
                  autoFocus
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={deleteOriginals}
                  onChange={(event) => setDeleteOriginals(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary coarse:h-5 coarse:w-5"
                  data-merge-delete-originals
                />
                <span>
                  {t('fileBatch.merge.deleteOriginals')}
                  <span className="block text-xs text-muted-foreground">
                    {t('fileBatch.merge.deleteOriginalsHint')}
                  </span>
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={pending === 'delete' ? 'destructive' : 'default'}
              data-batch-confirm
              onClick={() => {
                if (pending === 'delete') void start({ kind: 'delete' })
                else if (pending === 'materialType')
                  void start({ kind: 'materialType', materialType })
                else if (pending === 'folder') void start({ kind: 'folder', folderPath: folder })
                else if (pending === 'reprocess') void start({ kind: 'reprocess' })
                else if (pending === 'evalRole') {
                  void start({ kind: 'evalRole', evalRole: evalRole || undefined })
                } else if (pending === 'mergePhotos') {
                  void start({
                    kind: 'mergePhotos',
                    deleteOriginals,
                    ...(mergeName.trim() ? { name: mergeName.trim() } : {}),
                  })
                }
              }}
            >
              {pending ? t(ACTION_TITLE[pending]) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) setResult(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {result
                ? t('fileBatch.resultTitle', { action: t(ACTION_TITLE[result.action.kind]) })
                : ''}
            </DialogTitle>
            <DialogDescription data-batch-summary>
              {result &&
                t('fileBatch.resultSummary', {
                  done: result.done,
                  skipped: result.skipped,
                  failed: result.failed,
                })}
              {result?.merged
                ? ` ${t('fileBatch.merge.created', { name: result.merged.name })}`
                : ''}
              {result?.stopped
                ? ` ${t('fileBatch.resultStopped', {
                    count: result.outcomes.filter((o) => o.status === 'not-run').length,
                  })}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {result && result.skipped + result.failed > 0 && (
            <ul className="space-y-2 text-sm" data-batch-issues>
              {result.outcomes
                .filter((o) => o.status === 'skipped' || o.status === 'failed')
                .map((o) => (
                  <li
                    key={o.document.id}
                    className="border-l-2 border-border pl-3"
                    data-batch-issue={o.status}
                  >
                    <p className="break-words font-medium">{o.document.name}</p>
                    <p className="break-words text-muted-foreground">
                      {t(o.status === 'skipped' ? 'fileBatch.skipped' : 'fileBatch.failed', {
                        reason: o.reason ?? '',
                      })}
                    </p>
                  </li>
                ))}
            </ul>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
