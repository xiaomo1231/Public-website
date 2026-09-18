import { ChevronRight, Loader2 } from 'lucide-react'
import { useTranslation, type TranslationKey } from '@/i18n'

export type PracticeMode = 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness'

const OPTIONS: Array<{ mode: PracticeMode; labelKey: TranslationKey; hintKey: TranslationKey }> = [
  { mode: 'same_concept', labelKey: 'practiceMore.sameConcept', hintKey: 'practiceMore.sameConceptHint' },
  { mode: 'similar', labelKey: 'practiceMore.similar', hintKey: 'practiceMore.similarHint' },
  { mode: 'easier', labelKey: 'practiceMore.easier', hintKey: 'practiceMore.easierHint' },
  { mode: 'harder', labelKey: 'practiceMore.harder', hintKey: 'practiceMore.harderHint' },
  { mode: 'weakness', labelKey: 'practiceMore.weakness', hintKey: 'practiceMore.weaknessHint' },
]

export interface PracticeMoreMenuProps {
  onSelect: (mode: PracticeMode) => void
  busy?: boolean
}

export function PracticeMoreMenu({ onSelect, busy }: PracticeMoreMenuProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('practiceMore.title')}</p>
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
              <span className="block font-medium">{t(opt.labelKey)}</span>
              <span className="block text-xs text-muted-foreground">{t(opt.hintKey)}</span>
            </span>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </div>
  )
}