import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CheckCircle2, Eye, Lightbulb, Wand2 } from 'lucide-react'
import {
  agreesWithWalkthrough,
  allCorrect,
  applyOps,
  chainFinished,
  checkCells,
  emptyCells,
  fillUnchanged,
  judgeOps,
  nextReferenceStep,
  opsLatex,
  parseTypedOps,
  type Applied,
  type CellCheck,
  type GuidedChain,
  type Matrix,
  type OpRejection,
} from '@/entities/homework/guidedMatrix'
import {
  replayRoute,
  type GuidedChainProgress,
  type GuidedPendingStep,
} from '@/entities/homework/guided'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Math as TeX } from '@/shared/ui/Math'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { answerFieldAttrs } from '@/shared/lib/answerFieldAttrs'
import { findPlaceholder, rowOpQuickItems } from '@/shared/lib/quickInsert'
import { QuickInsertBar } from '@/widgets/mathInput/QuickInsertBar'
import { useTranslation, type TranslationKey } from '@/i18n'
import { MatrixDisplay, MatrixInputGrid } from './MatrixParts'

const REJECTION_KEYS: Record<OpRejection, TranslationKey> = {
  unreadable: 'guided.op.unreadable',
  'out-of-range': 'guided.op.outOfRange',
  'not-invertible': 'guided.op.notInvertible',
  'no-change': 'guided.op.noChange',
  'no-progress': 'guided.op.noProgress',
}

export interface GuidedMatrixPracticeProps {
  chains: GuidedChain[]
  progress: GuidedChainProgress[]
  onChange: (index: number, next: GuidedChainProgress) => void
}

/** Every row reduction of the question, one after another. */
export function GuidedMatrixPractice({
  chains,
  progress,
  onChange,
}: GuidedMatrixPracticeProps): JSX.Element {
  const { t } = useTranslation()
  const active = progress.findIndex((item) => !item.done)
  return (
    <div className="space-y-6">
      {chains.map((chain, index) => (
        <section
          key={index}
          aria-label={chain.label ?? t('guided.exercise', { index: index + 1 })}
          className="space-y-3"
        >
          {chains.length > 1 && (
            <h3 className="font-heading text-[15px] font-semibold text-foreground lab:font-mono lab:text-[13px] lab:uppercase lab:tracking-wider">
              {chain.label ?? t('guided.exercise', { index: index + 1 })}
            </h3>
          )}
          <ChainWorkspace
            chain={chain}
            progress={progress[index] ?? { records: [] }}
            active={index === active}
            onChange={(next) => onChange(index, next)}
          />
        </section>
      ))}
    </div>
  )
}

interface ChainWorkspaceProps {
  chain: GuidedChain
  progress: GuidedChainProgress
  active: boolean
  onChange: (next: GuidedChainProgress) => void
}

