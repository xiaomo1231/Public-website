import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Pause, Play, RotateCcw, SkipForward, Timer, X } from 'lucide-react'
import {
  POMODORO_LIMITS,
  formatClock,
  remainingAt,
  type PomodoroPhase,
  type PomodoroSettings,
} from '@/entities/focus/pomodoro'
import { usePomodoroStore } from '@/features/focus/pomodoroStore'
import { usePomodoroSettings, useSavePomodoroSettings } from '@/features/focus/usePomodoro'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const PHASE_KEY: Record<PomodoroPhase, TranslationKey> = {
  focus: 'pomodoro.phase.focus',
  shortBreak: 'pomodoro.phase.shortBreak',
  longBreak: 'pomodoro.phase.longBreak',
}

/**
 * The global pomodoro timer at the left edge.
 *
 * From `lg` it is a narrow column of its own (so it never covers the page);
 * narrower, a small round button in the bottom-left corner. Either opens a
 * non-modal panel with the controls and a quick edit of the lengths. Not
 * rendered while an exam is on screen (the timer pauses itself then).
 */
export function PomodoroDock({ examActive }: { examActive: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  const settings = usePomodoroSettings()
  const timer = usePomodoroStore((s) => s.timer)
  const now = usePomodoroStore((s) => s.now)
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const hidden = !settings.visible || examActive

  // An exam closes the panel; it reopens only when asked.
  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])

  if (hidden) return null

  const remaining = remainingAt(timer, timer.status === 'running' ? Math.max(now, Date.now()) : now)
  const clock = formatClock(remaining)
  const phase = t(PHASE_KEY[timer.phase])
  const running = timer.status === 'running'
  const breakPhase = timer.phase !== 'focus'
  const openLabel = t('pomodoro.open', { phase, time: clock })

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    openerRef.current = event.currentTarget
    setOpen((value) => !value)
  }

  return (
    <>
      {/* Desktop: a column of its own at the left edge. */}
      <div
        className="relative z-30 hidden w-12 shrink-0 flex-col items-center border-r bg-background lab:bg-card lg:flex"
        data-pomodoro-dock
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={openLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-pomodoro-trigger
          className={cn(
            'focus-ring mt-1.5 flex min-h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground lecture:rounded-none lab:rounded-sm',
            running && 'text-foreground',
            timer.autoPaused && 'text-primary',
          )}
        >
          <Timer className={cn('h-4 w-4', running && breakPhase && 'text-primary')} aria-hidden />
          <span aria-hidden className="font-mono text-[10.5px] tabular-nums leading-none">
            {clock}
          </span>
          <span
            aria-hidden
            className={cn(
              'h-1 w-1 rounded-full',
              running ? (breakPhase ? 'bg-emerald-500' : 'bg-primary') : 'bg-border',
            )}
          />
        </button>
      </div>

      {/* Narrower screens: a small round button in the bottom-left corner. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={openLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-pomodoro-fab
        className={cn(
          'focus-ring fixed bottom-4 left-4 z-30 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border bg-card px-2.5 text-muted-foreground shadow-sm lab:rounded-sm lg:hidden',
          running && 'text-foreground',
        )}
      >
        <Timer className="h-4 w-4" aria-hidden />
        {(running || timer.status === 'paused') && (
          <span aria-hidden className="font-mono text-xs tabular-nums">
            {clock}
          </span>
        )}
      </button>

      {open && (
        <PomodoroPanel
          settings={settings}
          clock={clock}
          phase={phase}
          onClose={(restoreFocus) => {
            setOpen(false)
            if (restoreFocus) openerRef.current?.focus()
          }}
        />
      )}

      {/* Optional dim during a running break; the page stays usable under it. */}
      {settings.dimBreaks && running && breakPhase && (
        <div
          aria-hidden
          data-pomodoro-dim
          className="pointer-events-none fixed inset-0 z-[25] bg-black/35"
        />
      )}
    </>
  )
}

