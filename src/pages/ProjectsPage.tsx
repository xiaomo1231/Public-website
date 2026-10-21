import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS, type Project, type Subject } from '@/entities/project/types'
import { inferCourse } from '@/entities/project/subjectInference'
import { SubjectDetailsFields } from '@/widgets/project/SubjectDetailsFields'
import { subjectDetailsFor, type ExamStyleChoice } from '@/widgets/project/subjectDetails'
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
import { cn, formatDate, relativeTime } from '@/shared/lib/utils'
import { useUiStyle } from '@/features/theme/useAppearance'
import { LAB_CHIP_CLASS, LAB_TABLE_HEAD_CLASS } from '@/widgets/dashboard/Figures'
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
  const [targetLanguage, setTargetLanguage] = useState('')
  const [examStyle, setExamStyle] = useState<ExamStyleChoice>('auto')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string } | null>(null)
  const navigate = useNavigate()
  const { uiStyle } = useUiStyle()
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
    setTargetLanguage('')
    setExamStyle('auto')
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
        const details = subjectDetailsFor(subject, targetLanguage, examStyle)
        const project = await create({
          name: name.trim(),
          subject,
          ...(details.targetLanguage ? { targetLanguage: details.targetLanguage } : {}),
          ...(details.examStyle ? { examStyle: details.examStyle } : {}),
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
        ) : uiStyle === 'lab' ? (
          <ProjectTable
            projects={sorted}
            onRename={(p) => openRename(p.id, p.name)}
            onDelete={(p) => setDeleteCandidate({ id: p.id, name: p.name })}
          />
        ) : (
          <ul className="stagger-in max-w-4xl border-t-[1.5px] border-foreground">
            {sorted.map((p) => (
              <li key={p.id} className="border-b border-border">
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
                    const inferred = inferCourse(e.target.value)
                    setSubject(inferred?.subject ?? 'other')
                    setTargetLanguage(inferred?.targetLanguage ?? '')
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
                <SubjectDetailsFields
                  subject={subject}
                  targetLanguage={targetLanguage}
                  onTargetLanguageChange={setTargetLanguage}
                  examStyle={examStyle}
                  onExamStyleChange={setExamStyle}
                />
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
 * Lecture: one project per ruled row, the name set in the serif. The row opens
 * the project; the trailing menu holds rename / delete (kept outside the link
 * so the two controls never nest).
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
    <div className="group flex items-center gap-2">
      <Link
        to={`/projects/${project.id}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-4 rounded-sm py-4"
      >
        <span className="min-w-0 flex-1">
          <TruncatedText
            as="span"
            text={project.name}
            className="block font-heading text-[19px] font-bold leading-snug text-foreground transition-colors duration-200 group-hover:text-primary"
          />
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {t(SUBJECT_LABEL_KEYS[project.subject])} ·{' '}
            {t('projects.updatedAt', { date: relativeTime(project.updatedAt) })}
            {project.description ? ` · ${project.description}` : ''}
          </span>
        </span>
        <ArrowRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-primary transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
        />
      </Link>
      <ProjectActionsMenu project={project} onRename={onRename} onDelete={onDelete} />
    </div>
  )
}

/** Lab: a hairline table — name, subject chip, mono date, actions. */
function ProjectTable({
  projects,
  onRename,
  onDelete,
}: {
  projects: Project[]
  onRename: (project: Project) => void
  onDelete: (project: Project) => void
}): JSX.Element {
  const { t } = useTranslation()
  const head = 'px-3.5 py-2 text-left font-medium'
  const cell = 'border-t border-border px-3.5 py-2.5 align-middle'
  return (
    <div className="max-w-5xl overflow-x-auto border border-border bg-card">
      <table className="data-num w-full min-w-[520px] table-fixed border-collapse text-[13.5px]">
        <thead className={LAB_TABLE_HEAD_CLASS}>
          <tr>
            <th scope="col" className={head}>
              {t('projects.table.name')}
            </th>
            <th scope="col" className={cn(head, 'w-40')}>
              {t('projects.table.subject')}
            </th>
            <th scope="col" className={cn(head, 'w-32')}>
              {t('projects.table.updated')}
            </th>
            <th scope="col" className={cn(head, 'w-12')}>
              <span className="sr-only">{t('projects.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="transition-colors duration-150 hover:bg-accent/50">
              <td className={cell}>
                <Link
                  to={`/projects/${project.id}`}
                  className="focus-ring block min-w-0 rounded-sm"
                >
                  <TruncatedText
                    as="span"
                    text={project.name}
                    className="font-medium text-foreground"
                  />
                  {project.description && (
                    <span
                      className="block truncate text-xs text-muted-foreground"
                      title={project.description}
                    >
                      {project.description}
                    </span>
                  )}
                </Link>
              </td>
              <td className={cell}>
                <span className={LAB_CHIP_CLASS}>{t(SUBJECT_LABEL_KEYS[project.subject])}</span>
              </td>
              <td className={cn(cell, 'font-mono text-xs text-muted-foreground')}>
                <time
                  dateTime={new Date(project.updatedAt).toISOString()}
                  title={relativeTime(project.updatedAt)}
                >
                  {formatDate(project.updatedAt)}
                </time>
              </td>
              <td className={cn(cell, 'px-1.5 text-right')}>
                <ProjectActionsMenu
                  project={project}
                  onRename={() => onRename(project)}
                  onDelete={() => onDelete(project)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
