import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { useExams, useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useProjects } from '@/features/project/useProjects'
import { toast } from '@/features/toast/toastStore'
import type { CourseOptions } from '@/services/studyPlanService'
import {
  EMPTY_MATERIALS,
  type PlannedExam,
  type PlannedExamMaterials,
  type PlannedExamScope,
} from '@/entities/studyPlan/types'
import { countdownParts } from '@/entities/studyPlan/countdown'
import { formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const SCOPE_KEYS: Record<PlannedExamScope['kind'], TranslationKey> = {
  course: 'plan.scope.course',
  syllabus: 'plan.scope.syllabus',
  topics: 'plan.scope.topics',
}

interface Draft {
  key: string
  projectId: string
  name: string
  date: string
  time: string
  /** `course`, `topics`, or `syllabus:<documentId>:<scopeId>`. */
  scope: string
  topicIds: string[]
  materials: PlannedExamMaterials
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
    materials: { ...EMPTY_MATERIALS },
  }
}

function scopeOf(draft: Draft): PlannedExamScope {
  if (draft.scope === 'topics') return { kind: 'topics', topicIds: draft.topicIds }
  if (draft.scope.startsWith('syllabus:')) {
    const [, documentId, scopeId] = draft.scope.split(':')
    return { kind: 'syllabus', documentId: documentId!, scopeId: scopeId! }
  }
  return { kind: 'course' }
}

/**
 * 考试设置: the planned exams, and a form that adds several at once (course,
 * name, date and time, scope from the course's exam-topic list or topics, and
 * the materials to use).
 */
export function ExamSetup({ projectId }: { projectId?: string }): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const { exams, refresh } = useExams(projectId)
  const { projects } = useProjects()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<PlannedExam | null>(null)
  const courseName = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
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
        })),
      )
      await service.replan()
      setDrafts([])
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

  return (
    <section className="space-y-5" data-plan-exams>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">{t('plan.exams.title')}</h2>
        <Button size="sm" onClick={() => setDrafts((list) => [...list, newDraft(projectId)])}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('plan.exams.add')}
        </Button>
      </div>

      {exams.length === 0 && drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('plan.exams.none')}</p>
      )}
      {exams.length > 0 && (
        <ul className="divide-y rounded-md border lab:rounded-none">
          {exams.map((exam) => {
            const left = countdownParts(Date.now(), exam.at)
            return (
              <li key={exam.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
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
                    {t(SCOPE_KEYS[exam.scope.kind])}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('plan.exams.delete', { name: exam.name })}
                  onClick={() => setDeleting(exam)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
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
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
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
            <Button size="sm" disabled={saving} onClick={() => void save()}>
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

function DraftRow({
  index,
  draft,
  fixedProject,
  projects,
  onChange,
  onRemove,
}: {
  index: number
  draft: Draft
  fixedProject: string | undefined
  projects: Array<{ id: string; name: string }>
  onChange: (draft: Draft) => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const [options, setOptions] = useState<CourseOptions | null>(null)
  useEffect(() => {
    if (!draft.projectId) {
      setOptions(null)
      return
    }
    let alive = true
    void service
      .courseOptions(draft.projectId)
      .then((result) => {
        if (alive) setOptions(result)
      })
      .catch(() => {
        if (alive) setOptions(null)
      })
    return () => {
      alive = false
    }
  }, [service, draft.projectId])
  const id = (field: string) => `exam-${draft.key}-${field}`
  const toggle = (field: keyof PlannedExamMaterials, value: string) => {
    const list = draft.materials[field]
    onChange({
      ...draft,
      materials: {
        ...draft.materials,
        [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      },
    })
  }
  const materialGroups: Array<{
    field: keyof PlannedExamMaterials
    label: string
    items: Array<{ id: string; title: string }>
  }> = options
    ? [
        { field: 'pastExamSetIds', label: t('plan.materials.pastExams'), items: options.pastExams },
        {
          field: 'reviewDocumentIds',
          label: t('plan.materials.review'),
          items: options.reviewDocuments,
        },
        {
          field: 'practiceSetIds',
          label: t('plan.materials.practice'),
          items: options.practiceSets,
        },
        { field: 'homeworkSetIds', label: t('plan.materials.homework'), items: options.homework },
      ]
    : []

  return (
    <fieldset className="space-y-3 rounded-md border p-3 lab:rounded-none" data-exam-draft>
      <legend className="px-1 text-sm font-medium">
        {t('plan.exams.rowTitle', { n: index + 1 })}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={id('course')}>{t('plan.exams.course')}</Label>
          <select
            id={id('course')}
            className="focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm"
            value={draft.projectId}
            disabled={!!fixedProject}
            onChange={(event) =>
              onChange({
                ...draft,
                projectId: event.target.value,
                scope: 'course',
                topicIds: [],
                materials: { ...EMPTY_MATERIALS },
              })
            }
          >
            <option value="">{t('plan.exams.chooseCourse')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
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
      </div>

      {options && (
        <div className="space-y-1">
          <Label htmlFor={id('scope')}>{t('plan.exams.scope')}</Label>
          <select
            id={id('scope')}
            className="focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm sm:w-auto"
            value={draft.scope}
            onChange={(event) => onChange({ ...draft, scope: event.target.value })}
          >
            <option value="course">{t('plan.scope.course')}</option>
            {options.scopes.map((scope) => (
              <option
                key={`${scope.documentId}:${scope.scopeId}`}
                value={`syllabus:${scope.documentId}:${scope.scopeId}`}
              >
                {t('plan.scope.syllabusItem', { label: scope.label, count: scope.topics })}
              </option>
            ))}
            {options.topics.length > 0 && <option value="topics">{t('plan.scope.topics')}</option>}
          </select>
          {draft.scope === 'topics' && (
            <div className="mt-2 flex max-h-48 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
              {options.topics.map((topic) => (
                <label key={topic.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.topicIds.includes(topic.id)}
                    onChange={() =>
                      onChange({
                        ...draft,
                        topicIds: draft.topicIds.includes(topic.id)
                          ? draft.topicIds.filter((each) => each !== topic.id)
                          : [...draft.topicIds, topic.id],
                      })
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {materialGroups.some((group) => group.items.length > 0) && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('plan.materials.title')}</p>
          {materialGroups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.field} className="space-y-1">
                <p className="text-xs text-muted-foreground">{group.label}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {group.items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.materials[group.field].includes(item.id)}
                        onChange={() => toggle(group.field, item.id)}
                      />
                      {item.title}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          <p className="text-xs text-muted-foreground">{t('plan.materials.hint')}</p>
        </div>
      )}

      <Button size="sm" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4" aria-hidden />
        {t('plan.exams.removeRow')}
      </Button>
    </fieldset>
  )
}