function ChainWorkspace({ chain, progress, active, onChange }: ChainWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const route = useMemo(() => replayRoute(chain, progress), [chain, progress])
  const [opMessage, setOpMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [checks, setChecks] = useState<CellCheck[][] | null>(null)
  const [justDone, setJustDone] = useState(false)
  const opRef = useRef<HTMLInputElement>(null)
  // Unique per exercise: several chains show a step 1 at the same time.
  const opFieldId = useId()

  if (!route) {
    return <p className="text-sm text-muted-foreground">{t('guided.routeLost')}</p>
  }
  const { current, matrices } = route
  const pending: GuidedPendingStep = progress.pending ?? {}
  const acceptedOps = pending.op ? parseTypedOps(pending.op) : null
  const applied: Applied | null = acceptedOps ? applyOps(current, acceptedOps) : null
  const reference = nextReferenceStep(chain, current)
  const stepNumber = progress.records.length + 1
  // R1 … Rn of this matrix, the arrows and the three elementary templates.
  const rowOps = rowOpQuickItems(current.length)
  const unchangedRows = new Set(
    applied ? applied.provenance.flatMap((origin, row) => (origin ? [] : [row])) : [],
  )

  const setPending = (next: GuidedPendingStep): void => onChange({ ...progress, pending: next })

  const complete = (step: GuidedPendingStep, result: Matrix): void => {
    const done = chainFinished(chain, result)
    onChange({
      records: [
        ...progress.records,
        {
          op: step.op!,
          ...(step.hintViewed ? { hintViewed: true } : {}),
          ...(step.answerViewed ? { answerViewed: true } : {}),
        },
      ],
      ...(done ? { done: true } : {}),
    })
    setChecks(null)
    setOpMessage(null)
    setJustDone(true)
    if (!done) window.setTimeout(() => opRef.current?.focus({ preventScroll: true }), 0)
  }

  const checkOp = (): void => {
    const typed = pending.typedOp ?? ''
    if (!typed.trim()) return
    const verdict = judgeOps(chain, current, typed)
    setJustDone(false)
    if (!verdict.ok) {
      setOpMessage({ tone: 'error', text: t(REJECTION_KEYS[verdict.reason]) })
      return
    }
    const onRoute = verdict.position !== null
    setOpMessage({
      tone: 'ok',
      text: t(onRoute ? 'guided.op.acceptedRoute' : 'guided.op.acceptedOwn'),
    })
    setChecks(null)
    setPending({ ...pending, op: opsLatex(verdict.ops), cells: emptyCells(current) })
  }

  const checkMatrix = (): void => {
    if (!applied) return
    const cells = pending.cells ?? emptyCells(current)
    const result = checkCells(applied.matrix, cells, applied.provenance)
    setChecks(result)
    if (allCorrect(result)) complete(pending, applied.matrix)
  }

  const showAnswer = (): void => {
    if (applied) {
      complete({ ...pending, answerViewed: true }, applied.matrix)
      return
    }
    if (!reference) return
    const result = applyOps(current, reference.ops)
    if (!result) return
    complete({ ...pending, op: reference.opLatex, answerViewed: true }, result.matrix)
  }

  const wrongCells = checks
    ? checks.flatMap((row, r) =>
        row.flatMap((cell, c) =>
          cell.status === 'wrong' || cell.status === 'unreadable' || cell.status === 'inexact'
            ? [{ r, c, cell }]
            : [],
        ),
      )
    : []
  const emptyCount = checks
    ? checks.reduce((sum, row) => sum + row.filter((cell) => cell.status === 'empty').length, 0)
    : 0

  return (
    <div className="space-y-4">
      {/* The steps done so far, compact. */}
      <ol className="space-y-3">
        <li className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground lab:font-mono">
            {t('guided.startMatrix')}
          </span>
          <MatrixDisplay matrix={chain.start} bar={chain.bar} label={t('guided.startMatrix')} />
        </li>
        {progress.records.map((record, index) => (
          <li
            key={index}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-border pl-3 lab:border-l"
          >
            <span className="text-xs font-semibold text-muted-foreground lab:font-mono">
              {t('guided.stepN', { index: index + 1 })}
            </span>
            {record.op && <TeX latex={record.op} />}
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <MatrixDisplay
              matrix={matrices[index + 1]!}
              bar={chain.bar}
              label={t('guided.resultOfStep', { index: index + 1 })}
            />
            {record.hintViewed && <Badge variant="outline">{t('guided.badge.hint')}</Badge>}
            {record.answerViewed && <Badge variant="outline">{t('guided.badge.answer')}</Badge>}
          </li>
        ))}
      </ol>

      {progress.done ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-foreground lab:rounded-sm"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {agreesWithWalkthrough(chain, current)
            ? t('guided.chainDone')
            : t('guided.chainDoneDiffers')}
        </div>
      ) : !active ? (
        <p className="text-sm text-muted-foreground">{t('guided.waiting')}</p>
      ) : (
        <div
          className="space-y-4 rounded-xl border border-border bg-card p-4 lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:px-0 lab:rounded-sm"
          data-guided-step={stepNumber}
        >
          {justDone && (
            <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
              {t('guided.stepCorrect')}
            </p>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-heading text-[15px] font-semibold text-foreground lab:font-mono lab:text-[13px]">
              {t('guided.stepN', { index: stepNumber })}
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                aria-pressed={Boolean(pending.hintViewed)}
                onClick={() => setPending({ ...pending, hintViewed: true })}
              >
                <Lightbulb className="h-4 w-4" aria-hidden />
                {t('guided.hint')}
              </Button>
              <Button type="button" variant="outline" className="h-11" onClick={showAnswer}>
                <Eye className="h-4 w-4" aria-hidden />
                {t('guided.showStepAnswer')}
              </Button>
            </div>
          </div>

          {pending.hintViewed && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm lab:rounded-sm" data-guided-hint>
              {reference?.fromWalkthrough && reference.hint ? (
                <RichText
                  text={reference.hint}
                  format="markdown"
                  paragraphClassName="text-sm leading-relaxed"
                />
              ) : (
                <p className="leading-relaxed text-muted-foreground">
                  {t(reference?.fromWalkthrough ? 'guided.hintGeneric' : 'guided.hintOffRoute')}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor={`${opFieldId}-op-${stepNumber}`}
              className="block text-sm font-medium text-foreground"
            >
              {t('guided.opLabel')}
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <Input
                ref={opRef}
                id={`${opFieldId}-op-${stepNumber}`}
                aria-label={t('guided.opLabel')}
                value={pending.typedOp ?? ''}
                disabled={Boolean(pending.op)}
                placeholder={t('guided.opPlaceholder')}
                {...answerFieldAttrs('expression')}
                enterKeyHint="go"
                className="h-11 min-w-0 flex-1 font-mono text-[15px] sm:max-w-sm"
                onChange={(event) => {
                  setOpMessage(null)
                  setPending({ ...pending, typedOp: event.target.value })
                }}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    checkOp()
                    return
                  }
                  // Tab / Shift+Tab move between the `?` of an inserted template;
                  // past the last one Tab leaves the field as usual.
                  if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    const field = event.currentTarget
                    const from = event.shiftKey
                      ? (field.selectionStart ?? 0)
                      : (field.selectionEnd ?? 0)
                    const target = findPlaceholder(field.value, from, event.shiftKey)
                    const wrapped = target
                      ? event.shiftKey
                        ? target.start >= from
                        : target.start < from
                      : true
                    if (!target || wrapped) return
                    event.preventDefault()
                    field.setSelectionRange(target.start, target.end)
                  }
                }}
              />
              {!pending.op && (
                <Button
                  type="button"
                  className="h-11"
                  onClick={checkOp}
                  disabled={!(pending.typedOp ?? '').trim()}
                >
                  {t('guided.checkOp')}
                </Button>
              )}
            </div>
            {!pending.op && (
              <QuickInsertBar
                items={rowOps}
                field={() => opRef.current}
                value={() => pending.typedOp ?? ''}
                onChange={(typedOp) => {
                  setOpMessage(null)
                  setPending({ ...pending, typedOp })
                }}
                label={t('quickInsert.rowOpLabel')}
              />
            )}
            <OpPreview typed={pending.typedOp ?? ''} accepted={pending.op} />
            {opMessage && (
              <p
                role={opMessage.tone === 'error' ? 'alert' : 'status'}
                className={cn(
                  'text-sm',
                  opMessage.tone === 'error'
                    ? 'text-destructive'
                    : 'text-emerald-700 dark:text-emerald-300',
                )}
              >
                {opMessage.text}
              </p>
            )}
            {!pending.op && <p className="text-xs text-muted-foreground">{t('guided.opSyntax')}</p>}
          </div>

          {applied ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-foreground">
                  {t('guided.resultLabel')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() =>
                    setPending({
                      ...pending,
                      cells: fillUnchanged(
                        pending.cells ?? emptyCells(current),
                        current,
                        applied.provenance,
                      ),
                    })
                  }
                  disabled={unchangedRows.size === 0}
                >
                  <Wand2 className="h-4 w-4" aria-hidden />
                  {t('guided.fillUnchanged')}
                </Button>
              </div>
              <MatrixInputGrid
                values={pending.cells ?? emptyCells(current)}
                bar={chain.bar}
                checks={checks}
                unchangedRows={unchangedRows}
                label={t('guided.resultLabel')}
                onChange={(r, c, value) => {
                  const cells = (pending.cells ?? emptyCells(current)).map((row) => [...row])
                  cells[r]![c] = value
                  setPending({ ...pending, cells })
                }}
                onSubmit={checkMatrix}
              />
              <p className="text-xs text-muted-foreground">{t('guided.cellSyntax')}</p>
              <Button type="button" className="h-11" onClick={checkMatrix}>
                {t('guided.checkMatrix')}
              </Button>
              {checks && (wrongCells.length > 0 || emptyCount > 0) && (
                <div role="alert" className="space-y-1.5 text-sm">
                  {emptyCount > 0 && (
                    <p className="text-muted-foreground">
                      {t('guided.cellsEmpty', { count: emptyCount })}
                    </p>
                  )}
                  {wrongCells.length > 0 && (
                    <ul className="space-y-1">
                      {wrongCells.map(({ r, c, cell }) => (
                        <li key={`${r}-${c}`} className="text-destructive">
                          <span className="font-medium">
                            {t('guided.cellLabel', { row: r + 1, col: c + 1 })}
                          </span>
                          {' — '}
                          {cell.status === 'unreadable' ? (
                            t('guided.cellUnreadable')
                          ) : cell.status === 'inexact' ? (
                            t('guided.cellInexact')
                          ) : cell.unchangedRow ? (
                            t('guided.cellUnchanged')
                          ) : cell.arithmetic ? (
                            <>
                              {t('guided.cellCompute')}{' '}
                              <span className="text-foreground">
                                <TeX latex={cell.arithmetic.latex} />
                              </span>
                              <span className="sr-only">{cell.arithmetic.text}</span>
                            </>
                          ) : (
                            t('guided.cellWrong')
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('guided.matrixLocked')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** What the typed operation is read as, rendered (so a typo is visible before checking). */
function OpPreview({ typed, accepted }: { typed: string; accepted?: string }): JSX.Element | null {
  const { t } = useTranslation()
  const latex = accepted ?? (typed.trim() ? (parseTypedOps(typed) ?? null) : null)
  if (!latex) return null
  const text = typeof latex === 'string' ? latex : opsLatex(latex)
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{t(accepted ? 'guided.opAccepted' : 'guided.opReadAs')}</span>
      <span className="text-foreground">
        <TeX latex={text} />
      </span>
    </p>
  )
}
