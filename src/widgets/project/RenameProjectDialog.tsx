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
import type { Project } from '@/entities/project/types'
import { useTranslation } from '@/i18n'

export interface RenameProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onRename: (name: string) => Promise<void>
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
}: RenameProjectDialogProps): JSX.Element {
  const { t } = useTranslation()
  const inputId = useId()
  const [name, setName] = useState(project.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to the current name each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(project.name)
      setError(null)
      setBusy(false)
    }
  }, [open, project.name])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed !== project.name && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onRename(trimmed)
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
            <DialogTitle>{t('renameProject.title')}</DialogTitle>
            <DialogDescription>{t('renameProject.description')}</DialogDescription>
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
