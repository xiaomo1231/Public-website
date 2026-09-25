import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/features/toast/toastStore'
import { useProjects } from '@/features/project/useProjects'
import { SUBJECT_LABEL_KEYS, type Subject } from '@/entities/project/types'
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
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <Card key={p.id} variant="interactive" className="course-cover overflow-hidden">
                <div aria-hidden className="course-cover__art">
                  <FolderKanban />
                  <span>✦</span>
                </div>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                  <div className="min-w-0">
                    <TruncatedText
                      as="h3"
                      text={p.name}
                      className="text-base font-semibold leading-none tracking-tight"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('projects.createdAt', { date: relativeTime(p.createdAt) })}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t('projects.actions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/projects/${p.id}`}>
                          <FolderKanban className="h-4 w-4" />
                          {t('projects.open')}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openRename(p.id, p.name)}>
                        <Pencil className="h-4 w-4" />
                        {t('projects.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeleteCandidate({ id: p.id, name: p.name })}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('projects.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{t(SUBJECT_LABEL_KEYS[p.subject])}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {t('projects.updatedAt', { date: relativeTime(p.updatedAt) })}
                    </span>
                  </div>
                  {p.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                  )}
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/projects/${p.id}`}>{t('projects.openProject')}</Link>
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
