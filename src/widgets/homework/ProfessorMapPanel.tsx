import { useMemo, useRef, useState } from 'react'
import { Check, Loader2, Pencil, RotateCcw, Square, Wand2 } from 'lucide-react'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  PROFESSOR_COVERAGES,
  clipQuote,
  isUnlocated,
  professorMapView,
  type MapFlag,
  type ProfessorCoverage,
  type ProfessorMapSource,
  type ProfessorMapViewEntry,
  type ProfessorSegment,
} from '@/entities/homework/professorMap'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { useTranslation, type TranslationKey } from '@/i18n'

/** What the panel needs from the homework service. */
export interface ProfessorMapActions {
  remapProfessorAnswer: (
    questionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<HomeworkQuestion>
  setProfessorMapEdit: (
    questionId: string,
    label: string,
    edit: { coverage: ProfessorCoverage; quotes: string[] } | null,
  ) => Promise<HomeworkQuestion>
}

export interface ProfessorMapPanelProps {
  question: HomeworkQuestion
  service: ProfessorMapActions
  /** The question after a change (map or edit saved). */
  onQuestionChange: (question: HomeworkQuestion) => void
  disabled?: boolean
}

const FLAG_KEYS: Record<MapFlag, TranslationKey> = {
  misplaced: 'homework.answer.map.flag.misplaced',
  shared: 'homework.answer.map.flag.shared',
  indirect: 'homework.answer.map.flag.indirect',
  reference: 'homework.answer.map.flag.reference',
  'bad-reference': 'homework.answer.map.flag.bad-reference',
  deferred: 'homework.answer.map.flag.deferred',
  corrected: 'homework.answer.map.flag.corrected',
  'quotes-dropped': 'homework.answer.map.flag.quotes-dropped',
  unlocated: 'homework.answer.map.flag.unlocated',
  conflict: 'homework.answer.map.flag.conflict',
  'several-ways': 'homework.answer.map.flag.several-ways',
}

const COVERAGE_KEYS: Record<ProfessorCoverage, TranslationKey> = {
  direct: 'homework.answer.map.coverage.direct',
  indirect: 'homework.answer.map.coverage.indirect',
  none: 'homework.answer.map.coverage.none',
}

function partName(label: string): string {
  return /^\d+$/.test(label) ? `${label}.` : `(${label})`
}

/**
 * 小题对应: for one question with a matched professor answer and sub-parts,
 * which excerpts of the answer cover each sub-part (直接 / 间接 / 未给出),
 * with 「请确认」 on the uncertain ones; the student confirms, changes (pick
 * excerpts or mark 未给出) or resets each sub-part, and can ask the AI to map
 * by content. Edits are stored on the question and always win.
 */
export function ProfessorMapPanel({
  question,
  service,
  onQuestionChange,
  disabled,
}: ProfessorMapPanelProps) {
  const { t } = useTranslation()
  const view = useMemo(() => professorMapView(question), [question])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  if (!view) return null

  const describeSource = (source: ProfessorMapSource, label: string): string | null => {
    const parts: string[] = []
    if (source.labels.length === 0) parts.push(t('homework.answer.map.from.general'))
    else if (source.nestedUnder)
      parts.push(t('homework.answer.map.from.misplaced', { heading: partName(source.nestedUnder) }))
    else if (!source.labels.includes(label))
      parts.push(
        t('homework.answer.map.from.other', { where: source.labels.map(partName).join('、') }),
      )
    else if (source.labels.length > 1)
      parts.push(
        t('homework.answer.map.from.shared', {
          labels: source.labels
            .filter((item) => item !== label)
            .map(partName)
            .join('、'),
        }),
      )
    if (source.method !== undefined)
      parts.push(t('homework.answer.map.from.method', { n: source.method }))
    return parts.length > 0 ? parts.join(' · ') : null
  }

  const segmentName = (segment: ProfessorSegment): string => {
    const base =
      segment.labels.length === 0
        ? t('homework.answer.map.segment.general')
        : segment.labels.map(partName).join('、')
    const where = describeSource(
      {
        labels: segment.labels,
        ...(segment.nestedUnder ? { nestedUnder: segment.nestedUnder } : {}),
        ...(segment.method !== undefined ? { method: segment.method } : {}),
      },
      segment.labels[0] ?? '',
    )
    return where && segment.labels.length > 0 ? `${base} · ${where}` : base
  }

  async function run(action: () => Promise<HomeworkQuestion>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      onQuestionChange(await action())
      setEditing(null)
    } catch (err) {
      if (!isGenerationInterruption(err)) setError(friendlyAIError(err))
    } finally {
      setBusy(false)
      controller.current = null
    }
  }

