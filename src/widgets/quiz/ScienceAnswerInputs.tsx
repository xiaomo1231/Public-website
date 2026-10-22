import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import { MathField } from '@/widgets/mathInput/MathField'
import { Input } from '@/shared/ui/Input'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import type { QuickItem } from '@/shared/lib/quickInsert'
import { angleOf, compassText, parseVectorAnswer } from '@/infrastructure/math/vectorAnswer'
import { parseFormulaAnswer } from '@/infrastructure/chemistry/nomenclature'
import {
  FORCE_TYPES,
  decodeForceRows,
  encodeForceRows,
  type ForceRow,
} from '@/entities/question/forceList'
import { useTranslation, type TranslationKey } from '@/i18n'

interface InputProps {
  question: Question
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  subject?: string
  onSubmit?: () => void
}

/** The few symbols a vector answer needs: brackets, separators, degrees, compass letters. */
const VECTOR_QUICK_ITEMS: QuickItem[] = [
  { glyph: '( , )', insert: '(, )', caret: 1 },
  { glyph: ',', insert: ', ' },
  { glyph: '−', insert: '-' },
  { glyph: '°', insert: '°' },
  { glyph: '∠', insert: '∠' },
  { glyph: 'N', insert: 'N' },
  { glyph: 'S', insert: 'S' },
  { glyph: 'E', insert: 'E' },
  { glyph: 'W', insert: 'W' },
  { glyph: 'of', insert: ' of ' },
  { glyph: 'î', insert: 'î' },
  { glyph: 'ĵ', insert: 'ĵ' },
]

function short(value: number): string {
  return value === 0 ? '0' : String(Number(value.toPrecision(3)))
}

/** Components or magnitude + direction, with a live "read as" line. */
export function VectorInput({
  question,
  value,
  onChange,
  disabled,
  subject,
  onSubmit,
}: InputProps): JSX.Element {
  const { t } = useTranslation()
  const parsed = value.trim() ? parseVectorAnswer(value) : null
  const unit = parsed?.unitText ? ` ${parsed.unitText}` : ''
  const preview = parsed
    ? `(${parsed.components.map(short).join(', ')})${unit}${
        parsed.components.length === 2 && Math.hypot(...parsed.components) > 0
          ? ` · ${compassText(angleOf(parsed.components))}`
          : ''
      }`
    : ''
  return (
    <div className="space-y-1">
      <MathField
        mode="text"
        subject={subject}
        value={value}
        onChange={onChange}
        quickItems={VECTOR_QUICK_ITEMS}
        placeholder={t('answerInput.vectorPlaceholder')}
        disabled={disabled}
        aria-label={t('questionType.vector')}
        {...(onSubmit ? { onSubmit } : {})}
      />
      {preview && (
        <p className="data-num text-xs text-muted-foreground" translate="no">
          {t('answerInput.vectorPreview', { value: preview })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {question.vector?.unit ? `${t('answerInput.quantityHint')} ` : ''}
        {t('answerInput.vectorHint')}
      </p>
    </div>
  )
}

const FORMULA_QUICK_ITEMS: QuickItem[] = [
  { glyph: 'x²', insert: '^{}', caret: 2 },
  { glyph: '·', insert: '·' },
  { glyph: '(', insert: '(' },
  { glyph: ')', insert: ')' },
  { glyph: '+', insert: '+' },
  { glyph: '−', insert: '-' },
]

/** Name → formula (formula field with a rendered preview), or formula → name (text). */
export function NomenclatureInput({
  question,
  value,
  onChange,
  disabled,
  subject,
  onSubmit,
}: InputProps): JSX.Element {
  const { t } = useTranslation()
  if (question.nomenclature?.direction === 'formula_to_name') {
    return (
      <MathField
        mode="text"
        subject={subject}
        value={value}
        onChange={onChange}
        placeholder={t('answerInput.namePlaceholder')}
        disabled={disabled}
        aria-label={t('nomenclature.name')}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  const text = value.trim()
  const readable = text ? parseFormulaAnswer(text, true) !== null : false
  return (
    <div className="space-y-1">
      <MathField
        mode="text"
        subject={subject}
        value={value}
        onChange={onChange}
        quickItems={FORMULA_QUICK_ITEMS}
        placeholder={t('answerInput.formulaPlaceholder')}
        disabled={disabled}
        aria-label={t('questionType.nomenclature')}
        {...(onSubmit ? { onSubmit } : {})}
      />
      {readable && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('answerInput.formulaPreview')}</span>
          <RichText text={`$\\ce{${text.replace(/\$/g, '')}}$`} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('answerInput.formulaHint')}</p>
    </div>
  )
}

/** Free-body diagram: one row per force (type, direction, optional magnitude). */
export function ForceListInput({ value, onChange, disabled }: InputProps): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const [rows, setRows] = useState<ForceRow[]>(() => {
    const decoded = decodeForceRows(value)
    return decoded.length > 0 ? decoded : [{ type: '', direction: '', magnitude: '' }]
  })
  const update = (next: ForceRow[]) => {
    setRows(next)
    onChange(encodeForceRows(next))
  }
  const set = (index: number, patch: Partial<ForceRow>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2" data-force-row>
            <label className="flex min-w-[9rem] flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t('answerInput.forceType')}</span>
              <select
                className="focus-ring h-9 rounded-md border border-input bg-background px-2 text-sm coarse:h-11"
                value={row.type}
                disabled={disabled}
                onChange={(event) => set(index, { type: event.target.value })}
              >
                <option value="">{t('answerInput.chooseForce')}</option>
                {FORCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`forceType.${type}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t('answerInput.forceDirection')}</span>
              <Input
                value={row.direction}
                disabled={disabled}
                aria-describedby={`${id}-hint`}
                onChange={(event) => set(index, { direction: event.target.value })}
              />
            </label>
            <label className="flex w-36 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t('answerInput.forceMagnitude')}</span>
              <Input
                value={row.magnitude}
                inputMode="decimal"
                disabled={disabled}
                onChange={(event) => set(index, { magnitude: event.target.value })}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('answerInput.removeForce')}
              disabled={disabled || rows.length <= 1}
              onClick={() => update(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= 8}
        onClick={() => setRows([...rows, { type: '', direction: '', magnitude: '' }])}
      >
        <Plus className="h-4 w-4" />
        {t('answerInput.addForce')}
      </Button>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t('answerInput.forceHint')}
      </p>
    </div>
  )
}
