/**
 * The figure engine of economics AI mock papers (`MockFigureEngine`): for a
 * figure group (several questions on one graph) it picks a market with
 * friendly numbers for the group's topic, draws it once, and builds every
 * slot's question about it locally — multiple choice with options from the
 * common mistakes, numeric parts with an exact check. All answers come from
 * the market engine; the AI is not asked to write these questions.
 */
import type { MockFigureEngine, MockFigureSpec } from '@/entities/exam/mockPaper'
import { buildMarketFigureGroup, type MarketGroupQuestion } from '@/entities/econ/graphGenerator'
import { parseMarketQuestion, type MarketFigure } from '@/entities/econ/graphQuestion'
import { createRng } from '@/entities/homework/practice/random'

export const MARKET_FIGURE_KIND = 'market'

export interface MarketFigureGroupSpec {
  figure: MarketFigure
  /** The locally written question of each slot, by slot id. */
  questions: Record<string, MarketGroupQuestion['raw']>
}

/** The engine; `seed` makes the markets reproducible (tests). */
export function createEconMockFigureEngine(options: { seed?: string } = {}): MockFigureEngine {
  return async (request) => {
    if (request.subject !== 'economics') return null
    // The paper's language: Chinese (with or without English terms) or
    // English; another exam language gets the English figure text.
    const language =
      request.language === 'zh' || request.language === 'zh_terms' || request.language === 'exam:zh'
        ? 'zh'
        : 'en'
    const group = buildMarketFigureGroup({
      topicName: request.topic.name,
      slots: request.slots.map((slot) => ({
        id: slot.id,
        kind: slot.kind,
        parts: slot.parts.map((part) => ({
          label: part.label,
          ...(part.marks !== undefined ? { marks: part.marks } : {}),
        })),
        ...(slot.marks !== undefined ? { marks: slot.marks } : {}),
        ...(slot.optionCount ? { optionCount: slot.optionCount } : {}),
      })),
      language,
      rng: createRng(
        options.seed ? `${options.seed}:${request.groupId}` : `${request.groupId}:${Math.random()}`,
      ),
    })
    if (!group) return null
    const spec: MarketFigureGroupSpec = {
      figure: group.figure,
      questions: Object.fromEntries(group.questions.map((item) => [item.slotId, item.raw])),
    }
    return { kind: MARKET_FIGURE_KIND, spec, description: group.description }
  }
}

/** The default engine used by the app. */
export const econMockFigureEngine: MockFigureEngine = createEconMockFigureEngine()

/** A stored market figure (checked again: it is read back from the database). */
export function readMarketFigureSpec(
  figure: MockFigureSpec | undefined,
): MarketFigureGroupSpec | null {
  if (!figure || figure.kind !== MARKET_FIGURE_KIND) return null
  const spec = figure.spec as Partial<MarketFigureGroupSpec> | null
  if (!spec || typeof spec !== 'object' || !spec.figure) return null
  // The figure must still solve (a shift question carries no target).
  const checked = parseMarketQuestion({ kind: 'shift_id', figure: spec.figure })
  const valid =
    checked ?? parseMarketQuestion({ kind: 'area_read', figure: spec.figure, target: 'eq_price' })
  if (!valid) return null
  return {
    figure: { ...spec.figure, spec: valid.figure.spec },
    questions: spec.questions && typeof spec.questions === 'object' ? spec.questions : {},
  }
}
