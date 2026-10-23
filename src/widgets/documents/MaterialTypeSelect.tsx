import { LEARNING_MATERIAL_TYPES, type LearningMaterialType } from '@/entities/document/types'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { useTranslation } from '@/i18n'
import { MATERIAL_LABEL_KEY } from './materialLabels'

/** Material-type picker used by the single-file and batch dialogs. */
export function MaterialTypeSelect({
  value,
  onChange,
  id,
}: {
  value: LearningMaterialType
  onChange: (value: LearningMaterialType) => void
  id: string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('fileBatch.typeLabel')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as LearningMaterialType)}>
        <SelectTrigger id={id} className="h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEARNING_MATERIAL_TYPES.map((m) => (
            <SelectItem key={m} value={m}>
              {t(MATERIAL_LABEL_KEY[m])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
