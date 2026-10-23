import { useMemo } from 'react'
import { formatCurveEquation, solveMarket } from '@/entities/econ/market'
import type { MarketFigure } from '@/entities/econ/graphQuestion'
import { useTranslation } from '@/i18n'
import { PlotFrame } from '@/widgets/tutor/PlotFrame'
import {
  CurveLabels,
  CurvePath,
  EquilibriumMark,
  OutcomeMarks,
  PolicyLine,
  ShiftArrows,
} from './marketPlot'
import {
  DEMAND,
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  PAD,
  SUPPLY,
  axisLabels,
  formatters,
  marketRanges,
  policyLineOf,
} from './marketPlotUtils'

/**
 * The supply-and-demand diagram printed with a graded graph question, drawn
 * from the question's market by the engine: the curves only, with the
 * original equilibrium, or with the change drawn (shifted curves, policy
 * line, the new outcome) — never the shaded answer areas.
 */
export function MarketQuestionFigure({
  figure,
  className,
}: {
  figure: MarketFigure
  className?: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const result = useMemo(() => solveMarket(figure.spec), [figure.spec])
  if (!result.ok) return null
  const solution = result.solution
  const ranges = marketRanges(solution)
  const fmt = formatters(figure)
  const after = figure.show === 'after' && solution.scenario !== 'equilibrium'
  const policy = after ? policyLineOf(figure.spec, solution, t) : null
  const labels = axisLabels(figure, t)
  const summary = t('viz.market.srCurves', {
    demand: formatCurveEquation(solution.demand),
    supply: formatCurveEquation(solution.supply),
  })
  return (
    <figure
      className={className ?? 'max-w-xl'}
      data-market-question-figure={figure.show}
      translate="no"
    >
      <PlotFrame
        width={FIGURE_WIDTH}
        height={FIGURE_HEIGHT}
        xRange={[0, ranges.q]}
        yRange={[0, ranges.p]}
        xLabel={labels.x}
        yLabel={labels.y}
        label={t('marketQ.figure.aria', { summary })}
        pad={PAD}
        overlay={(scale) => (
          <>
            {figure.show !== 'curves' && (
              <EquilibriumMark
                scale={scale}
                q={solution.original.q.value}
                p={solution.original.p.value}
                index={after ? '₁' : ''}
                fmt={fmt}
                point={solution.original}
              />
            )}
            {after && solution.binding && (
              <OutcomeMarks scale={scale} solution={solution} fmt={fmt} t={t} />
            )}
            <CurveLabels
              scale={scale}
              solution={solution}
              ranges={ranges}
              labels={{}}
              showNew={after}
            />
            {policy && (
              <text
                x={policy.axis === 'price' ? scale.right - 4 : scale.sx(policy.value) + 4}
                y={policy.axis === 'price' ? scale.sy(policy.value) - 5 : scale.top + 12}
                textAnchor={policy.axis === 'price' ? 'end' : 'start'}
                fontSize="11"
                fill="hsl(var(--foreground))"
              >
                {policy.label}
              </text>
            )}
          </>
        )}
      >
        {(scale) => (
          <>
            <CurvePath
              scale={scale}
              curve={solution.demand}
              ranges={ranges}
              color={DEMAND}
              dashed={after && !!solution.newDemand}
              id="demand"
            />
            <CurvePath
              scale={scale}
              curve={solution.supply}
              ranges={ranges}
              color={SUPPLY}
              dashed={after && !!solution.newSupply}
              id="supply"
            />
            {after && solution.newDemand && (
              <CurvePath
                scale={scale}
                curve={solution.newDemand}
                ranges={ranges}
                color={DEMAND}
                id="new-demand"
              />
            )}
            {after && solution.newSupply && (
              <CurvePath
                scale={scale}
                curve={solution.newSupply}
                ranges={ranges}
                color={SUPPLY}
                id="new-supply"
              />
            )}
            {after && solution.scenario === 'shift' && (
              <ShiftArrows scale={scale} solution={solution} />
            )}
            {policy && <PolicyLine scale={scale} line={policy} ranges={ranges} />}
          </>
        )}
      </PlotFrame>
    </figure>
  )
}
