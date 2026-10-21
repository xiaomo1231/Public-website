import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Document } from '@/entities/document/types'
import type { ExamScopeSelection } from '@/entities/quiz/types'
import type { SyllabusData } from '@/entities/syllabus/types'
import { SyllabusService } from '@/services/syllabusService'
import { loadProjectSubjectContext } from '@/services/projectSubject'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { useTranslation } from '@/i18n'

export interface ExamScopeChoice {
  selection: ExamScopeSelection
  /** Shown as the quiz's topic: the scope label or the exam topic text. */
  label: string
}

export interface ExamScopePickerProps {
  projectId: string
  value: ExamScopeChoice | null
  onChange: (value: ExamScopeChoice | null) => void
}

const NONE = '__none__'
const WHOLE = '__whole__'

/**
 * Optional exam-scope selection for the quiz setup: a scope of the course
 * syllabus, or one exam topic of it, and whether exam topics the course
 * material does not cover may be quizzed (AI questions without a course
 * source). Renders nothing when the course has no syllabus with topics.
 * A link from the exam-topic list (`?examDoc=…&examScope=…&examTopic=…`)
 * preselects its scope / topic.
 */
export function ExamScopePicker({
  projectId,
  value,
  onChange,
}: ExamScopePickerProps): JSX.Element | null {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [syllabi, setSyllabi] = useState<Array<{ document: Document; data: SyllabusData }>>([])
  const [defaultInclude, setDefaultInclude] = useState(false)
  const preselected = useRef(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      new SyllabusService().listSyllabi(projectId),
      loadProjectSubjectContext(projectId),
    ])
      .then(([rows, subject]) => {
        if (cancelled) return
        setSyllabi(rows)
        setDefaultInclude(subject?.subject === 'medicine' && subject.examStyle === 'international')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId])

  const scopes = useMemo(
    () =>
      syllabi.flatMap(({ document, data }) =>
        data.scopes.map((scope) => ({
          key: `${document.id}::${scope.id}`,
          documentId: document.id,
          documentName: document.name,
          scope,
        })),
      ),
    [syllabi],
  )

  const choose = (
    key: string,
    examTopicId: string | undefined,
    includeUnmatched: boolean,
  ): ExamScopeChoice | null => {
    const entry = scopes.find((item) => item.key === key)
    if (!entry) return null
    const topic = examTopicId
      ? entry.scope.topics.find((item) => item.id === examTopicId)
      : undefined
    return {
      selection: {
        documentId: entry.documentId,
        scopeId: entry.scope.id,
        ...(topic ? { examTopicId: topic.id } : {}),
        includeUnmatched,
      },
      label: topic?.text ?? (entry.scope.label || t('syllabus.scopeUntitled')),
    }
  }

  // Preselect from the exam-topic list link, once the scopes are known.
  useEffect(() => {
    if (preselected.current || scopes.length === 0) return
    preselected.current = true
    const doc = params.get('examDoc')
    const scope = params.get('examScope')
    if (!doc || !scope) return
    onChange(choose(`${doc}::${scope}`, params.get('examTopic') ?? undefined, defaultInclude))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes, defaultInclude])

  if (scopes.length === 0) return null

  const currentKey = value ? `${value.selection.documentId}::${value.selection.scopeId}` : NONE
  const current = scopes.find((item) => item.key === currentKey)
  const severalFiles = new Set(scopes.map((item) => item.documentId)).size > 1

  return (
    <div className="space-y-3 border-t pt-4 lecture:border-border lab:border-border">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quiz-exam-scope">{t('syllabus.quiz.scope')}</Label>
          <Select
            value={currentKey}
            onValueChange={(key) =>
              onChange(key === NONE ? null : choose(key, undefined, defaultInclude))
            }
          >
            <SelectTrigger id="quiz-exam-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('syllabus.quiz.noScope')}</SelectItem>
              {scopes.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {(item.scope.label || t('syllabus.scopeUntitled')) +
                    (severalFiles ? ` · ${item.documentName}` : '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {current && value && (
          <div className="space-y-2">
            <Label htmlFor="quiz-exam-topic">{t('syllabus.quiz.topic')}</Label>
            <Select
              value={value.selection.examTopicId ?? WHOLE}
              onValueChange={(id) =>
                onChange(
                  choose(
                    currentKey,
                    id === WHOLE ? undefined : id,
                    value.selection.includeUnmatched,
                  ),
                )
              }
            >
              <SelectTrigger id="quiz-exam-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE}>
                  {t('syllabus.quiz.wholeScope', { count: current.scope.topics.length })}
                </SelectItem>
                {current.scope.topics.map((item, index) => (
                  <SelectItem key={item.id} value={item.id}>
                    {`${index + 1}. ${item.text}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {value && (
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
            checked={value.selection.includeUnmatched}
            onChange={(event) =>
              onChange({
                ...value,
                selection: { ...value.selection, includeUnmatched: event.target.checked },
              })
            }
          />
          <span>
            {t('syllabus.quiz.includeUnmatched')}
            <span className="block text-xs text-muted-foreground">
              {t('syllabus.quiz.includeUnmatchedHint')}
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-muted-foreground">{t('syllabus.quiz.hint')}</p>
    </div>
  )
}
