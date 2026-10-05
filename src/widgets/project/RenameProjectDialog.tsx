import { useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { SUBJECT_LABEL_KEYS, type Project, type Subject } from '@/entities/project/types'
import { useTranslation, type TranslationKey } from '@/i18n'

const SUBJECT_OPTIONS = Object.entries(SUBJECT_LABEL_KEYS) as [Subject, TranslationKey][]

export interface RenameProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onRename: (name: string) => Promise<void>
  /**
   * When provided, the dialog edits the subject too ("Edit project"). The
   * subject steers every AI prompt for the course, so it must stay editable.
   */
  onChangeSubject?: (subject: Subject) => Promise<void>
}

/**
 * Rename dialog. Replaces the previous `window.prompt` flow.
 * Submits on Enter, blocks double submission while saving, and surfaces
 * errors inline instead of via `window.alert`.
 */
export function RenameProjectDialog({
  open,
  onOpenChange,
  project,
  onRename,
  onChangeSubject,
}: RenameProjectDialogProps): JSX.Element {
  const { t } = useTranslation()
  const inputId = useId()
  const subjectId = useId()
  const [name, setName] = useState(project.name)
  const [subject, setSubject] = useState<Subject>(project.subject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to the current name each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(project.name)
      setSubject(project.subject)
      setError(null)
      setBusy(false)
    }
  }, [open, project.name, project.subject])

  const trimmed = name.trim()
  const nameChanged = trimmed !== project.name
  const subjectChanged = Boolean(onChangeSubject) && subject !== project.subject
  const canSubmit = trimmed.length > 0 && (nameChanged || subjectChanged) && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (nameChanged) await onRename(trimmed)
      if (subjectChanged) await onChangeSubject?.(subject)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('renameProject.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {t(onChangeSubject ? 'renameProject.editTitle' : 'renameProject.title')}
            </DialogTitle>
            <DialogDescription>
              {t(onChangeSubject ? 'renameProject.editDescription' : 'renameProject.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={inputId}>{t('renameProject.label')}</Label>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              disabled={busy}
              invalid={Boolean(error)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {onChangeSubject && (
            <div className="space-y-2">
              <Label htmlFor={subjectId}>{t('renameProject.subject')}</Label>
              <Select
                value={subject}
                onValueChange={(value) => setSubject(value as Subject)}
                disabled={busy}
              >
                <SelectTrigger id={subjectId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_OPTIONS.map(([value, key]) => (
                    <SelectItem key={value} value={value}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('renameProject.subjectHint')}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
