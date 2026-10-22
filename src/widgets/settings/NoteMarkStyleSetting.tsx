import type { CSSProperties } from 'react'
import { Highlighter, Link2 } from 'lucide-react'
import { NOTE_MARK_STYLES, type NoteMarkStyle } from '@/entities/user/types'
import { useNoteMarkStyle } from '@/features/theme/noteMarkStyle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const ICONS = { link: Link2, highlighter: Highlighter } as const

/** Static look of each style for the preview (the real marks use `::highlight`, see globals.css). */
const PREVIEW: Record<NoteMarkStyle, { saved: CSSProperties; unsaved: CSSProperties }> = {
  link: {
    saved: {
      color: 'hsl(var(--primary-strong))',
      backgroundColor: 'hsl(var(--primary) / 0.08)',
      textDecoration: 'underline',
      textDecorationColor: 'hsl(var(--primary-strong))',
      textDecorationThickness: '2px',
    },
    unsaved: {
      color: 'hsl(var(--primary-strong))',
      textDecoration: 'underline dashed',
      textDecorationColor: 'hsl(var(--primary) / 0.6)',
      textDecorationThickness: '1.5px',
    },
  },
  highlighter: {
    saved: { backgroundColor: 'hsl(var(--primary) / 0.28)' },
    unsaved: { backgroundColor: 'hsl(var(--primary) / 0.13)' },
  },
}

/**
 * 问答标记样式: how walkthrough passages with questions are marked. Applies at
 * once (it is not part of the settings Save button), like the appearance picker.
 */
export function NoteMarkStyleSetting({
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
}: {
  className?: string
  headerClassName?: string
  titleClassName?: string
  bodyClassName?: string
}): JSX.Element {
  const { t } = useTranslation()
  const { style, setStyle } = useNoteMarkStyle()
  return (
    <Card className={className} data-note-mark-setting>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>{t('settings.noteMark.title')}</CardTitle>
        <CardDescription>{t('settings.noteMark.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-3', bodyClassName)}>
        <div
          role="radiogroup"
          aria-label={t('settings.noteMark.label')}
          className="grid gap-2 sm:grid-cols-2"
        >
          {NOTE_MARK_STYLES.map((option) => {
            const Icon = ICONS[option]
            const selected = option === style
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-note-mark-option={option}
                onClick={() => setStyle(option)}
                className={cn(
                  'focus-ring flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition-colors duration-150 hover:bg-muted lecture:rounded-none lab:rounded-none',
                  selected && 'border-primary ring-1 ring-primary',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(`settings.noteMark.${option}` as TranslationKey)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`settings.noteMark.${option}Hint` as TranslationKey)}
                </span>
                <span className="leading-relaxed">
                  <span style={PREVIEW[option].saved}>{t('settings.noteMark.previewSaved')}</span>
                  {' · '}
                  <span style={PREVIEW[option].unsaved}>
                    {t('settings.noteMark.previewUnsaved')}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
