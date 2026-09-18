import { ChevronRight, Loader2 } from 'lucide-react'

export type PracticeMode = 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness'

const OPTIONS: Array<{ mode: PracticeMode; label: string; hint: string }> = [
  { mode: 'same_concept', label: 'Same concept', hint: 'Another question on this knowledge point' },
  { mode: 'similar', label: 'Similar question', hint: 'A close variant of this one' },
  { mode: 'easier', label: 'Easier', hint: 'Step down a difficulty level' },
  { mode: 'harder', label: 'Harder', hint: 'Step up a difficulty level' },
  { mode: 'weakness', label: 'Weakness training', hint: 'Mix in your other weak points' },
]

export interface PracticeMoreMenuProps {
  onSelect: (mode: PracticeMode) => void
  busy?: boolean
}

export function PracticeMoreMenu({ onSelect, busy }: PracticeMoreMenuProps): JSX.Element {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Practice more</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            disabled={busy}
            onClick={() => onSelect(opt.mode)}
            className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-60"
          >
            <span className="flex-1">
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
            </span>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </div>
  )
}