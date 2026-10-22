import type { CSSProperties } from 'react'
import { Highlighter, Link2 } from 'lucide-react'
import {
  NOTE_HIGHLIGHT_COLORS,
  NOTE_MARK_STYLES,
  type NoteHighlightColor,
  type NoteMarkStyle,
} from '@/entities/user/types'
import { useNoteHighlightColor, useNoteMarkStyle } from '@/features/theme/noteMarkStyle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { useTranslation, type TranslationKey } from '@/i18n'

const ICONS = { link: Link2, highlighter: Highlighter } as const

/**
 * Static look of each style for the previews (the real marks use `::highlight`,
 * see globals.css). The highlighter fills read the `--note-hl*` tokens, which
 * the nearest `[data-note-color]` element sets — so a preview shows whichever
 * colour its wrapper carries.
 */
const PREVIEW: Record<NoteMarkStyle, { saved: CSSProperties; unsaved: CSSProperties }> = {
  link: {
    saved: {
      color: 'hsl(var(--primary-strong))',
      textDecoration: 'underline',
      textDecorationColor: 'hsl(var(--primary-strong))',
      textDecorationThickness: '2px',
    },
    unsaved: {
      textDecoration: 'underline dashed',
      textDecorationColor: 'hsl(var(--muted-foreground))',
      textDecorationThickness: '1.5px',
    },
  },
  highlighter: {
    saved: { backgroundColor: 'hsl(var(--note-hl) / var(--note-hl-saved-a))' },
    unsaved: { backgroundColor: 'hsl(var(--note-hl) / var(--note-hl-unsaved-a))' },
  },
}

/**
 * 问答标记样式: how walkthrough passages with questions are marked, plus the
 * highlighter colour (shown only for the highlighter style). Applies at once
 * (it is not part of the settings Save button), like the appearance picker.
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
  const { color, setColor } = useNoteHighlightColor()
  return (
    <Card className={className} data-note-mark-setting>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>{t('settings.noteMark.title')}</CardTitle>
        <CardDescription>{t('settings.noteMark.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-4', bodyClassName)}>
        <div
          role="radiogroup"
          aria-label={t('settings.noteMark.label')}
          className="grid gap-2 sm:grid-cols-2"
        >
          {NOTE_MARK_STYLES.map((option, index) => {
            const Icon = ICONS[option]
            const selected = option === style
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-note-mark-option={option}
                tabIndex={selected ? 0 : -1}
                onClick={() => setStyle(option)}
                onKeyDown={(event) => onRadioKeyDown(event, NOTE_MARK_STYLES, index, setStyle)}
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
                <span className="leading-relaxed" data-note-color={color}>
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

        {style === 'highlighter' && <HighlightColorPicker color={color} setColor={setColor} />}

        <p
          className="text-sm leading-relaxed"
          data-note-color={color}
          data-note-mark-preview={style}
        >
          <span className="mr-2 text-xs font-medium text-muted-foreground">
            {t('settings.noteMark.previewLabel')}
          </span>
          {t('settings.noteMark.previewLead')}
          <span data-preview-mark="saved" style={PREVIEW[style].saved}>
            {t('settings.noteMark.previewSaved')}
          </span>
          {t('settings.noteMark.previewJoin')}
          <span data-preview-mark="unsaved" style={PREVIEW[style].unsaved}>
            {t('settings.noteMark.previewUnsaved')}
          </span>
          {t('settings.noteMark.previewEnd')}
        </p>
      </CardContent>
    </Card>
  )
}

function HighlightColorPicker({
  color,
  setColor,
}: {
  color: NoteHighlightColor
  setColor: (color: NoteHighlightColor) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <p id="note-highlight-color-label" className="text-sm font-medium">
        {t('settings.noteMark.colorLabel')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="note-highlight-color-label"
        className="flex flex-wrap gap-2"
        data-note-color-picker
      >
        {NOTE_HIGHLIGHT_COLORS.map((option, index) => {
          const selected = option === color
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              data-note-color-option={option}
              tabIndex={selected ? 0 : -1}
              onClick={() => setColor(option)}
              onKeyDown={(event) => onRadioKeyDown(event, NOTE_HIGHLIGHT_COLORS, index, setColor)}
              className={cn(
                'focus-ring inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors duration-150 hover:bg-muted lecture:rounded-none lab:rounded-none',
                selected && 'border-primary ring-1 ring-primary',
              )}
            >
              <span
                aria-hidden
                data-note-color={option}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border"
              >
                <span
                  className="h-full w-full rounded-full"
                  style={{ backgroundColor: 'hsl(var(--note-hl) / var(--note-hl-saved-a))' }}
                />
              </span>
              {t(`settings.noteMark.color.${option}` as TranslationKey)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
