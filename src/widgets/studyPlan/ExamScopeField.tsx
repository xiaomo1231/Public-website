import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { Label } from '@/shared/ui/Label'
import type { CourseOptions } from '@/services/studyPlanService'
import type { PlannedExamMaterials } from '@/entities/studyPlan/types'
import type { ChapterOption } from '@/entities/studyPlan/scope'
import { toggleIn } from '@/entities/studyPlan/materials'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface ScopeValue {
  /** `course`, `materials`, `chapters`, `topics`, or `syllabus:<documentId>:<scopeId>`. */
  scope: string
  topicIds: string[]
  /** `chapter:<id>` / `section:<id>` / `file:<documentId>` (see `entities/studyPlan/scope.ts`). */
  chapterKeys: string[]
}

function hasMaterials(materials: PlannedExamMaterials): boolean {
  return (
    (materials.documentIds?.length ?? 0) +
      (materials.folderPaths?.length ?? 0) +
      materials.reviewDocumentIds.length +
      materials.pastExamSetIds.length +
      materials.homeworkSetIds.length +
      materials.practiceSetIds.length >
    0
  )
}

/**
 * 考试范围: whole course, the picked materials, chapters (from the detected
 * structure; works before course analysis), syllabus scopes and topics. A
 * source that is missing says why, with a link to where to fix it; nothing is
 * started from here.
 */
export function ExamScopeField({
  id,
  projectId,
  options,
  value,
  materials,
  onChange,
}: {
  id: string
  projectId: string
  options: CourseOptions
  value: ScopeValue
  materials: PlannedExamMaterials
  onChange: (value: ScopeValue) => void
}): JSX.Element {
  const { t } = useTranslation()
  const hintId = `${id}-hint`
  const base = `/projects/${projectId}`
  const hints: Array<{ key: string; text: string; link?: { to: string; label: string } }> = []
  if (value.scope === 'materials')
    hints.push({
      key: 'materials',
      text: t(
        hasMaterials(materials) ? 'plan.scope.hint.materials' : 'plan.scope.hint.materialsEmpty',
      ),
    })
  if (value.scope === 'chapters')
    hints.push({
      key: 'chapters',
      text: t(
        value.chapterKeys.length > 0 ? 'plan.scope.hint.chapters' : 'plan.scope.hint.chaptersEmpty',
      ),
    })
  if (options.chapters.length === 0)
    hints.push({ key: 'noChapters', text: t('plan.scope.hint.noChapters') })
  if (options.scopes.length === 0)
    hints.push({
      key: 'syllabus',
      text: t(
        options.hasSyllabus ? 'plan.scope.hint.syllabusNoScopes' : 'plan.scope.hint.noSyllabus',
      ),
      link: { to: `${base}?tab=exams`, label: t('plan.scope.link.syllabus') },
    })
  if (options.topics.length === 0)
    hints.push(
      options.analysis === 'running'
        ? { key: 'analysis', text: t('plan.scope.hint.analysisRunning') }
        : {
            key: 'analysis',
            text: t('plan.scope.hint.noAnalysis'),
            link: { to: `${base}?tab=analysis`, label: t('plan.scope.link.analysis') },
          },
    )

  return (
    <div className="space-y-2" data-exam-scope>
      <Label htmlFor={id}>{t('plan.exams.scope')}</Label>
      <select
        id={id}
        className="focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm lab:rounded-none coarse:h-11 sm:w-auto"
        value={value.scope}
        aria-describedby={hints.length ? hintId : undefined}
        onChange={(event) => onChange({ ...value, scope: event.target.value })}
      >
        <option value="course">{t('plan.scope.course')}</option>
        <option value="materials">{t('plan.scope.materials')}</option>
        {options.chapters.length > 0 && (
          <option value="chapters">{t('plan.scope.chapters')}</option>
        )}
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
      {hints.length > 0 && (
        <ul id={hintId} className="space-y-1 text-xs text-muted-foreground" data-scope-hints>
          {hints.map((hint) => (
            <li key={hint.key} className="flex items-start gap-1.5" data-scope-hint={hint.key}>
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {hint.text}
                {hint.link && (
                  <>
                    {' '}
                    <Link
                      to={hint.link.to}
                      className="font-medium text-primary underline-offset-2 hover:underline coarse:inline-block coarse:py-2"
                    >
                      {hint.link.label}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {value.scope === 'chapters' && (
        <ChapterChecklist
          id={id}
          chapters={options.chapters}
          selected={value.chapterKeys}
          onToggle={(key) => onChange({ ...value, chapterKeys: toggleIn(value.chapterKeys, key) })}
        />
      )}
      {value.scope === 'topics' && (
        <fieldset className="space-y-1" data-topic-checklist>
          <legend className="text-xs font-medium text-muted-foreground">
            {t('plan.scope.topicList')}
          </legend>
          <ul className="grid max-h-64 gap-x-4 overflow-y-auto sm:grid-cols-2">
            {options.topics.map((topic) => (
              <li key={topic.id}>
                <CheckRow
                  id={`${id}-topic-${topic.id}`}
                  checked={value.topicIds.includes(topic.id)}
                  onChange={() =>
                    onChange({ ...value, topicIds: toggleIn(value.topicIds, topic.id) })
                  }
                >
                  {topic.name}
                </CheckRow>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  )
}

function CheckRow({
  id,
  checked,
  disabled,
  indent,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  indent?: boolean
  onChange: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted/60 lab:rounded-none',
        indent && 'pl-8',
        disabled && 'cursor-default opacity-70',
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="focus-ring h-4 w-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  )
}

function ChapterChecklist({
  id,
  chapters,
  selected,
  onToggle,
}: {
  id: string
  chapters: ChapterOption[]
  selected: string[]
  onToggle: (key: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const chosen = new Set(selected)
  const groups: Array<{ documentId: string; name: string; rows: ChapterOption[] }> = []
  for (const option of chapters) {
    const last = groups[groups.length - 1]
    if (last && last.documentId === option.documentId) last.rows.push(option)
    else groups.push({ documentId: option.documentId, name: option.documentName, rows: [option] })
  }
  const pages = (option: ChapterOption) =>
    option.pageStart
      ? option.pageEnd && option.pageEnd !== option.pageStart
        ? t('plan.scope.pages', { start: option.pageStart, end: option.pageEnd })
        : t('plan.scope.page', { start: option.pageStart })
      : ''
  return (
    <fieldset className="space-y-1" data-chapter-checklist>
      <legend className="text-xs font-medium text-muted-foreground">
        {t('plan.scope.chapterList')}
      </legend>
      <ul className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-1 lab:rounded-none">
        {groups.map((group) => (
          <li key={group.documentId}>
            {group.rows[0]!.kind !== 'file' && (
              <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{group.name}</p>
            )}
            <ul>
              {group.rows.map((option) => {
                const viaChapter = !!option.parentKey && chosen.has(option.parentKey)
                const extra = pages(option)
                return (
                  <li key={option.key}>
                    <CheckRow
                      id={`${id}-${option.key}`}
                      checked={chosen.has(option.key) || viaChapter}
                      disabled={viaChapter}
                      indent={option.kind === 'section'}
                      onChange={() => onToggle(option.key)}
                    >
                      {option.kind === 'file' ? (
                        <>
                          {option.title}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {t('plan.scope.wholeFile')}
                          </span>
                        </>
                      ) : (
                        <>
                          {option.number ? `${option.number} ` : ''}
                          {option.title}
                          {extra && (
                            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                              {extra}
                            </span>
                          )}
                        </>
                      )}
                    </CheckRow>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
