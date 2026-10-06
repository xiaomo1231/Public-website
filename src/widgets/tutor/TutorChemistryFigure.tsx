import { useEffect, useRef, useState } from 'react'
import SmilesDrawer from 'smiles-drawer'
import { niceTickStep } from '@/entities/tutorVisualization/linear'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  asTitrationSetup,
  bufferPoints,
  energyProfileFacts,
  equivalenceVolumes,
  titrationCurve,
  titrationPH,
  type TitrationSetup,
} from '@/entities/tutorVisualization/chemistry'
import type {
  EnergyVisualization,
  MoleculeEntry,
  MoleculeVisualization,
  TitrationVisualization,
} from '@/entities/tutorVisualization/types'
import { Math as TeX } from '@/shared/ui/Math'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

const AXIS = 'hsl(var(--viz-axis))'
const GRID = 'hsl(var(--viz-grid))'
const LABEL = 'hsl(var(--viz-label))'
const SERIES = 'hsl(var(--viz-series-1))'
const ACCENT = 'hsl(var(--viz-series-2))'
const FOREGROUND = 'hsl(var(--foreground))'

type T = UseTranslationResult['t']

function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + step * 1e-9 && out.length < 40; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return out
}

// --- molecules --------------------------------------------------------------

/**
 * Element colours follow the app's visualization tokens, so a structure reads
 * correctly in light and dark themes; carbon skeleton bonds use the text colour.
 */
const ELEMENT_THEME = {
  FOREGROUND: 'currentColor',
  BACKGROUND: 'transparent',
  C: 'currentColor',
  H: 'hsl(var(--viz-label))',
  O: 'hsl(var(--viz-series-2))',
  N: 'hsl(var(--viz-series-1))',
  F: 'hsl(var(--viz-series-3))',
  CL: 'hsl(var(--viz-series-3))',
  BR: 'hsl(var(--viz-series-4))',
  I: 'hsl(var(--viz-series-4))',
  P: 'hsl(var(--viz-series-4))',
  S: 'hsl(var(--viz-series-4))',
  B: 'hsl(var(--viz-series-4))',
  SI: 'hsl(var(--viz-series-4))',
}

/** Screen pixels per drawing unit (a bond is 30 units long). */
const MOLECULE_SCALE = 1.6

/** `C9H8O4` → `\ce{C9H8O4}` for KaTeX/mhchem. */
function formulaTeX(formula: string): string {
  return `\\ce{${formula}}`
}

function MoleculeStructure({ molecule, t }: { molecule: MoleculeEntry; t: T }): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    let ok = false
    try {
      SmilesDrawer.parse(
        molecule.smiles,
        (tree) => {
          const drawer = new SmilesDrawer.SvgDrawer({
            themes: { app: ELEMENT_THEME },
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            bondThickness: 1.2,
            padding: 12,
            // Draw every group as a skeleton; condensed labels ("COOHCH3")
            // hide the structure the figure is meant to teach.
            compactDrawing: false,
          })
          drawer.draw(tree, svg, 'app')
          ok = true
        },
        () => {
          ok = false
        },
      )
    } catch {
      ok = false
    }
    // Draw at a fixed scale of the molecule's own size (capped by the card),
    // so atom labels keep a readable size whether the molecule is small or large.
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    const box = svg.viewBox?.baseVal
    if (ok && box && box.width > 0) {
      svg.style.width = `${Math.round(box.width * MOLECULE_SCALE)}px`
      svg.style.height = 'auto'
    } else {
      svg.style.removeProperty('width')
      svg.style.removeProperty('height')
    }
    setFailed(!ok)
  }, [molecule.smiles])

  const label = t('viz.moleculeAria', { name: molecule.name ?? molecule.formula, formula: molecule.formula })
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      {failed ? (
        <p className="py-6 text-sm text-muted-foreground">{t('viz.moleculeUnavailable')}</p>
      ) : (
        <svg
          ref={svgRef}
          role="img"
          aria-label={label}
          className="block h-auto max-h-72 max-w-full text-foreground"
        />
      )}
      <p className="text-center text-[13px] text-muted-foreground">
        {molecule.name && <span className="mr-1.5 font-medium text-foreground">{molecule.name}</span>}
        <TeX latex={formulaTeX(molecule.formula)} />
      </p>
    </div>
  )
}

