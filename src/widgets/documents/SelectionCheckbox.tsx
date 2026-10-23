import { useEffect, useRef } from 'react'
import type { SelectionState } from '@/entities/document/selection'
import { cn } from '@/shared/lib/utils'

/**
 * Native checkboxes for file multi-select: a 44 px hit area on touch, the
 * theme's accent colour, Shift-click passed on as a range toggle.
 */

const BOX = 'h-4 w-4 cursor-pointer accent-primary coarse:h-5 coarse:w-5'
const HIT =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm coarse:min-h-11 coarse:min-w-11'

export function RowCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean
  label: string
  onToggle: (range: boolean) => void
}): JSX.Element {
  return (
    <label className={cn(HIT, 'h-8 w-8')}>
      <input
        type="checkbox"
        className={BOX}
        checked={checked}
        aria-label={label}
        data-row-select
        // Click carries Shift; Space on the box arrives as a click too.
        onClick={(event) => onToggle(event.shiftKey)}
        onChange={() => undefined}
      />
    </label>
  )
}

export function SelectAllCheckbox({
  state,
  label,
  onChange,
}: {
  state: SelectionState
  label: string
  onChange: (on: boolean) => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <label className={cn(HIT, 'gap-2 px-1 text-xs text-muted-foreground')}>
      <input
        ref={ref}
        type="checkbox"
        className={BOX}
        checked={state === 'all'}
        aria-checked={state === 'some' ? 'mixed' : state === 'all'}
        data-select-all
        onChange={() => onChange(state !== 'all')}
      />
      <span>{label}</span>
    </label>
  )
}
