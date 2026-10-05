import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS, type Project, type Subject } from '@/entities/project/types'
import { inferSubject } from '@/entities/project/subjectInference'
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
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Textarea } from '@/shared/ui/Textarea'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
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
  const [subject, setSubject] = useState<Subject>('other')
  // Until the student picks a subject, it follows the name ("线性代数" →
  // Linear Algebra); unrecognised names stay "Other", never a guess.
  const [subjectTouched, setSubjectTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // `/projects?new=1` (from the homepage) opens the create dialog directly.
  // The flag is removed at once so a reload or Back does not reopen it.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    openCreate()
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Most recently touched first, the same order as the homepage.
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)

  function openCreate() {
    setDialog({ mode: 'create' })
    setName('')
    setSubject('other')
    setSubjectTouched(false)
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
        // A new project is empty: go straight to it, where uploading starts.
        setDialog(null)
        navigate(`/projects/${project.id}`)
        return
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
          <ul className="hairline-list stagger-in max-w-5xl overflow-hidden rounded-2xl border border-border/80 bg-card">
            {sorted.map((p) => (
              <li key={p.id}>
                <ProjectRow
                  project={p}
                  onRename={() => openRename(p.id, p.name)}
                  onDelete={() => setDeleteCandidate({ id: p.id, name: p.name })}
                />
              </li>
            ))}
          </ul>
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
                onChange={(e) => {
                  setName(e.target.value)
                  if (dialog?.mode === 'create' && !subjectTouched) {
                    setSubject(inferSubject(e.target.value) ?? 'other')
                  }
                }}
                placeholder={t('projects.namePlaceholder')}
                autoFocus
                maxLength={80}
              />
            </div>
            {dialog?.mode === 'create' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="subject">{t('projects.subject')}</Label>
                  <Select
                    value={subject}
                    onValueChange={(v) => {
                      setSubject(v as Subject)
                      setSubjectTouched(true)
                    }}
                  >
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

/**
 * One project per row, matching the homepage list: the row opens the project,
 * the trailing menu holds rename / delete (kept outside the link so the two
 * controls never nest).
 */
function ProjectRow({
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
    <div className="group flex items-center gap-2 pr-3 transition-colors hover:bg-accent/50">
      <Link
        to={`/projects/${project.id}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-4 rounded-lg py-4 pl-5"
      >
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-theme-primary-soft text-base font-semibold text-secondary-foreground"
        >
          {project.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <TruncatedText
            as="span"
            text={project.name}
            className="block text-[15px] font-medium text-foreground"
          />
          <span className="block truncate text-[13px] text-muted-foreground">
            {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
            {t('projects.updatedAt', { date: relativeTime(project.updatedAt) })}
            {project.description ? ` · ${project.description}` : ''}
          </span>
        </span>
        <ArrowRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
        />
      </Link>
      <ProjectActionsMenu project={project} onRename={onRename} onDelete={onDelete} />
    </div>
  )
}