  function remap(): void {
    const abort = new AbortController()
    controller.current = abort
    void run(() => service.remapProfessorAnswer(question.id, { signal: abort.signal }))
  }

  const confirmCount = view.toConfirm.length
  return (
    <details
      className="rounded-lg border border-border/60 p-2 text-sm"
      data-professor-map
      open={confirmCount > 0}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t('homework.answer.map.title')}</span>
        {confirmCount > 0 && (
          <Badge
            variant="outline"
            className="border-amber-500/60 text-amber-700 dark:text-amber-400"
            data-map-to-confirm
          >
            {t('homework.answer.map.toConfirm', { count: confirmCount })}
          </Badge>
        )}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {view.origin === 'ai'
              ? t('homework.answer.map.originAi')
              : t('homework.answer.map.originLocal')}
          </p>
          {busy && controller.current ? (
            <Button variant="outline" size="sm" onClick={() => controller.current?.abort()}>
              <Square className="h-4 w-4" />
              {t('homework.answer.map.stop')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || disabled}
              onClick={remap}
              data-map-remap
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {busy ? t('homework.answer.map.remapping') : t('homework.answer.map.remap')}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <ul className="space-y-2">
          {view.entries.map((entry) => (
            <MapRow
              key={entry.label}
              entry={entry}
              segments={view.segments}
              editing={editing === entry.label}
              busy={busy || Boolean(disabled)}
              describeSource={describeSource}
              segmentName={segmentName}
              onEdit={() => setEditing(entry.label)}
              onCancel={() => setEditing(null)}
              onSave={(edit) =>
                void run(() => service.setProfessorMapEdit(question.id, entry.label, edit))
              }
              onConfirm={() =>
                void run(() =>
                  service.setProfessorMapEdit(question.id, entry.label, {
                    coverage: entry.coverage,
                    quotes: entry.quotes,
                  }),
                )
              }
              onReset={() =>
                void run(() => service.setProfessorMapEdit(question.id, entry.label, null))
              }
            />
          ))}
        </ul>
      </div>
    </details>
  )
}

function MapRow({
  entry,
  segments,
  editing,
  busy,
  describeSource,
  segmentName,
  onEdit,
  onCancel,
  onSave,
  onConfirm,
  onReset,
}: {
  entry: ProfessorMapViewEntry
  segments: ProfessorSegment[]
  editing: boolean
  busy: boolean
  describeSource: (source: ProfessorMapSource, label: string) => string | null
  segmentName: (segment: ProfessorSegment) => string
  onEdit: () => void
  onCancel: () => void
  onSave: (edit: { coverage: ProfessorCoverage; quotes: string[] }) => void
  onConfirm: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const low = entry.source !== 'edit' && entry.confidence === 'low'
  const unlocated = entry.source !== 'edit' && isUnlocated(entry)
  const source = entry.from ? describeSource(entry.from, entry.label) : null
  const flags = (entry.flags ?? []).filter((flag) => flag !== 'unlocated' || unlocated)
  return (
    <li
      className="rounded-md border border-border/50 p-2"
      data-map-part={entry.label}
      data-map-coverage={unlocated ? 'unlocated' : entry.coverage}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{partName(entry.label)}</span>
        <Badge variant={entry.coverage === 'none' ? 'outline' : 'secondary'}>
          {unlocated
            ? t('homework.answer.map.coverage.unlocated')
            : t(COVERAGE_KEYS[entry.coverage])}
          {source ? `（${source}）` : ''}
        </Badge>
        {low && (
          <Badge
            variant="outline"
            className="border-amber-500/60 text-amber-700 dark:text-amber-400"
            data-map-confirm-badge
          >
            {t('homework.answer.map.confirmBadge')}
          </Badge>
        )}
        {entry.source === 'edit' && (
          <Badge variant="outline">{t('homework.answer.map.edited')}</Badge>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          {low && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onConfirm}>
              <Check className="h-4 w-4" />
              {t('homework.answer.map.confirm')}
            </Button>
          )}
          {!editing && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              {t('homework.answer.map.edit')}
            </Button>
          )}
          {entry.source === 'edit' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              {t('homework.answer.map.reset')}
            </Button>
          )}
        </span>
      </div>
      {flags.length > 0 && entry.source !== 'edit' && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {flags.map((flag) => (
            <li key={flag}>{t(FLAG_KEYS[flag])}</li>
          ))}
        </ul>
      )}
      {entry.quotes.length > 0 && !editing && (
        <div className="mt-1 space-y-1">
          {entry.quotes.map((quote, index) => (
            <blockquote
              key={index}
              className="whitespace-pre-line border-l-2 border-border pl-2 text-xs text-muted-foreground"
            >
              {clipQuote(quote, 280)}
            </blockquote>
          ))}
        </div>
      )}
      {editing && (
        <MapEditor
          entry={entry}
          segments={segments}
          busy={busy}
          segmentName={segmentName}
          onCancel={onCancel}
          onSave={onSave}
        />
      )}
    </li>
  )
}

