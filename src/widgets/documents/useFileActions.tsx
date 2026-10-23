import { useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import {
  resolveMaterialType,
  type Document,
  type LearningMaterialType,
} from '@/entities/document/types'
import { listFolders, normalizeFolderPath } from '@/entities/document/folders'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { reprocessDocument } from '@/features/documents/uploadPipeline'
import { toast } from '@/features/toast/toastStore'
import type { DocumentDeleteImpact } from '@/services/documentService'
import { useTranslation } from '@/i18n'
import { MaterialTypeSelect } from './MaterialTypeSelect'

/**
 * Single-file actions shared by the course files page and 设置 → 文件管理:
 * delete with its impact / protection dialog, move to a folder, change the
 * material type. Every action works on the file's own course (`projectId`).
 */
export interface FileActions {
  requestDelete: (doc: Document) => void
  requestMove: (doc: Document) => void
  requestMaterialType: (doc: Document) => void
  rename: (doc: Document, name: string) => Promise<void>
  /** Render once next to the lists. */
  dialogs: JSX.Element
}

export function useFileActions(
  /** Files of the courses involved, for the folder suggestions. */
  documents: readonly Document[],
): FileActions {
  const { t } = useTranslation()
  const store = {
    describeDelete: useDocumentsStore((s) => s.describeDelete),
    remove: useDocumentsStore((s) => s.remove),
    moveToFolder: useDocumentsStore((s) => s.moveToFolder),
    changeMaterialType: useDocumentsStore((s) => s.changeMaterialType),
    refresh: useDocumentsStore((s) => s.refresh),
    rename: useDocumentsStore((s) => s.rename),
  }
  const [impact, setImpact] = useState<DocumentDeleteImpact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [moving, setMoving] = useState<Document | null>(null)
  const [moveValue, setMoveValue] = useState('')
  const [typing, setTyping] = useState<Document | null>(null)
  const [typeValue, setTypeValue] = useState<LearningMaterialType>('textbook')
  const [typeBusy, setTypeBusy] = useState(false)
  const folders = useMemo(
    () => (moving ? listFolders(documents.filter((d) => d.projectId === moving.projectId)) : []),
    [documents, moving],
  )

  const fail = (title: string, err: unknown): void => {
    toast({
      variant: 'error',
      title,
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const requestDelete = (doc: Document): void => {
    void store
      .describeDelete(doc.id, doc.projectId)
      .then(setImpact)
      .catch((err: unknown) => fail(t('documents.deleteFailed'), err))
  }

  const confirmDelete = async (): Promise<void> => {
    if (!impact || deleting) return
    setDeleting(true)
    try {
      await store.remove(impact.document.id, impact.document.projectId)
      toast({ variant: 'success', title: t('documents.deleted') })
      setImpact(null)
    } catch (err) {
      fail(t('documents.deleteFailed'), err)
    } finally {
      setDeleting(false)
    }
  }

  const confirmMove = async (): Promise<void> => {
    if (!moving) return
    try {
      await store.moveToFolder(moving.id, moving.projectId, normalizeFolderPath(moveValue))
      toast({ variant: 'success', title: t('files.moved') })
      setMoving(null)
    } catch (err) {
      fail(t('files.moveFailed'), err)
    }
  }

  const confirmType = async (): Promise<void> => {
    if (!typing || typeBusy) return
    const doc = typing
    setTypeBusy(true)
    try {
      const { needsReprocess } = await store.changeMaterialType(doc.id, doc.projectId, typeValue)
      toast({ variant: 'success', title: t('fileBatch.typeChanged', { name: doc.name }) })
      setTyping(null)
      if (needsReprocess) {
        toast({ variant: 'info', title: t('documents.reprocessing', { name: doc.name }) })
        await reprocessDocument(doc.id)
        await store.refresh(doc.projectId)
      }
    } catch (err) {
      fail(t('fileBatch.typeFailed'), err)
    } finally {
      setTypeBusy(false)
    }
  }

  const rename = async (doc: Document, name: string): Promise<void> => {
    try {
      await store.rename(doc.id, doc.projectId, name)
      toast({ variant: 'success', title: t('documents.renamed') })
    } catch (err) {
      fail(t('documents.renameFailed'), err)
    }
  }

  const removes: string[] = impact
    ? [
        impact.removes.chunks > 0
          ? t('files.removes.chunks', { count: impact.removes.chunks })
          : '',
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

  const dialogs = (
    <>
      <Dialog
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) setMoving(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('files.moveTitle', { name: moving?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('files.moveHint')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="move-folder">{t('files.folder')}</Label>
          <Input
            id="move-folder"
            list="move-folder-options"
            value={moveValue}
            placeholder={t('files.folderPlaceholder')}
            onChange={(event) => setMoveValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void confirmMove()
              }
            }}
            autoFocus
          />
          <datalist id="move-folder-options">
            {folders.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmMove()} data-move-confirm>
              {t('files.moveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={typing !== null}
        onOpenChange={(open) => {
          if (!open && !typeBusy) setTyping(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('fileBatch.typeTitleOne', { name: typing?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('fileBatch.typeHint')}</DialogDescription>
          </DialogHeader>
          <MaterialTypeSelect value={typeValue} onChange={setTypeValue} id="file-type-one" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTyping(null)} disabled={typeBusy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmType()} disabled={typeBusy} data-type-confirm>
              {typeBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('fileBatch.typeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Button
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t('files.deleteConfirm')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return {
    requestDelete,
    requestMove: (doc) => {
      setMoving(doc)
      setMoveValue(doc.folderPath ?? '')
    },
    requestMaterialType: (doc) => {
      setTyping(doc)
      setTypeValue(resolveMaterialType(doc.materialType))
    },
    rename,
    dialogs,
  }
}
