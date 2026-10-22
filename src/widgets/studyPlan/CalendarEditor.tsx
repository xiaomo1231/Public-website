import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { toast } from '@/features/toast/toastStore'
import { DAY_TYPES, type DayType, type StudyCalendar } from '@/entities/studyPlan/types'
import { clampMinutes, dayKey } from '@/entities/studyPlan/calendar'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const DAY_TYPE_KEYS: Record<DayType, TranslationKey> = {
  class: 'plan.dayType.class',
  weekend: 'plan.dayType.weekend',
  holiday: 'plan.dayType.holiday',
  off: 'plan.dayType.off',
}

/** Monday first, as `Date.getDay()` indexes. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_KEYS: TranslationKey[] = [
  'plan.weekday.0',
  'plan.weekday.1',
  'plan.weekday.2',
  'plan.weekday.3',
  'plan.weekday.4',
  'plan.weekday.5',
  'plan.weekday.6',
]

/**
 * 日历: minutes per day type, the weekly pattern, and per-day exceptions
 * (a holiday, a day off, a day with more or less time).
 */
export function CalendarEditor(): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const [calendar, setCalendar] = useState<StudyCalendar | null>(null)
  const [overrideDate, setOverrideDate] = useState(() => dayKey(Date.now()))
  const [overrideType, setOverrideType] = useState<DayType>('holiday')
  const [overrideMinutes, setOverrideMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void service.getPlan().then((plan) => {
      if (alive) setCalendar(plan.calendar)
    })
    return () => {
      alive = false
    }
  }, [service])

  if (!calendar) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  async function save(next: StudyCalendar) {
    setSaving(true)
    try {
      const plan = await service.saveCalendar(next)
      setCalendar(plan.calendar)
      await service.replan()
      toast({ variant: 'success', title: t('plan.calendar.saved') })
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

  const overrides = Object.entries(calendar.overrides).sort(([a], [b]) => a.localeCompare(b))

  return (
    <section className="space-y-6" data-plan-calendar>
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t('plan.calendar.minutesTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['class', 'weekend', 'holiday'] as const).map((type) => (
            <div key={type} className="space-y-1">
              <Label htmlFor={`minutes-${type}`}>{t(DAY_TYPE_KEYS[type])}</Label>
              <Input
                id={`minutes-${type}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={960}
                step={15}
                value={calendar.minutes[type]}
                onChange={(event) =>
                  setCalendar({
                    ...calendar,
                    minutes: {
                      ...calendar.minutes,
                      [type]: clampMinutes(Number(event.target.value)),
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('plan.calendar.minutesHint')}</p>
      </div>

      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t('plan.calendar.weekTitle')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {WEEK_ORDER.map((day) => (
            <div key={day} className="space-y-1">
              <Label htmlFor={`weekday-${day}`}>{t(WEEKDAY_KEYS[day]!)}</Label>
              <select
                id={`weekday-${day}`}
                className="focus-ring h-10 w-full rounded-md border bg-background px-2 text-sm"
                value={calendar.weekly[day]}
                onChange={(event) => {
                  const weekly = [...calendar.weekly]
                  weekly[day] = event.target.value as DayType
                  setCalendar({ ...calendar, weekly })
                }}
              >
                {DAY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(DAY_TYPE_KEYS[type])}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t('plan.calendar.overridesTitle')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="override-date">{t('plan.calendar.day')}</Label>
            <Input
              id="override-date"
              type="date"
              value={overrideDate}
              onChange={(event) => setOverrideDate(event.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-type">{t('plan.calendar.type')}</Label>
            <select
              id="override-type"
              className="focus-ring h-10 rounded-md border bg-background px-2 text-sm"
              value={overrideType}
              onChange={(event) => setOverrideType(event.target.value as DayType)}
            >
              {DAY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(DAY_TYPE_KEYS[type])}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-minutes">{t('plan.calendar.minutesOptional')}</Label>
            <Input
              id="override-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={960}
              value={overrideMinutes}
              disabled={overrideType === 'off'}
              onChange={(event) => setOverrideMinutes(event.target.value)}
              className="w-32"
            />
          </div>
          <Button
            variant="outline"
            disabled={!overrideDate}
            onClick={() =>
              setCalendar({
                ...calendar,
                overrides: {
                  ...calendar.overrides,
                  [overrideDate]: {
                    type: overrideType,
                    ...(overrideMinutes.trim() !== '' && overrideType !== 'off'
                      ? { minutes: clampMinutes(Number(overrideMinutes)) }
                      : {}),
                  },
                },
              })
            }
          >
            {t('plan.calendar.addOverride')}
          </Button>
        </div>
        {overrides.length > 0 && (
          <ul className="divide-y rounded-md border lab:rounded-none">
            {overrides.map(([date, value]) => (
              <li key={date} className="flex items-center gap-3 px-3 py-2 text-sm tabular-nums">
                <span className="flex-1">
                  {date} · {t(DAY_TYPE_KEYS[value.type])}
                  {value.minutes !== undefined &&
                    ` · ${t('plan.task.minutes', { minutes: value.minutes })}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('plan.calendar.removeOverride', { date })}
                  onClick={() => {
                    const rest = { ...calendar.overrides }
                    delete rest[date]
                    setCalendar({ ...calendar, overrides: rest })
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button disabled={saving} onClick={() => void save(calendar)}>
        {t('plan.calendar.save')}
      </Button>
    </section>
  )
}
