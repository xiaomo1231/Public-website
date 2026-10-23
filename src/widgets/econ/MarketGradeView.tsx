import { CheckCircle2, XCircle } from 'lucide-react'
import type {
  MarketGradeResult,
  MarketItemResult,
  ShiftComponent,
} from '@/entities/econ/graphQuestion'
import { useTranslation, type TranslationKey } from '@/i18n'
import { moveLabel, regionLabel } from '@/services/marketFeedback'

const DRAW_KEYS: Record<string, TranslationKey> = {
  curve: 'marketQ.draw.curve.ok',
  direction: 'marketQ.draw.direction.ok',
  amount: 'marketQ.draw.amount.ok',
  policy: 'marketQ.draw.policy.ok',
  equilibrium: 'marketQ.draw.point.ok',
  region: 'marketQ.draw.region.ok',
}

function itemText(
  item: MarketItemResult,
  kind: MarketGradeResult['kind'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (kind === 'shift_id') {
    const component = item.key as ShiftComponent
    const name = t(`marketQ.component.${component}` as TranslationKey)
    return item.correct
      ? `${name}: ${moveLabel(component, item.expected)}`
      : `${name}: ${moveLabel(component, item.given)} → ${t('marketQ.result.expected', {
          expected: moveLabel(component, item.expected),
        })}`
  }
  if (item.key === 'region' && !item.correct && item.reason === 'wrong-region')
    return t('marketQ.draw.region.wrong', {
      given: regionLabel(item.given),
      expected: regionLabel(item.expected),
    })
  if (item.correct) return t(DRAW_KEYS[item.key] ?? 'marketQ.result.right')
  switch (item.key) {
    case 'curve':
      return t(
        item.reason === 'extra-curve' ? 'marketQ.draw.curve.extra' : 'marketQ.draw.curve.notMoved',
      )
    case 'direction':
      return t(
        item.reason === 'not-moved'
          ? 'marketQ.draw.direction.notMoved'
          : 'marketQ.draw.direction.wrong',
      )
    case 'amount':
      return t('marketQ.draw.amount.wrong')
    case 'policy':
      return item.reason === 'missing'
        ? t('marketQ.draw.policy.missing')
        : t('marketQ.draw.policy.wrong', { value: item.expected ?? '' })
    case 'equilibrium':
      return item.reason === 'missing'
        ? t('marketQ.draw.point.missing')
        : t('marketQ.draw.point.wrong', { point: item.expected ?? '' })
    case 'region':
      return t('marketQ.draw.region.missing')
    default:
      return t('marketQ.result.wrong')
  }
}

/**
 * Item-by-item result of a graph question (shift components or drawing
 * items), with where the points come from: the professor's marking scheme
 * when it maps onto the items, otherwise the platform rule (平台拟定).
 */
export function MarketGradeView({ result }: { result: MarketGradeResult }): JSX.Element | null {
  const { t } = useTranslation()
  if (result.kind === 'area_read' || result.items.length === 0) return null
  return (
    <div className="space-y-1 text-xs" data-market-grade={result.kind}>
      <p className="font-medium">{t('marketQ.result.items')}</p>
      <ul className="space-y-0.5">
        {result.items.map((item) => (
          <li key={item.key} className="flex items-start gap-1.5" data-market-item={item.key}>
            {item.correct ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
            )}
            <span className="sr-only">
              {t(item.correct ? 'marketQ.result.right' : 'marketQ.result.wrong')}
            </span>
            <span>{itemText(item, result.kind, t)}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground" data-market-rubric={result.rubricSource}>
        {t(
          result.rubricSource === 'professor'
            ? 'marketQ.rubric.professor'
            : 'marketQ.rubric.platform',
          { earned: result.earned, total: result.total },
        )}
      </p>
      {result.rubricLines
        ?.filter((line) => line.keys.length === 0)
        .map((line) => (
          <p key={line.text} className="text-muted-foreground">
            {t('marketQ.rubric.unmapped', { line: line.text })}
          </p>
        ))}
    </div>
  )
}