function PomodoroPanel({
  settings,
  clock,
  phase,
  onClose,
}: {
  settings: PomodoroSettings
  clock: string
  phase: string
  onClose: (restoreFocus: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = usePomodoroStore((s) => s.timer)
  const start = usePomodoroStore((s) => s.start)
  const pause = usePomodoroStore((s) => s.pause)
  const skip = usePomodoroStore((s) => s.skip)
  const reset = usePomodoroStore((s) => s.reset)
  const running = timer.status === 'running'

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Focus the primary control on open; Escape and an outside press close it.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-pomodoro-primary]')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current(true)
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target || panelRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-pomodoro-trigger],[data-pomodoro-fab]')) return
      closeRef.current(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const primaryLabel = running
    ? t('pomodoro.pause')
    : timer.status === 'paused'
      ? t('pomodoro.resume')
      : t('pomodoro.start')

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-pomodoro-panel
      className="fixed bottom-20 left-4 z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 text-card-foreground shadow-lg lecture:rounded-none lab:rounded-sm lg:bottom-auto lg:left-14 lg:top-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold">
            {t('pomodoro.label')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {phase} ·{' '}
            {t(
              running
                ? 'pomodoro.status.running'
                : timer.status === 'paused'
                  ? 'pomodoro.status.paused'
                  : 'pomodoro.status.idle',
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={t('common.close')}
          onClick={() => onClose(true)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <p
        role="timer"
        aria-live="off"
        className="my-3 text-center font-mono text-4xl font-semibold tabular-nums tracking-tight"
      >
        {clock}
      </p>

      {timer.autoPaused && (
        <p className="mb-3 text-xs text-primary" data-pomodoro-exam-note>
          {t('pomodoro.examPausedNote')}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          className="h-11 flex-1"
          onClick={() => (running ? pause() : start())}
          data-pomodoro-primary
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {primaryLabel}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={t('pomodoro.skip')}
          title={t('pomodoro.skip')}
          onClick={() => skip()}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={t('pomodoro.reset')}
          title={t('pomodoro.reset')}
          onClick={() => reset()}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {t('pomodoro.cycle', {
          done: Math.min(timer.completedFocus, settings.longBreakEvery),
          every: settings.longBreakEvery,
        })}
      </p>

      <details className="mt-3 border-t pt-2">
        <summary className="focus-ring flex min-h-11 cursor-pointer items-center text-sm font-medium">
          {t('pomodoro.quickEdit')}
        </summary>
        <PomodoroLengthFields settings={settings} className="mt-2 grid-cols-2" />
      </details>

      <Link
        to="/settings#focus-stats"
        onClick={() => onClose(false)}
        className="focus-ring mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-primary hover:underline"
      >
        <BarChart3 className="h-4 w-4" aria-hidden />
        {t('pomodoro.stats')}
      </Link>
    </div>
  )
}

const LENGTH_FIELDS: ReadonlyArray<{
  key: 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery'
  label: TranslationKey
}> = [
  { key: 'focusMinutes', label: 'pomodoro.focusMinutes' },
  { key: 'shortBreakMinutes', label: 'pomodoro.shortBreakMinutes' },
  { key: 'longBreakMinutes', label: 'pomodoro.longBreakMinutes' },
  { key: 'longBreakEvery', label: 'pomodoro.longBreakEvery' },
]

/** The four numbers (focus / short / long minutes, long break every N); saved on blur or Enter. */
export function PomodoroLengthFields({
  settings,
  className,
}: {
  settings: PomodoroSettings
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const save = useSavePomodoroSettings()
  const baseId = useId()
  return (
    <div className={cn('grid gap-2', className)}>
      {LENGTH_FIELDS.map(({ key, label }) => (
        <NumberField
          key={key}
          id={`${baseId}-${key}`}
          label={t(label)}
          value={settings[key]}
          limits={POMODORO_LIMITS[key]}
          onCommit={(value) =>
            save({ [key]: value }).catch(() =>
              toast({
                variant: 'error',
                title: t('settings.saveFailedTitle'),
                description: t('settings.saveFailed'),
              }),
            )
          }
        />
      ))}
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  limits,
  onCommit,
}: {
  id: string
  label: string
  value: number
  limits: readonly [number, number]
  onCommit: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(draft))
    if (!Number.isFinite(n) || draft.trim() === '') {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(limits[1], Math.max(limits[0], n))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={limits[0]}
        max={limits[1]}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        className="h-11"
      />
    </div>
  )
}
