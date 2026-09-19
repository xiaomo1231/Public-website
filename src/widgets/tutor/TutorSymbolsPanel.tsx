import type { TutorSymbol } from '@/entities/tutorLesson/types'
import { Math } from '@/shared/ui/Math'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface TutorSymbolsPanelProps {
  symbols: TutorSymbol[]
  className?: string
}

/**
 * The symbols a lesson actually used.
 *
 * The list is derived from the lesson's own LaTeX (see `extractLatexSymbols`),
 * so it can never drift from what the student read, and it costs no extra AI
 * request. Every glyph is rendered by the LaTeX renderer — nothing is stored as
 * a pre-baked Unicode character.
 */
export function TutorSymbolsPanel({ symbols, className }: TutorSymbolsPanelProps): JSX.Element {
  const { t } = useTranslation()

  return (
    <section className={cn('min-w-0 space-y-3', className)} aria-label={t('tutor.symbols')}>
      <header className="space-y-0.5">
        <h2 className="text-sm font-semibold text-foreground">{t('tutor.symbols')}</h2>
        <p className="text-xs text-muted-foreground">
          {symbols.length > 0
            ? t('tutor.symbolsCount', { count: symbols.length })
            : t('tutor.symbolsHint')}
        </p>
      </header>

      {symbols.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('tutor.symbolsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {symbols.map((symbol) => (
            <li key={symbol.latex} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 text-foreground">
                <Math latex={symbol.displayLatex} className="text-[15px]" />
              </div>
              <p className="min-w-0 break-words text-xs font-medium text-foreground">
                {symbol.name}
              </p>
              <code className="block min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {symbol.latex}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
