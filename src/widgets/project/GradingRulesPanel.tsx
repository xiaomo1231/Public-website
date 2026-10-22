import { useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { SectionHeading } from '@/shared/ui/Section'
import type { Project } from '@/entities/project/types'
import {
  normalizeSigFigPolicy,
  type GradingRuleSource,
  type SigFigPolicy,
  type SigFigRuleMode,
} from '@/entities/question/answerDimensions'
import { sigFigRuleText } from '@/services/answerDimensionsFeedback'
import { loadSigFigHabitStatements } from '@/services/projectGradingRules'
import { useTranslation } from '@/i18n'

export interface GradingRulesPanelProps {
  project: Project
  onSave: (policy: SigFigPolicy) => Promise<void>
}

/**
 * 「评分规则」 for one course: how a significant-figure slip (right value and
 * unit, wrong number of significant figures) counts — hint only (default) or
 * a deduction the student enters — and where the rule comes from (教授规则 /
 * 平台拟定规则). The platform never decides a deduction on its own.
 */
export function GradingRulesPanel({ project, onSave }: GradingRulesPanelProps): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const current = normalizeSigFigPolicy(project.sigFigPolicy)
  const [mode, setMode] = useState<SigFigRuleMode>(current.mode)
  const [percent, setPercent] = useState(String(current.percent ?? 25))
  const [source, setSource] = useState<GradingRuleSource>(current.source)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [habits, setHabits] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void loadSigFigHabitStatements(project.id).then((items) => {
      if (alive) setHabits(items)
    })
    return () => {
      alive = false
    }
  }, [project.id])

  const percentNumber = Number(percent)
  const percentValid =
    mode !== 'deduct' ||
    (Number.isInteger(percentNumber) && percentNumber >= 1 && percentNumber <= 100)
  const next: SigFigPolicy =
    mode === 'deduct' ? { mode, percent: percentNumber, source } : { mode, source }
  const changed =
    next.mode !== current.mode || next.source !== current.source || next.percent !== current.percent

  async function save() {
    if (!percentValid || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await onSave(next)
      setMessage(t('gradingRules.saved'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const radio = 'focus-ring mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]'
  return (
    <section className="max-w-[70ch] space-y-4" aria-labelledby={`${id}-title`}>
      <SectionHeading
        title={<span id={`${id}-title`}>{t('gradingRules.title')}</span>}
        description={t('gradingRules.description')}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('gradingRules.sigFigs.label')}</legend>
        <p className="text-xs text-muted-foreground">{t('gradingRules.sigFigs.explain')}</p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name={`${id}-mode`}
            className={radio}
            checked={mode === 'hint'}
            onChange={() => setMode('hint')}
          />
          {t('gradingRules.sigFigs.hint')}
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="radio"
            name={`${id}-mode`}
            className={radio}
            checked={mode === 'deduct'}
            onChange={() => setMode('deduct')}
          />
          {t('gradingRules.sigFigs.deduct')}
        </label>
        {mode === 'deduct' && (
          <label className="ml-7 flex items-center gap-2 text-sm">
            <span>{t('gradingRules.sigFigs.percent')}</span>
            <Input
              className="w-24"
              inputMode="numeric"
              value={percent}
              invalid={!percentValid}
              onChange={(event) => setPercent(event.target.value.trim())}
            />
          </label>
        )}
        {!percentValid && (
          <p className="ml-7 text-xs text-destructive">{t('gradingRules.percentInvalid')}</p>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('gradingRules.source.label')}</legend>
        {(['professor', 'platform'] as const).map((value) => (
          <label key={value} className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name={`${id}-source`}
              className={radio}
              checked={source === value}
              onChange={() => setSource(value)}
            />
            {t(
              value === 'professor'
                ? 'gradingRules.source.professor'
                : 'gradingRules.source.platform',
            )}
          </label>
        ))}
      </fieldset>
      {habits.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">{t('gradingRules.habitItems')}</p>
          <ul className="ml-5 list-disc">
            {habits.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={!changed || !percentValid || busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('gradingRules.save')}
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {message ?? t('gradingRules.current', { rule: sigFigRuleText(current) })}
        </span>
      </div>
    </section>
  )
}