export function TutorMoleculeFigure({
  visualization,
  t,
}: {
  visualization: MoleculeVisualization
  t: T
}): JSX.Element {
  return (
    <div
      className="grid items-end gap-3 px-1 py-2"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 180px), 1fr))` }}
    >
      {visualization.molecules.map((molecule, index) => (
        <MoleculeStructure key={`${molecule.smiles}-${index}`} molecule={molecule} t={t} />
      ))}
    </div>
  )
}

// --- reaction energy profile -------------------------------------------------

export function TutorEnergySvg({
  visualization,
  layout,
  t,
}: {
  visualization: EnergyVisualization
  layout: PlotLayout
  t: T
}): JSX.Element {
  const { states, unit } = visualization
  const facts = energyProfileFacts(states)
  const energies = states.map((state) => state.energy)
  const span = Math.max(...energies) - Math.min(...energies)
  const yMin = Math.min(...energies) - span * 0.18
  const yMax = Math.max(...energies) + span * 0.22

  const { width, height } = layout
  const pad = { ...layout.pad, left: layout.pad.left + 8, bottom: layout.pad.bottom + 6 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const sy = (y: number) => pad.top + (1 - (y - yMin) / (yMax - yMin)) * plotH
  const slot = plotW / states.length
  const cx = (i: number) => pad.left + slot * (i + 0.5)
  const plateau = Math.min(slot * 0.5, 70)

  // Species are short plateaus, transition states are peaks; joined smoothly.
  const ends = states.map((state, i) =>
    state.transition
      ? { left: cx(i), right: cx(i), y: sy(state.energy) }
      : { left: cx(i) - plateau / 2, right: cx(i) + plateau / 2, y: sy(state.energy) },
  )
  let path = `M ${ends[0]!.left.toFixed(2)} ${ends[0]!.y.toFixed(2)} L ${ends[0]!.right.toFixed(2)} ${ends[0]!.y.toFixed(2)}`
  for (let i = 1; i < ends.length; i++) {
    const from = ends[i - 1]!
    const to = ends[i]!
    const mid = (from.right + to.left) / 2
    path += ` C ${mid.toFixed(2)} ${from.y.toFixed(2)}, ${mid.toFixed(2)} ${to.y.toFixed(2)}, ${to.left.toFixed(2)} ${to.y.toFixed(2)}`
    if (to.right !== to.left) path += ` L ${to.right.toFixed(2)} ${to.y.toFixed(2)}`
  }

  const reactantY = sy(states[0]!.energy)
  const peakIndex = energies.indexOf(Math.max(...energies))
  const productIndex = states.length - 1
  const productX = cx(productIndex) + plateau / 2 + 10
  const eaX = cx(peakIndex)
  const yTicks = ticks(yMin, yMax, niceTickStep(yMax - yMin, layout.compact ? 4 : 6))
  const label = t('viz.energyAria', {
    deltaH: formatNumber(facts.deltaH),
    ea: formatNumber(facts.activationEnergy),
    unit,
  })

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
      <title>{label}</title>
      <defs>
        <marker id="energy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ACCENT} />
        </marker>
      </defs>
      <g aria-hidden="true">
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth="1" />
            <text x={pad.left - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill={LABEL}>
              {formatNumber(v, 3)}
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke={AXIS} strokeWidth="1.2" />
        <text
          x={12}
          y={pad.top + plotH / 2}
          fontSize="11"
          fill={LABEL}
          textAnchor="middle"
          transform={`rotate(-90 12 ${pad.top + plotH / 2})`}
        >
          {t('viz.energyAxis', { unit })}
        </text>
        <text x={width - pad.right} y={height - 6} fontSize="11" fill={LABEL} textAnchor="end">
          {t('viz.reactionCoordinate')}
        </text>

        {/* Reactant reference level. */}
        <line
          x1={ends[0]!.right}
          x2={Math.max(eaX, productX) + 6}
          y1={reactantY}
          y2={reactantY}
          stroke={AXIS}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <path d={path} fill="none" stroke={SERIES} strokeWidth="2.4" strokeLinejoin="round" />

        {/* Eₐ and ΔH arrows. */}
        {facts.activationEnergy > 0 && peakIndex !== 0 && (
          <g>
            <line x1={eaX} x2={eaX} y1={reactantY} y2={sy(energies[peakIndex]!) + 3} stroke={ACCENT} strokeWidth="1.4" markerEnd="url(#energy-arrow)" />
            <text x={eaX + 6} y={(reactantY + sy(energies[peakIndex]!)) / 2} fontSize="12" fill={ACCENT}>
              Eₐ
            </text>
          </g>
        )}
        {facts.deltaH !== 0 && (
          <g>
            <line
              x1={productX}
              x2={productX}
              y1={reactantY}
              y2={sy(states[productIndex]!.energy) + (facts.exothermic ? -3 : 3)}
              stroke={ACCENT}
              strokeWidth="1.4"
              markerEnd="url(#energy-arrow)"
            />
            <text x={productX + 6} y={(reactantY + sy(states[productIndex]!.energy)) / 2 + 4} fontSize="12" fill={ACCENT}>
              ΔH
            </text>
          </g>
        )}

        {states.map((state, i) => (
          <text
            key={`${state.label}-${i}`}
            x={cx(i)}
            y={sy(state.energy) + (state.transition ? -10 : 18)}
            textAnchor="middle"
            fontSize="12"
            fill={FOREGROUND}
          >
            {state.label}
          </text>
        ))}
      </g>
    </svg>
  )
}

export function EnergyFacts({ visualization, t }: { visualization: EnergyVisualization; t: T }): JSX.Element {
  const facts = energyProfileFacts(visualization.states)
  const unit = visualization.unit
  return (
    <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="font-medium text-foreground">
        ΔH = {facts.deltaH > 0 ? '+' : ''}
        {formatNumber(facts.deltaH)} {unit}
      </span>
      <span>
        Eₐ = {formatNumber(facts.activationEnergy)} {unit}
      </span>
      <span>{facts.deltaH === 0 ? t('viz.energyThermoneutral') : facts.exothermic ? t('viz.energyExothermic') : t('viz.energyEndothermic')}</span>
    </p>
  )
}

// --- titration ---------------------------------------------------------------

/** The setup and labels of a titration, for v8 and legacy (v7) rows alike. */
function resolveTitration(visualization: TitrationVisualization): {
  setup: TitrationSetup
  analyte: string
  titrant: string
} {
  const setup = asTitrationSetup(visualization.setup)
  const weak = setup.analyte === 'acid' ? Boolean(setup.ka?.length) : setup.kb !== undefined
  const fallbackAnalyte =
    setup.analyte === 'acid' ? (weak ? ((setup.ka?.length ?? 1) > 1 ? `H${setup.ka!.length}A` : 'HA') : 'HCl') : weak ? 'B' : 'NaOH'
  return {
    setup,
    analyte: visualization.analyteLabel ?? visualization.acidLabel ?? fallbackAnalyte,
    titrant: visualization.titrantLabel ?? visualization.baseLabel ?? (setup.analyte === 'acid' ? 'NaOH' : 'HCl'),
  }
}

export function TutorTitrationSvg({
  visualization,
  layout,
  t,
}: {
  visualization: TitrationVisualization
  layout: PlotLayout
  t: T
}): JSX.Element {
  const { setup, titrant } = resolveTitration(visualization)
  const volumes = equivalenceVolumes(setup)
  const curve = titrationCurve(setup)
  const xMax = volumes[volumes.length - 1]! + volumes[0]!
  const { width, height } = layout
  const pad = { ...layout.pad, bottom: layout.pad.bottom + 6 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const sx = (x: number) => pad.left + (x / xMax) * plotW
  const sy = (pH: number) => pad.top + (1 - Math.min(14, Math.max(0, pH)) / 14) * plotH

  const path = curve
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${sx(point.volume).toFixed(2)} ${sy(point.pH).toFixed(2)}`)
    .join(' ')
  const equivalences = volumes.map((volume) => ({ volume, pH: titrationPH(setup, volume) }))
  const buffers = bufferPoints(setup).map((point) => ({ ...point, pH: titrationPH(setup, point.volume) }))
  const xTicks = ticks(0, xMax, niceTickStep(xMax, layout.compact ? 4 : 8))
  const yTicks = [0, 2, 4, 6, 8, 10, 12, 14]
  const label = t('viz.titrationAria', {
    volume: equivalences.map((point) => formatNumber(point.volume, 3)).join(', '),
    pH: equivalences.map((point) => formatNumber(point.pH, 3)).join(', '),
  })
  const many = equivalences.length > 1

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
      <title>{label}</title>
      <g aria-hidden="true">
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth="1" />
            <text x={pad.left - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill={LABEL}>
              {v}
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={sy(0)} y2={sy(0)} stroke={AXIS} strokeWidth="1.2" />
        {xTicks.map((v) => (
          <g key={`x-${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={sy(0)} y2={sy(0) + 4} stroke={AXIS} strokeWidth="1" />
            <text x={sx(v)} y={sy(0) + 17} textAnchor="middle" fontSize="11" fill={LABEL}>
              {formatNumber(v, 3)}
            </text>
          </g>
        ))}
        <text x={width - pad.right} y={height - 4} fontSize="11" fill={LABEL} textAnchor="end">
          {t('viz.titrationAxis', { base: titrant })}
        </text>
        <text x={pad.left + 4} y={pad.top + 12} fontSize="11" fill={LABEL}>
          pH
        </text>

        {equivalences.map((point) => (
          <line key={`eq-${point.volume}`} x1={sx(point.volume)} x2={sx(point.volume)} y1={sy(0)} y2={sy(14)} stroke={ACCENT} strokeWidth="1" strokeDasharray="4 4" />
        ))}
        <path d={path} fill="none" stroke={SERIES} strokeWidth="2.4" strokeLinejoin="round" />
        {equivalences.map((point, i) => (
          <g key={`eqp-${point.volume}`}>
            <circle cx={sx(point.volume)} cy={sy(point.pH)} r="4.5" fill={ACCENT} />
            <text x={sx(point.volume) + 8} y={sy(point.pH) + 4} fontSize="12" fill={ACCENT}>
              {many ? t('viz.titrationEquivalenceN', { n: i + 1 }) : t('viz.titrationEquivalence')}
            </text>
          </g>
        ))}
        {buffers.map((point, i) => (
          <g key={`buf-${point.volume}`}>
            <circle cx={sx(point.volume)} cy={sy(point.pH)} r="4" fill={FOREGROUND} />
            <text x={sx(point.volume) + 8} y={sy(point.pH) + 18} fontSize="12" fill={FOREGROUND}>
              {/* pH ≈ pKₐ only holds where the buffer approximation does (not
                  for a very strong first or a very weak last proton). */}
              {Math.abs(point.pH - point.pKa) <= 0.15
                ? `pH ≈ pKₐ${many ? ('₁₂₃'[i] ?? '') : ''}`
                : t('viz.titrationHalfEquivalence')}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

export function TitrationFacts({ visualization, t }: { visualization: TitrationVisualization; t: T }): JSX.Element {
  const { setup, analyte, titrant } = resolveTitration(visualization)
  const volumes = equivalenceVolumes(setup)
  const buffers = bufferPoints(setup)
  return (
    <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="font-medium text-foreground">
        {t('viz.titrationSetup', {
          acid: analyte,
          acidConcentration: formatNumber(setup.concentration, 4),
          acidVolume: formatNumber(setup.volume, 4),
          base: titrant,
          baseConcentration: formatNumber(setup.titrantConcentration, 4),
        })}
      </span>
      <span>{t('viz.titrationInitialPH', { value: formatNumber(titrationPH(setup, 0), 3) })}</span>
      {volumes.map((volume, i) => (
        <span key={volume} className={i === volumes.length - 1 ? 'font-medium text-foreground' : undefined}>
          {volumes.length > 1
            ? t('viz.titrationEquivalenceAt', {
                n: i + 1,
                volume: formatNumber(volume, 4),
                pH: formatNumber(titrationPH(setup, volume), 3),
              })
            : t('viz.titrationEquivalenceOne', {
                volume: formatNumber(volume, 4),
                pH: formatNumber(titrationPH(setup, volume), 3),
              })}
        </span>
      ))}
      {buffers.map((point, i) => (
        <span key={point.volume}>
          {setup.analyte === 'acid' ? `pKₐ${buffers.length > 1 ? '₁₂₃'[i] : ''}` : 'pKₐ(BH⁺)'} = {formatNumber(point.pKa, 3)}
        </span>
      ))}
    </p>
  )
}
