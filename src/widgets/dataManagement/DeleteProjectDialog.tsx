import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
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
import { Badge } from '@/shared/ui/Badge'
import { DataManagementService } from '@/services/dataManagementService'
import { ProjectService } from '@/services/projectService'
import type { Project } from '@/entities/project/types'
import { SUBJECT_LABELS } from '@/entities/project/types'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { canConfirmProjectDeletion } from '@/shared/lib/deletion'
import { cn } from '@/shared/lib/utils'

export interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful deletion so the caller can refresh. */
  onDeleted: () => void | Promise<void>
  /**
   * When the caller already knows which project is in context, it may be
   * pre-selected. The user still has to confirm by typing the name.
   */
  initialProjectId?: string
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  onDeleted,
  initialProjectId,
}: DeleteProjectDialogProps): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null)
  const [confirmInput, setConfirmInput] = useState('')
  const [busy, setBusy] = useState(false)

  // Load the project list each time the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    new ProjectService()
      .list()
      .then((list) => {
        if (cancelled) return
        setProjects(list)
        // Only honour a pre-selection that still exists. Never guess.
        setSelectedId((prev) => (prev && list.some((p) => p.id === prev) ? prev : null))
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Could not load projects')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setConfirmInput('')
      setSelectedId(initialProjectId ?? null)
    }
  }, [open, initialProjectId])

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const canDelete = canConfirmProjectDeletion(selected, confirmInput) && !busy

  async function handleDelete() {
    if (!selected || !canDelete) return
    setBusy(true)
    try {
      await new DataManagementService().deleteProject(selected.id)
      toast({ variant: 'success', title: 'Project deleted', description: selected.name })
      onOpenChange(false)
      await onDeleted()
    } catch (err) {
      const msg = isAppError(err) ? err.message : (err as Error).message
      toast({ variant: 'error', title: 'Could not delete project', description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Delete a project
          </DialogTitle>
          <DialogDescription>
            Permanently removes the project and everything inside it — documents, chunks, quizzes,
            mistakes, tutor sessions, and course analysis. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
          </div>
        ) : loadError ? (
          <p className="py-4 text-sm text-destructive">{loadError}</p>
        ) : projects.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">There are no projects to delete.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label id="delete-project-label">Select the project to delete</Label>
              <div
                role="radiogroup"
                aria-labelledby="delete-project-label"
                className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1"
              >
                {projects.map((project) => {
                  const active = project.id === selectedId
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={busy}
                      onClick={() => {
                        setSelectedId(project.id)
                        setConfirmInput('')
                      }}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span
                          className={cn(
                            'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                            active && 'border-2 border-foreground',
                          )}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{project.name}</span>
                        <Badge variant="outline" className="ml-auto shrink-0">
                          {SUBJECT_LABELS[project.subject]}
                        </Badge>
                      </span>
                      <span className="pl-6 font-mono text-[11px] text-muted-foreground">
                        {project.id}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {selected && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">Project: </span>
                  <span className="font-medium">{selected.name}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">ID: </span>
                  <span className="break-all font-mono text-xs">{selected.id}</span>
                </div>
                <div className="space-y-2 pt-1">
                  <Label htmlFor="delete-project-confirm">
                    Type <span className="font-mono text-foreground">{selected.name}</span> to confirm
                  </Label>
                  <Input
                    id="delete-project-confirm"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={selected.name}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    invalid={confirmInput.length > 0 && confirmInput !== selected.name}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={!canDelete}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
