/**
 * Small helpers shared by the question model and the graders: which question
 * types are graph questions, and a stored graph answer in a compact,
 * language-neutral form for lists and results (`D ↑ · S – · P ↑ · Q ?`).
 */
import {
  decodeDrawAnswer,
  decodeShiftAnswer,
  type MarketQuestionKind,
  type OutcomeMove,
} from './graphQuestion'

export function isMarketQuestionType(type: string): type is MarketQuestionKind {
  return type === 'shift_id' || type === 'area_read' || type === 'draw_diagram'
}

const ARROW: Record<OutcomeMove | 'none', string> = {
  increase: '↑',
  decrease: '↓',
  unchanged: '–',
  none: '–',
  ambiguous: '?',
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100).replace('-', '−')
}

/** A stored graph answer, readable; any other text unchanged. */
export function formatMarketAnswerCode(answer: string): string {
  const shift = decodeShiftAnswer(answer)
  if (shift) {
    const parts: string[] = []
    if (shift.demand) parts.push(`D ${ARROW[shift.demand]}`)
    if (shift.supply) parts.push(`S ${ARROW[shift.supply]}`)
    if (shift.price) parts.push(`P ${ARROW[shift.price]}`)
    if (shift.quantity) parts.push(`Q ${ARROW[shift.quantity]}`)
    return parts.join(' · ')
  }
  const draw = decodeDrawAnswer(answer)
  if (draw) {
    const parts: string[] = []
    const move = (label: string, drag: { dq: number; dp: number } | undefined) => {
      if (!drag || (Math.abs(drag.dq) < 1e-9 && Math.abs(drag.dp) < 1e-9)) return
      parts.push(`${label} Δ(${round(drag.dq)}, ${round(drag.dp)})`)
    }
    move('D', draw.demand)
    move('S', draw.supply)
    if (draw.policy !== undefined) parts.push(`— ${round(draw.policy)}`)
    if (draw.point) parts.push(`E (${round(draw.point.q)}, ${round(draw.point.p)})`)
    if (draw.region) parts.push(`▧ ${draw.region}`)
    return parts.join(' · ')
  }
  return answer
}

/** A draft with graph answers (`(a) shift: …` lines), each graph answer made readable. */
export function formatMarketDraft(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const match = /^(\s*\([a-z]\)\s*)?((?:shift|draw)\s*:.*)$/i.exec(line)
      return match ? `${match[1] ?? ''}${formatMarketAnswerCode(match[2]!)}` : line
    })
    .join('\n')
}
