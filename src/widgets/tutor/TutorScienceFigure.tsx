import type { ScienceVisualization } from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { UILanguage } from '@/i18n/types'
import type { PlotLayout } from './plotLayout'
import {
  EnergyFacts,
  TitrationFacts,
  TutorEnergySvg,
  TutorMoleculeFigure,
  TutorTitrationSvg,
} from './TutorChemistryFigure'
import { TutorPedigreeSvg, TutorPunnettFigure, TutorTranslationFigure } from './TutorBiologyFigure'
import { TutorChiSquareFigure } from './TutorChiSquareFigure'
import { TutorFormulaFigure, TutorRiemannFigure, TutorTangentFigure, TutorTaylorFigure } from './TutorFormulaFigure'
import { TutorCircuitFigure, TutorForcesFigure, TutorMotionFigure, TutorOpticsFigure } from './TutorPhysicsFigure'
import {
  TutorArrheniusFigure,
  TutorConfidenceFigure,
  TutorEnzymeFigure,
  TutorKineticsFigure,
  TutorPopulationFigure,
  TutorRegressionFigure,
} from './TutorModelFigure'
import { TutorBstFigure, TutorSortingFigure } from './TutorAlgorithmFigure'

interface ScienceProps {
  visualization: ScienceVisualization
  layout: PlotLayout
  t: UseTranslationResult['t']
  language: UILanguage
}

/** The figure itself, drawn inside the shared visualization card. */
export function ScienceFigureBody({ visualization, layout, t, language }: ScienceProps): JSX.Element | null {
  switch (visualization.type) {
    case 'molecule_2d':
      return <TutorMoleculeFigure visualization={visualization} t={t} />
    case 'energy_2d':
      return <TutorEnergySvg visualization={visualization} layout={layout} t={t} />
    case 'titration_2d':
      return <TutorTitrationSvg visualization={visualization} layout={layout} t={t} />
    case 'punnett_2d':
      return <TutorPunnettFigure visualization={visualization} t={t} />
    case 'pedigree_2d':
      return <TutorPedigreeSvg visualization={visualization} layout={layout} t={t} />
    case 'translation_2d':
      return <TutorTranslationFigure visualization={visualization} t={t} language={language} />
    case 'chisquare_test_2d':
      return <TutorChiSquareFigure visualization={visualization} layout={layout} t={t} />
    case 'formula_2d':
      return <TutorFormulaFigure visualization={visualization} layout={layout} t={t} />
    case 'tangent_2d':
      return <TutorTangentFigure visualization={visualization} layout={layout} t={t} />
    case 'riemann_2d':
      return <TutorRiemannFigure visualization={visualization} layout={layout} t={t} />
    case 'taylor_2d':
      return <TutorTaylorFigure visualization={visualization} layout={layout} t={t} />
    case 'forces_2d':
      return <TutorForcesFigure visualization={visualization} layout={layout} t={t} />
    case 'motion_2d':
      return <TutorMotionFigure visualization={visualization} layout={layout} t={t} />
    case 'optics_2d':
      return <TutorOpticsFigure visualization={visualization} layout={layout} t={t} />
    case 'circuit_2d':
      return <TutorCircuitFigure visualization={visualization} t={t} />
    case 'regression_2d':
      return <TutorRegressionFigure visualization={visualization} layout={layout} t={t} />
    case 'confidence_interval_2d':
      return <TutorConfidenceFigure visualization={visualization} layout={layout} t={t} />
    case 'kinetics_2d':
      return <TutorKineticsFigure visualization={visualization} layout={layout} t={t} />
    case 'arrhenius_2d':
      return <TutorArrheniusFigure visualization={visualization} layout={layout} t={t} />
    case 'enzyme_2d':
      return <TutorEnzymeFigure visualization={visualization} layout={layout} t={t} />
    case 'population_2d':
      return <TutorPopulationFigure visualization={visualization} layout={layout} t={t} />
    case 'sorting_2d':
      return <TutorSortingFigure visualization={visualization} layout={layout} t={t} />
    case 'bst_2d':
      return <TutorBstFigure visualization={visualization} layout={layout} t={t} />
  }
}

/** Computed facts shown under the card, where a figure has them. */
export function ScienceFigureFacts({ visualization, t }: Omit<ScienceProps, 'layout' | 'language'>): JSX.Element | null {
  if (visualization.type === 'energy_2d') return <EnergyFacts visualization={visualization} t={t} />
  if (visualization.type === 'titration_2d') return <TitrationFacts visualization={visualization} t={t} />
  return null
}
