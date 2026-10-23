import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ClipboardPaste,
  Pencil,
  NotebookText,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { useExams, useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useExamTools } from '@/features/studyPlan/useExamTools'
import { useProjects } from '@/features/project/useProjects'
import { toast } from '@/features/toast/toastStore'
import type { CourseOptions } from '@/services/studyPlanService'
import {
  EMPTY_MATERIALS,
  type PlannedExam,
  type PlannedExamMaterials,
  type PlannedExamScope,
} from '@/entities/studyPlan/types'
import { normalizeMaterials } from '@/entities/studyPlan/materials'
import { findDuplicate, type PastedExam } from '@/entities/studyPlan/examPaste'
import { inferCourse } from '@/entities/project/subjectInference'
import { countdownParts } from '@/entities/studyPlan/countdown'
import { cn, formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { PasteExamImport } from './PasteExamImport'
import { ExamMaterialsPicker } from './ExamMaterialsPicker'
import { reviewSheetLink } from './taskLinks'
import { ExamScopeField, type ScopeValue } from './ExamScopeField'
import { scopeLabel } from './scopeLabels'
import { chapterKeysOf, chaptersScopeFromKeys } from '@/entities/studyPlan/scope'
import { dayKey } from '@/entities/studyPlan/calendar'

interface Draft {
  key: string
  projectId: string
  name: string
  date: string
  time: string
  /** `course`, `materials`, `chapters`, `topics`, or `syllabus:<documentId>:<scopeId>`. */
  scope: string
  topicIds: string[]
  /** Chosen chapters (`chapter:` / `section:` / `file:` keys). */
  chapterKeys: string[]
  materials: PlannedExamMaterials
  location?: string
  durationMinutes?: number
  /** 粘贴识别: what it was read from, and the course as written. */
  sourceText?: string
  courseText?: string
  origin?: 'local' | 'ai'
}

function newDraft(projectId = ''): Draft {
  return {
    key: crypto.randomUUID(),
    projectId,
    name: '',
    date: '',
    time: '09:00',
    scope: 'course',
    topicIds: [],
    chapterKeys: [],
    materials: { ...EMPTY_MATERIALS },
  }
}

function draftFromPaste(exam: PastedExam, fixedProject: string | undefined): Draft {
  return {
    ...newDraft(fixedProject ?? exam.projectId ?? ''),
    name: exam.name,
    date: exam.date,
    time: exam.time || '09:00',
    ...(exam.location ? { location: exam.location } : {}),
    ...(exam.durationMinutes ? { durationMinutes: exam.durationMinutes } : {}),
    sourceText: exam.sourceText,
    ...(exam.courseText ? { courseText: exam.courseText } : {}),
    origin: exam.origin,
  }
}

function scopeOf(draft: ScopeValue): PlannedExamScope {
  if (draft.scope === 'topics') return { kind: 'topics', topicIds: draft.topicIds }
  if (draft.scope === 'materials') return { kind: 'materials' }
  if (draft.scope === 'chapters') return chaptersScopeFromKeys(draft.chapterKeys)
  if (draft.scope.startsWith('syllabus:')) {
    const [, documentId, scopeId] = draft.scope.split(':')
    return { kind: 'syllabus', documentId: documentId!, scopeId: scopeId! }
  }
  return { kind: 'course' }
}

/** The form value of a stored scope. */
function scopeValueOf(scope: PlannedExamScope): ScopeValue {
  const base: ScopeValue = { scope: 'course', topicIds: [], chapterKeys: [] }
  switch (scope.kind) {
    case 'topics':
      return { ...base, scope: 'topics', topicIds: [...scope.topicIds] }
    case 'syllabus':
      return { ...base, scope: `syllabus:${scope.documentId}:${scope.scopeId}` }
    case 'materials':
      return { ...base, scope: 'materials' }
    case 'chapters':
      return { ...base, scope: 'chapters', chapterKeys: chapterKeysOf(scope) }
    default:
      return base
  }
}

function timeOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** A course's files etc. for the forms, reloaded on demand (after an upload). */
function useCourseOptions(projectId: string): {
  options: CourseOptions | null
  reload: () => Promise<void>
} {
  const service = useStudyPlanService()
  const [options, setOptions] = useState<CourseOptions | null>(null)
  const reload = useCallback(async () => {
    if (!projectId) {
      setOptions(null)
      return
    }
    try {
      setOptions(await service.courseOptions(projectId))
    } catch {
      setOptions(null)
    }
  }, [service, projectId])
  useEffect(() => {
    let alive = true
    if (!projectId) {
      setOptions(null)
      return
    }
    void service
      .courseOptions(projectId)
      .then((result) => {
        if (alive) setOptions(result)
      })
      .catch(() => {
        if (alive) setOptions(null)
      })
    return () => {
      alive = false
    }
  }, [service, projectId])
  return { options, reload }
}

/**
 * 考试设置: the planned exams, a form that adds several at once (course,
 * name, date and time, scope, the files and folders to use), and 粘贴识别 —
 * paste text or a screenshot of the schedule to fill the form. Nothing is
 * saved until 保存.
 */
export function ExamSetup({ projectId }: { projectId?: string }): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const tools = useExamTools()
  const { exams, refresh } = useExams(projectId)
  const { projects, create: createProject } = useProjects()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<PlannedExam | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const courseName = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const courses = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  )

  async function save() {
    const ready = drafts.filter((draft) => draft.projectId && draft.name.trim() && draft.date)
    if (ready.length === 0) {
      toast({ variant: 'warning', title: t('plan.exams.incomplete') })
      return
    }
    setSaving(true)
    try {
      await service.addExams(
        ready.map((draft) => ({
          projectId: draft.projectId,
          name: draft.name,
          at: new Date(`${draft.date}T${draft.time || '09:00'}`).getTime(),
          scope: scopeOf(draft),
          materials: draft.materials,
          ...(draft.location ? { location: draft.location } : {}),
          ...(draft.durationMinutes ? { durationMinutes: draft.durationMinutes } : {}),
        })),
      )
      await service.replan()
      // Rows that were not complete stay in the form.
      setDrafts((list) => list.filter((draft) => !ready.includes(draft)))
      refresh()
      toast({ variant: 'success', title: t('plan.exams.saved', { count: ready.length }) })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  async function newCourse(draft: Draft): Promise<void> {
    const name = (draft.courseText ?? '').trim()
    if (!name) return
    try {
      const inferred = inferCourse(name)
      const project = await createProject({
        name,
        subject: inferred?.subject ?? 'other',
        ...(inferred?.targetLanguage ? { targetLanguage: inferred.targetLanguage } : {}),
      })
      // Every draft naming this course moves to the new one.
      setDrafts((list) =>
        list.map((item) =>
          !item.projectId && item.courseText?.trim().toLowerCase() === name.toLowerCase()
            ? { ...item, projectId: project.id }
            : item,
        ),
      )
      toast({ variant: 'success', title: t('plan.paste.courseCreated', { name }) })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <section className="space-y-5" data-plan-exams>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">{t('plan.exams.title')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={pasteOpen}
            onClick={() => setPasteOpen((open) => !open)}
          >
            <ClipboardPaste className="h-4 w-4" aria-hidden />
            {t('plan.paste.open')}
          </Button>
          <Button size="sm" onClick={() => setDrafts((list) => [...list, newDraft(projectId)])}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('plan.exams.add')}
          </Button>
        </div>
      </div>

      {pasteOpen && (
        <PasteExamImport
          service={tools.schedule}
          hasAI={tools.hasAI}
          courses={projectId ? courses.filter((c) => c.id === projectId) : courses}
          {...(projectId ? { defaultProjectId: projectId } : {})}
          onClose={() => setPasteOpen(false)}
          onDrafts={(found) =>
            setDrafts((list) => [...list, ...found.map((exam) => draftFromPaste(exam, projectId))])
          }
        />
      )}

      {exams.length === 0 && drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('plan.exams.none')}</p>
      )}
      {exams.length > 0 && (
        <ul className="divide-y rounded-md border lab:rounded-none">
          {exams.map((exam) => {
            const left = countdownParts(Date.now(), exam.at)
            const sheet = exam.review?.sections ?? []
            const sheetDone = sheet.filter((s) => s.status === 'done').length
            return (
              <li key={exam.id} className="space-y-3 px-3 py-2.5" data-exam-row={exam.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {exam.name}
                      <span className="font-normal text-muted-foreground">
                        {' · '}
                        {courseName.get(exam.projectId) ?? ''}
                      </span>
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(exam.at)} ·{' '}
                      {left.past
                        ? t('plan.exams.past')
                        : t('plan.countdown.daysHours', { days: left.days, hours: left.hours })}
                      {' · '}
                      {scopeLabel(exam.scope, t)}
                      {exam.location ? ` · ${exam.location}` : ''}
                      {exam.durationMinutes
                        ? ` · ${t('plan.exams.duration', { minutes: exam.durationMinutes })}`
                        : ''}
                    </p>
                    {exam.review?.scopeChangedAt !== undefined && (
                      <p
                        className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                        data-review-outdated
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        {t('plan.review.scopeChanged')}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={editing === exam.id}
                    onClick={() => setEditing((id) => (id === exam.id ? null : exam.id))}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    {t('plan.exams.edit')}
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to={reviewSheetLink(exam)} data-review-link>
                      <NotebookText className="h-4 w-4" aria-hidden />
                      {sheet.length > 0
                        ? t('plan.review.openWithCount', { done: sheetDone, total: sheet.length })
                        : t('plan.review.open')}
                    </Link>
                  </Button>
                  {!left.past && (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/projects/${exam.projectId}/homework?aiMock=${encodeURIComponent(exam.id)}`}
                      >
                        <Sparkles className="h-4 w-4" aria-hidden />
                        {t('aiMock.generate')}
                      </Link>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('plan.exams.delete', { name: exam.name })}
                    onClick={() => setDeleting(exam)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                {editing === exam.id && (
                  <SavedExamEditor
                    exam={exam}
                    courseName={courseName.get(exam.projectId) ?? ''}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null)
                      refresh()
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {drafts.length > 0 && (
        <div className="space-y-4">
          {drafts.map((draft, index) => (
            <DraftRow
              key={draft.key}
              index={index}
              draft={draft}
              fixedProject={projectId}
              projects={courses}
              duplicate={findDuplicate(draft, exams)}
              onNewCourse={() => void newCourse(draft)}
              onChange={(next) =>
                setDrafts((list) => list.map((item) => (item.key === draft.key ? next : item)))
              }
              onRemove={() => setDrafts((list) => list.filter((item) => item.key !== draft.key))}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDrafts((list) => [...list, newDraft(projectId)])}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('plan.exams.addRow')}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()} data-exams-save>
              {t('plan.exams.saveAll', { count: drafts.length })}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('plan.exams.deleteTitle')}
        description={t('plan.exams.deleteHint', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={async () => {
          if (!deleting) return
          await service.deleteExam(deleting.id)
          await service.replan()
          setDeleting(null)
          refresh()
        }}
      />
    </section>
  )
}

/**
 * Edit a saved exam in place: name, date and time, location and length, the
 * 考试范围 and the materials. The course stays (another course = delete and
 * add again). 保存 updates the row and lays the plan out again.
 */
function SavedExamEditor({
  exam,
  courseName,
  onSaved,
  onCancel,
}: {
  exam: PlannedExam
  courseName: string
  onSaved: () => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { options, reload } = useCourseOptions(exam.projectId)
  const [name, setName] = useState(exam.name)
  const [date, setDate] = useState(dayKey(exam.at))
  const [time, setTime] = useState(timeOf(exam.at))
  const [location, setLocation] = useState(exam.location ?? '')
  const [duration, setDuration] = useState<number | undefined>(exam.durationMinutes)
  const [scope, setScope] = useState<ScopeValue>(() => scopeValueOf(exam.scope))
  const [materials, setMaterials] = useState(() => normalizeMaterials(exam.materials))
  const [saving, setSaving] = useState(false)
  const id = (field: string) => `edit-${exam.id}-${field}`
  if (!options) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  async function save() {
    if (!name.trim() || !date) {
      toast({ variant: 'warning', title: t('plan.exams.incomplete') })
      return
    }
    setSaving(true)
    try {
      await service.updateExam(exam.id, {
        name,
        at: new Date(`${date}T${time || '09:00'}`).getTime(),
        location,
        durationMinutes: duration ?? 0,
        scope: scopeOf(scope),
        materials,
      })
      await service.replan()
      toast({ variant: 'success', title: t('plan.exams.updated') })
      onSaved()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('plan.errors.actionFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 border-t pt-3" data-exam-editor>
      <p className="text-xs text-muted-foreground" data-course-fixed>
        {t('plan.exams.courseFixed', { course: courseName })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={id('name')}>{t('plan.exams.name')}</Label>
          <Input id={id('name')} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('date')}>{t('plan.exams.date')}</Label>
          <Input
            id={id('date')}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('time')}>{t('plan.exams.time')}</Label>
          <Input
            id={id('time')}
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('location')}>{t('plan.exams.location')}</Label>
          <Input
            id={id('location')}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('duration')}>{t('plan.exams.durationLabel')}</Label>
          <Input
            id={id('duration')}
            type="number"
            min={5}
            max={720}
            value={duration ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value)
              setDuration(value > 0 ? value : undefined)
            }}
          />
        </div>
      </div>
      <ExamScopeField
        id={id('scope')}
        projectId={exam.projectId}
        options={options}
        value={scope}
        materials={materials}
        onChange={setScope}
      />
      <ExamMaterialsPicker
        projectId={exam.projectId}
        idPrefix={`saved-${exam.id}`}
        documents={options.documents}
        value={materials}
        onChange={setMaterials}
        onUploaded={reload}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()} data-exam-edit-save>
          {t('plan.exams.saveEdit')}
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

function DraftRow({
  index,
  draft,
  fixedProject,
  projects,
  duplicate,
  onNewCourse,
  onChange,
  onRemove,
}: {
  index: number
  draft: Draft
  fixedProject: string | undefined
  projects: Array<{ id: string; name: string }>
  duplicate: { id: string; name: string } | undefined
  onNewCourse: () => void
  onChange: (draft: Draft) => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { options, reload } = useCourseOptions(draft.projectId)
  const id = (field: string) => `exam-${draft.key}-${field}`
  const needsCourse = !draft.projectId

  return (
    <fieldset className="space-y-3 rounded-md border p-3 lab:rounded-none" data-exam-draft>
      <legend className="px-1 text-sm font-medium">
        {t('plan.exams.rowTitle', { n: index + 1 })}
        {draft.origin && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t(draft.origin === 'ai' ? 'plan.paste.fromAI' : 'plan.paste.fromPaste')}
          </span>
        )}
      </legend>
      {draft.sourceText && (
        <p className="whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          {t('plan.paste.source')} {draft.sourceText}
        </p>
      )}
      {duplicate && (
        <p
          className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-exam-duplicate
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {t('plan.paste.duplicate', { name: duplicate.name })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={id('course')}>{t('plan.exams.course')}</Label>
          <select
            id={id('course')}
            className={cn(
              'focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm lab:rounded-none',
              needsCourse && draft.origin && 'border-amber-500 ring-1 ring-amber-500',
            )}
            value={draft.projectId}
            disabled={!!fixedProject}
            aria-invalid={needsCourse && !!draft.origin}
            onChange={(event) =>
              onChange({
                ...draft,
                projectId: event.target.value,
                scope: 'course',
                topicIds: [],
                chapterKeys: [],
                materials: { ...EMPTY_MATERIALS },
              })
            }
            data-draft-course
          >
            <option value="">{t('plan.exams.chooseCourse')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {needsCourse && draft.courseText && (
            <Button
              size="sm"
              variant="link"
              className="h-auto px-0"
              onClick={onNewCourse}
              data-new-course
            >
              {t('plan.paste.newCourse', { name: draft.courseText })}
            </Button>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('name')}>{t('plan.exams.name')}</Label>
          <Input
            id={id('name')}
            value={draft.name}
            placeholder={t('plan.exams.namePlaceholder')}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('date')}>{t('plan.exams.date')}</Label>
          <Input
            id={id('date')}
            type="date"
            value={draft.date}
            onChange={(event) => onChange({ ...draft, date: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('time')}>{t('plan.exams.time')}</Label>
          <Input
            id={id('time')}
            type="time"
            value={draft.time}
            onChange={(event) => onChange({ ...draft, time: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('location')}>{t('plan.exams.location')}</Label>
          <Input
            id={id('location')}
            value={draft.location ?? ''}
            onChange={(event) => onChange({ ...draft, location: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('duration')}>{t('plan.exams.durationLabel')}</Label>
          <Input
            id={id('duration')}
            type="number"
            min={5}
            max={720}
            value={draft.durationMinutes ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value)
              const { durationMinutes: _old, ...rest } = draft
              void _old
              onChange(value > 0 ? { ...rest, durationMinutes: value } : rest)
            }}
          />
        </div>
      </div>

      {options && draft.projectId && (
        <ExamScopeField
          id={id('scope')}
          projectId={draft.projectId}
          options={options}
          value={draft}
          materials={draft.materials}
          onChange={(value) => onChange({ ...draft, ...value })}
        />
      )}

      {options && draft.projectId && (
        <ExamMaterialsPicker
          projectId={draft.projectId}
          idPrefix={`draft-${draft.key}`}
          documents={options.documents}
          value={draft.materials}
          onChange={(materials) => onChange({ ...draft, materials })}
          onUploaded={reload}
        />
      )}

      <Button size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4" aria-hidden />
        {t('plan.exams.removeRow')}
      </Button>
    </fieldset>
  )
}
