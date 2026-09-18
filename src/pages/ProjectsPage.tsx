import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABELS, type Subject } from '@/entities/project/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/shared/ui/Select2'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Badge } from '@/shared/ui/Badge'
import { relativeTime } from '@/shared/lib/utils'

const SUBJECT_OPTIONS = Object.entries(SUBJECT_LABELS) as [Subject, string][]

export function ProjectsPage(): JSX.Element {
  const { projects, loading, loaded, create, rename, remove } = useProjects()
  const [dialog, setDialog] = useState<null | { mode: 'create' } | { mode: 'rename'; id: string; name: string }>(
    null,
  )
  const [name, setName] = useState('')
  const [subject, setSubject] = useState<Subject>('calculus')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null)

  function openCreate() {
    setDialog({ mode: 'create' })
    setName('')
    setSubject('calculus')
    setDescription('')
  }

  function openRename(id: string, currentName: string) {
    setDialog({ mode: 'rename', id, name: currentName })
    setName(currentName)
  }

  async function submit() {
    if (!dialog) return
    setSubmitting(true)
    try {
      if (dialog.mode === 'create') {
        const project = await create({ name: name.trim(), subject, description: description.trim() })
        toast({ variant: 'success', title: 'Project created', description: project.name })
      } else {
        await rename(dialog.id, name.trim())
        toast({ variant: 'success', title: 'Project renamed' })
      }
      setDialog(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save project'
      toast({ variant: 'error', title: 'Save failed', description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return
    try {
      await remove(deleteCandidate.id)
      toast({ variant: 'success', title: 'Project deleted' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete project'
      toast({ variant: 'error', title: 'Delete failed', description: msg })
    } finally {
      setDeleteCandidate(null)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description="Each project isolates its documents, lessons, and progress."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        }
      />
      <PageContent>
        {!loaded && loading ? (
          <LoadingState label="Loading projects" />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="h-10 w-10" />}
            title="No projects yet"
            description="Create your first project to start uploading course materials and organising your study."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Create your first project
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <Card key={p.id} className="transition-colors hover:border-foreground/20">
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{p.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {relativeTime(p.createdAt)}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Project actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/projects/${p.id}`}>
                          <FolderKanban className="h-4 w-4" />
                          Open
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openRename(p.id, p.name)}>
                        <Pencil className="h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleteCandidate({ id: p.id, name: p.name })}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{SUBJECT_LABELS[p.subject]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Updated {relativeTime(p.updatedAt)}
                    </span>
                  </div>
                  {p.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                  )}
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/projects/${p.id}`}>Open project</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageContent>

      {/* Create / rename dialog */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'create' ? 'New project' : 'Rename project'}</DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'create'
                ? 'Give your study project a clear name and pick a subject.'
                : 'Pick a new name for this project.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Calculus I"
                autoFocus
                maxLength={80}
              />
            </div>
            {dialog?.mode === 'create' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Select value={subject} onValueChange={(v) => setSubject(v as Subject)}>
                    <SelectTrigger id="subject">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_OPTIONS.map(([id, label]) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What will you study in this project?"
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || !name.trim()}>
              {submitting ? 'Saving…' : dialog?.mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{deleteCandidate?.name}</span> and all its data will be
              permanently removed from this device. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCandidate(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}