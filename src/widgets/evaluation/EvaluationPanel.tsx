import { useCallback, useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { HomeworkQuestion, HomeworkSet, TeacherMark } from '@/entities/homework/types'
import {
  EVAL_ROLES,
  EVAL_ROLE_LABEL_KEYS,
  effectiveEvalRole,
  resolveEvalRole,
  type EvalRole,
} from '@/entities/evaluation/evalRole'
import {
  EVALUATION_ABILITIES,
  evaluationMarkdown,
  summarizeEvaluation,
  type EvaluationAbility,
  type EvaluationRecord,
} from '@/entities/evaluation/types'
import { PARSE_ERROR_KINDS, type ParseErrorKind } from '@/entities/homework/proofread'
import { eligible, type EvaluationService } from '@/services/evaluationService'
import { buildEvaluationService } from '@/services/aiServices'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'

const ABILITY_KEYS: Record<EvaluationAbility, TranslationKey> = {
  solve: 'evaluation.ability.solve',
  aligned: 'evaluation.ability.aligned',
  grading: 'evaluation.ability.grading',
}

const PARSE_KEYS: Record<ParseErrorKind, TranslationKey> = {
  minus_sign: 'evaluation.parse.minus_sign',
  exponent: 'evaluation.parse.exponent',
  subscript: 'evaluation.parse.subscript',
  fraction: 'evaluation.parse.fraction',
  matrix: 'evaluation.parse.matrix',
  subpart_boundary: 'evaluation.parse.subpart_boundary',
  label: 'evaluation.parse.label',
  other: 'evaluation.parse.other',
}

type RoleOrNone = EvalRole | 'none'
const roleKey = (role: RoleOrNone): TranslationKey =>
  role === 'none' ? 'evalRole.none' : EVAL_ROLE_LABEL_KEYS[role]

function download(name: string, text: string, type: string): void {
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—'

function RecordView({
  record,
  title,
  onResume,
  onDelete,
  running,
}: {
  record: EvaluationRecord
  title: string
  onResume: () => void
  onDelete: () => void
  running: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const summaries = summarizeEvaluation(record)
  const stamp = new Date(record.startedAt).toISOString().replace(/[:.]/g, '-')
  return (
    <article
      className="space-y-3 rounded-lg border border-border/70 p-3 lab:rounded-sm"
      data-eval-record
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{new Date(record.startedAt).toLocaleString()}</span>
          <span className="text-muted-foreground">
            {' · '}
            {record.model || '—'}
            {' · '}
            {t(`evaluation.status.${record.status}` as TranslationKey)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {record.status === 'paused' && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={running}
              onClick={onResume}
            >
              {t('common.continue')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              download(`evaluation-${stamp}.md`, evaluationMarkdown(record, title), 'text/markdown')
            }
          >
            <Download className="h-4 w-4" />
            Markdown
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              download(
                `evaluation-${stamp}.json`,
                JSON.stringify(record, null, 2),
                'application/json',
              )
            }
          >
            <Download className="h-4 w-4" />
            JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 text-destructive"
            aria-label={t('evaluation.deleteRecord')}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <p className="text-xs text-muted-foreground">
        {Object.entries(record.promptVersions)
          .map(([key, value]) => `${key} ${value}`)
          .join(' · ')}
      </p>

      <section className="text-sm">
        <h4 className="font-medium">{t('evaluation.parsingTitle')}</h4>
        <p className="text-muted-foreground">
          {t('evaluation.parsingLine', {
            n: record.parsing.questions,
            verified: record.parsing.verified,
            edited: record.parsing.edited,
            share: pct(record.parsing.edited, record.parsing.questions),
          })}
        </p>
        <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {PARSE_ERROR_KINDS.filter((kind) => record.parsing.byKind[kind] > 0).map((kind) => (
            <li key={kind}>
              {t(PARSE_KEYS[kind])}: {record.parsing.byKind[kind]}
            </li>
          ))}
        </ul>
      </section>

      {summaries.map((summary) => (
        <section key={summary.role} className="space-y-1 text-sm" data-eval-role={summary.role}>
          <h4 className="font-medium">
            {t('evaluation.roleTitle', { role: t(roleKey(summary.role)) })}
          </h4>
          {summary.role === 'independent' && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t('evaluation.independentNote')}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('evaluation.table.ability')}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    n
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('evaluation.table.same')}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('evaluation.table.method')}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('evaluation.table.result')}
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('evaluation.table.failed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(['solve', 'aligned'] as const).map((ability) => {
                  const value = summary[ability]
                  if (value.n === 0 && value.failed === 0) return null
                  return (
                    <tr key={ability} className="border-t border-border/50">
                      <th scope="row" className="py-1 pr-2 font-normal">
                        {t(ABILITY_KEYS[ability])}
                      </th>
                      <td className="py-1 pr-2">{value.n}</td>
                      <td className="py-1 pr-2">
                        {value.same} ({pct(value.same, value.n)})
                      </td>
                      <td className="py-1 pr-2">{value.methodDiffers}</td>
                      <td className="py-1 pr-2">{value.resultDiffers}</td>
                      <td className="py-1 pr-2">{value.failed}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {(summary.grading.graded > 0 || summary.grading.failed > 0) && (
            <p className="text-xs">
              {t('evaluation.gradingLine', {
                graded: summary.grading.graded,
                withTeacher: summary.grading.withTeacher,
                agree: summary.grading.agree,
                share: pct(summary.grading.agree, summary.grading.withTeacher),
                uncertain: summary.grading.uncertain,
                failed: summary.grading.failed,
              })}
            </p>
          )}
        </section>
      ))}

      <details className="text-xs">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          {t('evaluation.perItem')}
        </summary>
        <ul className="space-y-2">
          {record.items
            .filter((item) => item.solve || item.aligned || item.grading)
            .map((item) => (
              <li key={item.questionId} className="rounded border border-border/50 p-2">
                <p className="font-medium">
                  {item.label} · {t(roleKey(item.role))}
                </p>
                {(['solve', 'aligned'] as const).map((ability) =>
                  item[ability] ? (
                    <div key={ability}>
                      <p>
                        {t(ABILITY_KEYS[ability])}: {item[ability]!.status}
                        {item[ability]!.error ? ` — ${item[ability]!.error}` : ''}
                      </p>
                      {item[ability]!.notes?.map((note, index) => (
                        <p key={index} className="text-muted-foreground">
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : null,
                )}
                {item.grading && (
                  <p>
                    {t(ABILITY_KEYS.grading)}: {item.grading.error ?? item.grading.verdict ?? '—'} /{' '}
                    {item.grading.teacher ?? '—'}
                  </p>
                )}
              </li>
            ))}
        </ul>
      </details>
    </article>
  )
}

interface EvaluationPanelProps {
  set: HomeworkSet
  questions: readonly HomeworkQuestion[]
  language: 'zh' | 'en'
  onChanged?: () => void
  /** Injected in tests. */
  service?: EvaluationService
  proofread?: HomeworkProofreadService
}

/**
 * 检验网站: run the three abilities separately on this assignment, see the
 * parsing accuracy from 导入校对, enter teacher marks, and export each run.
 */
export function EvaluationPanel({
  set,
  questions,
  language,
  onChanged,
  service: injected,
  proofread: injectedProofread,
}: EvaluationPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [service, setService] = useState<EvaluationService | null>(injected ?? null)
  const [proofread] = useState(() => injectedProofread ?? new HomeworkProofreadService())
  const [records, setRecords] = useState<EvaluationRecord[]>(set.evaluations ?? [])
  const [roles, setRoles] = useState<RoleOrNone[]>(['development', 'independent'])
  const [abilities, setAbilities] = useState<EvaluationAbility[]>([...EVALUATION_ABILITIES])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const control = useGenerationRun()

  useEffect(() => {
    if (injected) return
    let alive = true
    void buildEvaluationService().then((next) => alive && setService(next))
    return () => {
      alive = false
    }
  }, [injected])

  const reload = useCallback(async () => {
    if (service) setRecords(await service.records(set.id))
  }, [service, set.id])
  useEffect(() => {
    void reload()
  }, [reload])

  const active = questions.filter((question) => !question.retired)
  const roleOf = (question: HomeworkQuestion): RoleOrNone =>
    effectiveEvalRole(question, set) ?? 'none'
  const included = active.filter((question) => roles.includes(roleOf(question)))
  const counts = new Map<RoleOrNone, number>()
  for (const question of active)
    counts.set(roleOf(question), (counts.get(roleOf(question)) ?? 0) + 1)

  const start = async (resumeId?: string) => {
    if (!service) return
    setError(null)
    const run = control.start()
    try {
      await service.run(set.id, {
        abilities,
        roles,
        language,
        control: run,
        ...(resumeId ? { resumeId } : {}),
        onProgress: (done, total) => setProgress({ done, total }),
      })
    } catch (err) {
      if (!isGenerationInterruption(err, run)) setError(friendlyAIError(err))
    } finally {
      run.finish()
      setProgress(null)
      await reload()
    }
  }

  const toggle = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((value) => value !== item) : [...list, item]

  const setTeacher = async (question: HomeworkQuestion, value: string) => {
    const verdict = value as TeacherMark['verdict'] | ''
    await proofread.setTeacherMark(question.id, verdict ? { verdict } : null)
    onChanged?.()
  }

  return (
    <div className="space-y-4" data-evaluation-panel>
      <Card>
        <CardHeader>
          <CardTitle className="text-base lecture:font-heading lecture:font-bold">
            {t('evaluation.title')}
          </CardTitle>
          <CardDescription>{t('evaluation.disclaimer')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{t('evaluation.setRole')}</span>
            <select
              value={resolveEvalRole(set.evalRole) ?? ''}
              onChange={(event) =>
                void proofread
                  .setSetEvalRole(set.id, resolveEvalRole(event.target.value))
                  .then(() => onChanged?.())
              }
              className="focus-ring h-11 rounded-lg border border-input bg-background px-2 lab:rounded-sm"
            >
              <option value="">{t('evalRole.none')}</option>
              {EVAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(EVAL_ROLE_LABEL_KEYS[role])}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{t('evalRole.developmentNotice')}</p>

          <fieldset className="space-y-1">
            <legend className="font-medium">{t('evaluation.includeRoles')}</legend>
            <div className="flex flex-wrap gap-3">
              {(['development', 'independent', 'regression', 'none'] as RoleOrNone[]).map(
                (role) => (
                  <label key={role} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={roles.includes(role)}
                      onChange={() => setRoles((prev) => toggle(prev, role))}
                    />
                    {t(roleKey(role))} ({counts.get(role) ?? 0})
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="font-medium">{t('evaluation.abilities')}</legend>
            <div className="flex flex-wrap gap-3">
              {EVALUATION_ABILITIES.map((ability) => (
                <label key={ability} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={abilities.includes(ability)}
                    onChange={() => setAbilities((prev) => toggle(prev, ability))}
                  />
                  {t(ABILITY_KEYS[ability])} (n ={' '}
                  {included.filter((question) => eligible(question, ability)).length})
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('evaluation.abilitiesHint')}</p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="min-h-11"
              disabled={
                !service || control.active || abilities.length === 0 || included.length === 0
              }
              onClick={() => void start()}
            >
              {t('evaluation.run')}
            </Button>
            {control.active && control.run && (
              <GenerationControls
                kind="parts"
                state={control.state}
                stopRequested={control.run.stopRequested}
                {...(progress ? { done: progress.done, total: progress.total } : {})}
                onPause={control.requestPause}
                onStopNow={control.stopNow}
              />
            )}
            {progress && (
              <span className="text-muted-foreground" aria-live="polite">
                {progress.done} / {progress.total}
              </span>
            )}
          </div>
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {active.some((question) => question.draftText.trim()) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('evaluation.teacherTitle')}</CardTitle>
            <CardDescription>{t('evaluation.teacherHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {active
                .filter((question) => question.draftText.trim())
                .map((question, index) => (
                  <li key={question.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[4ch] font-mono">{question.number ?? index + 1}</span>
                    <select
                      aria-label={t('evaluation.teacherFor', { n: question.number ?? index + 1 })}
                      value={question.teacherMark?.verdict ?? ''}
                      onChange={(event) => void setTeacher(question, event.target.value)}
                      className="focus-ring h-11 rounded-lg border border-input bg-background px-2 lab:rounded-sm"
                    >
                      <option value="">{t('evaluation.teacherNone')}</option>
                      <option value="correct">{t('selfTest.verdict.correct')}</option>
                      <option value="partial">{t('selfTest.verdict.partial')}</option>
                      <option value="incorrect">{t('selfTest.verdict.incorrect')}</option>
                    </select>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('evaluation.records')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('evaluation.noRecords')}</p>
          ) : (
            records.map((record) => (
              <RecordView
                key={record.id}
                record={record}
                title={set.title}
                running={control.active}
                onResume={() => void start(record.id)}
                onDelete={() => void service?.deleteRecord(set.id, record.id).then(() => reload())}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
