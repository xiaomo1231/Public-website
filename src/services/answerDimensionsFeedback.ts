/**
 * Feedback for a numeric answer judged on three dimensions (value, unit,
 * significant figures): one sentence that names exactly which dimension is
 * off and why, e.g. 「数值和单位正确；本题要求 3 位有效数字，你提交了 4 位。请按
 * 课程要求重新表示。」, plus the course rule line shown with every result
 * 「有效数字评分规则：仅提示，不扣分（平台拟定规则）」.
 */
import type {
  AnswerDimensions,
  SigFigBasis,
  SigFigRuleApplied,
} from '@/entities/question/answerDimensions'
import { formatSigFigs, readSigFigs } from '@/infrastructure/math/significantFigures'
import { t, type TranslationKey } from '@/i18n'

const BASIS_KEYS: Record<SigFigBasis, TranslationKey> = {
  stated: 'answerDims.basis.stated',
  data: 'answerDims.basis.data',
  professor: 'answerDims.basis.professor',
}

function figures(given: { min: number; max: number }): string {
  return given.min === given.max
    ? String(given.min)
    : t('answerDims.figuresRange', { min: given.min, max: given.max })
}

function formatValue(value: number): string {
  return Number.parseFloat(value.toPrecision(4)).toString()
}

/** The unit sentence, or '' when the unit is right. */
function unitSentence(
  unit: NonNullable<AnswerDimensions['unit']>,
  extra: { convertedValue?: number; given: string },
): string {
  switch (unit.status) {
    case 'missing':
      return t('answerDims.unitMissing', { unit: unit.expected })
    case 'wrong-dimension':
      return t('answerDims.unitWrongDimension', {
        given: unit.given ?? '',
        unit: unit.expected,
      })
    case 'wrong-unit':
      return t('answerDims.unitWrongUnit', {
        given: unit.given ?? '',
        unit: unit.expected,
        value: extra.convertedValue !== undefined ? formatValue(extra.convertedValue) : '?',
      })
    case 'unreadable':
      return t('question.unitUnreadable', { unit: unit.given ?? extra.given })
    default:
      return ''
  }
}

/** The significant-figure sentence for a right value (and unit), or ''. */
function sigFigSentence(
  sigFigs: NonNullable<AnswerDimensions['sigFigs']>,
  withUnit: boolean,
  given: string,
): string {
  const basis = sigFigs.basis ? t(BASIS_KEYS[sigFigs.basis]) : ''
  const lead = t(withUnit ? 'answerDims.valueUnitRight' : 'answerDims.valueRight')
  if (sigFigs.status === 'too-many' || sigFigs.status === 'too-few') {
    return t(
      sigFigs.status === 'too-many' ? 'answerDims.sigFigsTooMany' : 'answerDims.sigFigsTooFew',
      {
        lead,
        required: sigFigs.required,
        given: sigFigs.given ? figures(sigFigs.given) : '?',
        basis,
      },
    )
  }
  if (sigFigs.status === 'correct' && sigFigs.ambiguous) {
    const reading = readSigFigs(given)
    return t('answerDims.sigFigsAmbiguous', {
      lead,
      required: sigFigs.required,
      suggestion: reading ? formatSigFigs(reading.value, sigFigs.required) : '',
    })
  }
  if (sigFigs.status === 'unreadable')
    return t('answerDims.sigFigsUnreadable', { required: sigFigs.required })
  return ''
}

/**
 * One sentence about what is off. A wrong value or unit is named first; the
 * significant figures are only discussed once value and unit are right (a
 * sig-fig remark on a wrong value would be noise).
 */
export function dimensionsNote(
  dimensions: AnswerDimensions,
  extra: { convertedValue?: number; unit?: string; given: string },
): string {
  const unit = dimensions.unit
  if (dimensions.value === 'unreadable')
    return unit?.status === 'unreadable'
      ? unitSentence(unit, extra)
      : t('errors.numberUnreadable', { answer: t('question.unverified') })
  if (unit && unit.status !== 'correct') {
    if (unit.status === 'missing' && dimensions.value === 'correct')
      return t('answerDims.valueRightUnitMissing', { unit: unit.expected })
    return unitSentence(unit, extra)
  }
  if (dimensions.value === 'wrong') {
    const converted =
      unit?.converted && extra.convertedValue !== undefined
        ? t('question.unitConverted', {
            value: formatValue(extra.convertedValue),
            unit: unit.expected,
          })
        : ''
    return [t(unit ? 'answerDims.valueWrongUnitRight' : 'answerDims.valueWrong'), converted]
      .filter(Boolean)
      .join(' ')
  }
  const sigFigs = dimensions.sigFigs
  const sigFigText = sigFigs ? sigFigSentence(sigFigs, Boolean(unit), extra.given) : ''
  if (sigFigText) return sigFigText
  if (unit?.converted && unit.given)
    return t('answerDims.unitConverted', { given: unit.given, unit: unit.expected })
  return ''
}

/** 「有效数字评分规则：扣 25%（教授规则）」 */
export function sigFigRuleText(
  rule: Pick<SigFigRuleApplied, 'mode' | 'percent' | 'source'>,
): string {
  const mode =
    rule.mode === 'deduct'
      ? t('sigFigRule.deduct', { percent: rule.percent ?? 0 })
      : t('sigFigRule.hint')
  return t('sigFigRule.line', {
    mode,
    source: t(
      rule.source === 'professor' ? 'sigFigRule.source.professor' : 'sigFigRule.source.platform',
    ),
  })
}

/** What happened to THIS answer under the rule (only when its sig figs were off). */
export function sigFigOutcomeText(rule: SigFigRuleApplied): string {
  return rule.deducted
    ? t('sigFigRule.deducted', { percent: rule.percent ?? 0 })
    : t('sigFigRule.notDeducted')
}
