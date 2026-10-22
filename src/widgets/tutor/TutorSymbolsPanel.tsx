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

  // lecture: a quiet marginal note (letter-spaced label, glyph + name).
  // lab: an inspector block (mono uppercase label, hairline rows, raw LaTeX).
  return (
    <section
      className={cn('min-w-0 space-y-3 lecture:space-y-2 lab:space-y-2', className)}
      aria-label={t('tutor.symbols')}
    >
      <header className="space-y-0.5 lab:flex lab:flex-wrap lab:items-baseline lab:gap-x-2 lab:space-y-0 lab:px-3.5">
        <h2 className="text-sm font-semibold text-foreground lecture:text-[11.5px] lecture:font-normal lecture:tracking-[0.14em] lecture:text-muted-foreground lab:font-mono lab:text-[10.5px] lab:font-medium lab:uppercase lab:tracking-[0.08em] lab:text-muted-foreground">
          {t('tutor.symbols')}
        </h2>
        <p className="text-xs text-muted-foreground lecture:text-[12px] lab:font-mono lab:text-[10.5px]">
          {symbols.length > 0
            ? t('tutor.symbolsCount', { count: symbols.length })
            : t('tutor.symbolsHint')}
        </p>
      </header>

      {symbols.length === 0 ? (
        <p className="text-xs text-muted-foreground lab:px-3.5">{t('tutor.symbolsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/60 lecture:divide-y-0 lab:divide-border lab:border-t">
          {symbols.map((symbol) => (
            <li
              key={symbol.latex}
              className="space-y-1 py-2.5 first:pt-0 last:pb-0 lecture:flex lecture:items-baseline lecture:gap-3 lecture:space-y-0 lecture:py-1 lab:grid lab:grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] lab:gap-x-2 lab:gap-y-0.5 lab:space-y-0 lab:px-3.5 lab:py-2 lab:first:pt-2 lab:last:pb-2"
            >
              {/* A symbol is one expression: it never wraps mid-way (KaTeX may
                  break between atoms otherwise); a long one scrolls in its cell. */}
              <div
                data-symbol-glyph
                className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap text-foreground lecture:max-w-[45%] lecture:shrink-0 lab:row-span-2 lab:max-w-[9.5rem]"
              >
                <Math
                  latex={symbol.displayLatex}
                  className="text-[15px] lecture:text-[14px] lab:text-[14px]"
                />
              </div>
              <p className="min-w-0 break-words text-xs font-medium text-foreground lecture:text-[13px] lecture:font-normal lecture:leading-[1.7] lecture:text-muted-foreground lab:text-[12.5px] lab:font-normal lab:text-muted-foreground">
                {symbol.name}
              </p>
              <code className="block min-w-0 truncate font-mono text-[11px] text-muted-foreground lecture:hidden">
                {symbol.latex}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