function MapEditor({
  entry,
  segments,
  busy,
  segmentName,
  onCancel,
  onSave,
}: {
  entry: ProfessorMapViewEntry
  segments: ProfessorSegment[]
  busy: boolean
  segmentName: (segment: ProfessorSegment) => string
  onCancel: () => void
  onSave: (edit: { coverage: ProfessorCoverage; quotes: string[] }) => void
}) {
  const { t } = useTranslation()
  const choices = segments.filter((segment) => !segment.restatedOnly && segment.text.trim())
  const [coverage, setCoverage] = useState<ProfessorCoverage>(
    isUnlocated(entry) ? 'direct' : entry.coverage,
  )
  const [picked, setPicked] = useState<string[]>(() =>
    choices
      .filter((segment) =>
        entry.quotes.some(
          (quote) => segment.text.includes(quote.trim()) || quote.includes(segment.text.trim()),
        ),
      )
      .map((segment) => segment.id),
  )
  const quotes = choices
    .filter((segment) => picked.includes(segment.id))
    .map((segment) => segment.text)
  const name = `map-coverage-${entry.label}`
  return (
    <div className="mt-2 space-y-2" data-map-editor>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">
          {t('homework.answer.map.coverageLabel')}
        </legend>
        <div className="flex flex-wrap gap-3">
          {PROFESSOR_COVERAGES.map((value) => (
            <label key={value} className="flex min-h-9 items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={name}
                value={value}
                checked={coverage === value}
                onChange={() => setCoverage(value)}
              />
              {t(COVERAGE_KEYS[value])}
            </label>
          ))}
        </div>
      </fieldset>
      {coverage !== 'none' && (
        <fieldset className="space-y-1">
          <legend className="text-xs text-muted-foreground">{t('homework.answer.map.pick')}</legend>
          {choices.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('homework.answer.map.noSegments')}</p>
          )}
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {choices.map((segment) => (
              <li key={segment.id}>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.includes(segment.id)}
                    onChange={(event) =>
                      setPicked((prev) =>
                        event.target.checked
                          ? [...prev, segment.id]
                          : prev.filter((id) => id !== segment.id),
                      )
                    }
                    data-map-segment={segment.id}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{segmentName(segment)}</span>
                    <span className="block whitespace-pre-line text-muted-foreground">
                      {clipQuote(segment.text, 200)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || (coverage !== 'none' && quotes.length === 0)}
          onClick={() => onSave({ coverage, quotes: coverage === 'none' ? [] : quotes })}
          data-map-save
        >
          {t('homework.answer.map.save')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
