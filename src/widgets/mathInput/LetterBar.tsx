import { languageSymbolGroup } from '@/shared/lib/mathInput'
import { useTranslation } from '@/i18n'
import { QuickInsertBar } from './QuickInsertBar'

/**
 * A row of the course language's letters (German ä ö ü ß, Hungarian á ő ű …)
 * for a plain text field, for keyboards without them. Inserts at the caret
 * of the field it is given. Renders nothing for languages without a group.
 */
export function LetterBar({
  language,
  field,
  value,
  onChange,
}: {
  language?: string | undefined
  /** The field to type into (read at click time). */
  field: () => HTMLInputElement | HTMLTextAreaElement | null
  /** Its current value (read at click time). */
  value: () => string
  onChange: (value: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const group = languageSymbolGroup(language)
  if (!group) return null
  return (
    <QuickInsertBar
      items={group.items}
      field={field}
      value={value}
      onChange={onChange}
      label={t(group.id === 'de' ? 'symbolGroup.de' : 'symbolGroup.hu')}
      mono={false}
    />
  )
}
