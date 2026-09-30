import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS, type Project, type Subject } from '@/entities/project/types'
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shared/ui/Select2'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { Badge } from '@/shared/ui/Badge'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { relativeTime } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const SUBJECT_OPTIONS = Object.entries(SUBJECT_LABEL_KEYS) as [Subject, TranslationKey][]

export function ProjectsPage(): JSX.Element {
  const { t } = useTranslation()
  const { projects, loading, loaded, create, rename, remove } = useProjects()
  const [dialog, setDialog] = useState<
    null | { mode: 'create' } | { mode: 'rename'; id: string; name: string }
  >(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState<Subject>('calculus')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null)

  // Hierarchy over uniformity: the most recently studied course is the page's
  // primary entrance; the rest are a quieter, denser grid beneath it.
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  const primary = sorted[0]
  const rest = sorted.slice(1)

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
        const project = await create({
          name: name.trim(),
          subject,
          description: description.trim(),
        })
        toast({ variant: 'success', title: t('projects.created'), description: project.name })
      } else {
        await rename(dialog.id, name.trim())
        toast({ variant: 'success', title: t('projects.renamed') })
      }
      setDialog(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('projects.saveFailed')
      toast({ variant: 'error', title: t('projects.saveFailedTitle'), description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return
    try {
      await remove(deleteCandidate.id)
      toast({ variant: 'success', title: t('projects.deleted') })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('projects.deleteFailed')
      toast({ variant: 'error', title: t('projects.deleteFailedTitle'), description: msg })
    } finally {
      setDeleteCandidate(null)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('projects.title')}
        description={t('projects.subtitle')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('projects.newProject')}
          </Button>
        }
      />
      <PageContent>
        {!loaded && loading ? (
          <LoadingState label={t('projects.loading')} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="h-10 w-10" />}
            title={t('projects.empty')}
            description={t('projects.emptyHint')}
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('projects.createFirst')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {primary && (
              <ProjectSpotlight
                project={primary}
                onRename={() => openRename(primary.id, primary.name)}
                onDelete={() => setDeleteCandidate({ id: primary.id, name: primary.name })}
              />
            )}
            {rest.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {rest.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onRename={() => openRename(p.id, p.name)}
                    onDelete={() => setDeleteCandidate({ id: p.id, name: p.name })}
                  />
                ))}
              </div>
            )}
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
            <DialogTitle>
              {dialog?.mode === 'create'
                ? t('projects.dialog.newTitle')
                : t('projects.dialog.renameTitle')}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === 'create'
                ? t('projects.dialog.newDescription')
                : t('projects.dialog.renameDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('projects.name')}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projects.namePlaceholder')}
                autoFocus
                maxLength={80}
              />
            </div>
            {dialog?.mode === 'create' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="subject">{t('projects.subject')}</Label>
                  <Select value={subject} onValueChange={(v) => setSubject(v as Subject)}>
                    <SelectTrigger id="subject">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_OPTIONS.map(([id, labelKey]) => (
                        <SelectItem key={id} value={id}>
                          {t(labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">{t('projects.description')}</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('projects.descriptionPlaceholder')}
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={submitting || !name.trim()}>
              {submitting
                ? t('projects.saving')
                : dialog?.mode === 'create'
                  ? t('common.create')
                  : t('common.save')}
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
            <DialogTitle>{t('projects.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('projects.deleteBody', { name: deleteCandidate?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCandidate(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {t('projects.deleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function ProjectActionsMenu({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('projects.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/projects/${project.id}`}>
            <FolderKanban className="h-4 w-4" />
            {t('projects.open')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-4 w-4" />
          {t('projects.rename')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4" />
          {t('projects.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The primary entrance: the most recently studied course. */
function ProjectSpotlight({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="blueprint-frame relative overflow-hidden rounded-[1.5rem] border border-border/60 bg-card shadow-lift">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="plate-grid grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border/70 bg-background font-mono text-xl font-semibold text-primary"
          >
            {project.name.slice(0, 1)}
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <TruncatedText
                as="h3"
                text={project.name}
                className="text-lg font-semibold tracking-tight text-foreground"
              />
              <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                {t(SUBJECT_LABEL_KEYS[project.subject])}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="label-mono">
                {t('projects.updatedAt', { date: relativeTime(project.updatedAt) })}
              </span>
              <span aria-hidden>·</span>
              <span>{t('projects.createdAt', { date: relativeTime(project.createdAt) })}</span>
            </div>
            {project.description && (
              <p className="line-clamp-2 max-w-xl text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild>
            <Link to={`/projects/${project.id}`}>
              {t('projects.openProject')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <ProjectActionsMenu project={project} onRename={onRename} onDelete={onDelete} />
        </div>
      </div>
    </div>
  )
}

/** A quieter entry in the grid beneath the spotlight. */
function ProjectCard({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <Card variant="interactive" className="overflow-hidden">
      <div aria-hidden className="subject-plate relative h-20 bg-theme-primary-soft/40">
        <div className="plate-grid absolute inset-0" />
        <span className="absolute left-4 top-3 font-mono text-xl font-semibold text-primary">
          {project.name.slice(0, 1)}
        </span>
        <FolderKanban
          className="absolute bottom-2.5 right-4 h-7 w-7 text-primary opacity-60"
          strokeWidth={1.4}
        />
      </div>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <TruncatedText
            as="h3"
            text={project.name}
            className="text-base font-semibold leading-none tracking-tight"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('projects.createdAt', { date: relativeTime(project.createdAt) })}
          </p>
        </div>
        <ProjectActionsMenu project={project} onRename={onRename} onDelete={onDelete} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t(SUBJECT_LABEL_KEYS[project.subject])}</Badge>
          <span className="text-xs text-muted-foreground">
            {t('projects.updatedAt', { date: relativeTime(project.updatedAt) })}
          </span>
        </div>
        {project.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to={`/projects/${project.id}`}>{t('projects.openProject')}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
