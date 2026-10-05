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
  }
}

/** Computed facts shown under the card, where a figure has them. */
export function ScienceFigureFacts({ visualization, t }: Omit<ScienceProps, 'layout' | 'language'>): JSX.Element | null {
  if (visualization.type === 'energy_2d') return <EnergyFacts visualization={visualization} t={t} />
  if (visualization.type === 'titration_2d') return <TitrationFacts visualization={visualization} t={t} />
  return null
}
