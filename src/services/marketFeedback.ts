/**
 * Feedback for graded graph questions (economics), item by item:
 * "价格方向对，但数量应为「不确定」", "需求曲线没有移动", "新结果应在 Q ≈ 20,
 * P ≈ 74 附近". Shared by the quiz grader and the practice / mock-exam /
 * variant graders (`checkPracticeAnswer`).
 */
import type {
  MarketGradeResult,
  MarketItemResult,
  RegionKey,
  ShiftComponent,
} from '@/entities/econ/graphQuestion'
import { t, type TranslationKey } from '@/i18n'

const COMPONENT_KEYS: Record<ShiftComponent, TranslationKey> = {
  demand: 'marketQ.component.demand',
  supply: 'marketQ.component.supply',
  price: 'marketQ.component.price',
  quantity: 'marketQ.component.quantity',
}

/** A move / outcome word: "增加（右移）", "上升", "不确定" … */
export function moveLabel(component: ShiftComponent, value: string | null | undefined): string {
  if (!value) return t('marketQ.move.unanswered')
  const curve = component === 'demand' || component === 'supply'
  return t(`marketQ.move.${curve ? 'curve' : 'outcome'}.${value}` as TranslationKey)
}

export function regionLabel(region: RegionKey | string | null | undefined): string {
  if (!region) return t('marketQ.move.unanswered')
  return t(`viz.market.area.${region}` as TranslationKey)
}

function joinNames(names: string[]): string {
  return names.join(t('marketQ.listSeparator'))
}

function shiftFeedback(result: MarketGradeResult): string {
  const right = result.items.filter((item) => item.correct)
  const wrong = result.items.filter((item) => !item.correct)
  if (wrong.length === 0) return t('marketQ.shift.allRight')
  const wrongText = joinNames(
    wrong.map((item) =>
      t('marketQ.shift.shouldBe', {
        component: t(COMPONENT_KEYS[item.key as ShiftComponent]),
        expected: moveLabel(item.key as ShiftComponent, item.expected),
      }),
    ),
  )
  if (right.length === 0) return wrongText
  return t('marketQ.shift.partly', {
    right: joinNames(right.map((item) => t(COMPONENT_KEYS[item.key as ShiftComponent]))),
    wrong: wrongText,
  })
}

function drawItemFeedback(item: MarketItemResult): string {
  switch (item.key) {
    case 'curve':
      return item.correct
        ? t('marketQ.draw.curve.ok')
        : item.reason === 'extra-curve'
          ? t('marketQ.draw.curve.extra')
          : t('marketQ.draw.curve.notMoved')
    case 'direction':
      return item.correct
        ? t('marketQ.draw.direction.ok')
        : item.reason === 'not-moved'
          ? t('marketQ.draw.direction.notMoved')
          : t('marketQ.draw.direction.wrong')
    case 'amount':
      return item.correct ? t('marketQ.draw.amount.ok') : t('marketQ.draw.amount.wrong')
    case 'policy':
      return item.correct
        ? t('marketQ.draw.policy.ok')
        : item.reason === 'missing'
          ? t('marketQ.draw.policy.missing')
          : t('marketQ.draw.policy.wrong', { value: item.expected ?? '' })
    case 'equilibrium':
      return item.correct
        ? t('marketQ.draw.point.ok')
        : item.reason === 'missing'
          ? t('marketQ.draw.point.missing')
          : t('marketQ.draw.point.wrong', { point: item.expected ?? '' })
    case 'region':
      return item.correct
        ? t('marketQ.draw.region.ok')
        : item.reason === 'missing'
          ? t('marketQ.draw.region.missing')
          : t('marketQ.draw.region.wrong', {
              given: regionLabel(item.given),
              expected: regionLabel(item.expected),
            })
    default:
      return ''
  }
}

/** One line per item of a drawing (failed items first). */
export function drawFeedbackLines(result: MarketGradeResult): string[] {
  const failed = result.items.filter((item) => !item.correct).map(drawItemFeedback)
  const passed = result.items.filter((item) => item.correct).map(drawItemFeedback)
  return [...failed, ...passed].filter(Boolean)
}

/** The rule the points came from, as shown with the score. */
export function rubricSourceText(result: MarketGradeResult): string {
  return result.rubricSource === 'professor'
    ? t('marketQ.rubric.professor', { earned: result.earned, total: result.total })
    : t('marketQ.rubric.platform', { earned: result.earned, total: result.total })
}

/** The whole feedback as one note. */
export function marketFeedback(result: MarketGradeResult): string {
  if (result.unreadable) return t('marketQ.unreadable')
  switch (result.kind) {
    case 'shift_id':
      return `${shiftFeedback(result)} ${rubricSourceText(result)}`
    case 'draw_diagram':
      return `${drawFeedbackLines(result).join(' ')} ${rubricSourceText(result)}`
    case 'area_read':
      return ''
  }
}
