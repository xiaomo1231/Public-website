import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import {
  looksLikeBiologyFigureText,
  looksLikeChemistryFigureText,
} from '@/entities/tutorVisualization/graphable'
import { pedigreeLayout, romanNumeral } from '@/entities/tutorVisualization/biology'
import type { TutorVisualization } from '@/entities/tutorVisualization/types'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION } from '@/entities/tutorVisualization/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'

function one(draft: Record<string, unknown>): TutorVisualization | string {
  const result = normalizeVisualizations({ visualizations: [draft] })
  return result.visualizations[0] ?? result.rejected[0]!.reason
}

describe('chemistry normalisation', () => {
  it('keeps a molecule whose structure matches the stated formula', () => {
    const value = one({ type: 'molecule_2d', molecules: [{ smiles: 'CCO', formula: 'C2H5OH', name: 'ethanol' }] })
    expect(value).toMatchObject({
      type: 'molecule_2d',
      schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
      molecules: [{ smiles: 'CCO', formula: 'C2H6O', name: 'ethanol' }],
    })
  })

  it('rejects a structure that is not the molecule the lesson names', () => {
    expect(one({ type: 'molecule_2d', molecules: [{ smiles: 'CC(=O)O', formula: 'C2H6O' }] })).toBe('molecule-formula-mismatch')
    expect(one({ type: 'molecule_2d', molecules: [{ smiles: 'CCO' }] })).toBe('missing-molecule-data')
    expect(one({ type: 'molecule_2d', molecules: [{ smiles: '<svg>', formula: 'C' }] })).toBe('invalid-smiles')
  })

  it('validates an energy profile', () => {
    const states = [
      { label: 'A + B', energy: 0 },
      { label: 'TS', energy: 85, transition: true },
      { label: 'C', energy: -40 },
    ]
    expect(one({ type: 'energy_2d', states })).toMatchObject({ type: 'energy_2d', unit: 'kJ/mol' })
    expect(one({ type: 'energy_2d', states: [{ ...states[0], transition: true }, states[2]] })).toBe('energy-endpoint-transition')
    expect(one({ type: 'energy_2d', states: [states[0], { ...states[1], energy: -100 }, states[2]] })).toBe('energy-transition-not-peak')
  })

  it('validates a titration set-up', () => {
    expect(
      one({ type: 'titration_2d', acidConcentration: 0.1, acidVolume: 25, baseConcentration: 0.1, ka: 1.8e-5 }),
    ).toMatchObject({ setup: { acidConcentration: 0.1, acidVolume: 25, baseConcentration: 0.1, ka: 1.8e-5 } })
    expect(one({ type: 'titration_2d', acidConcentration: 0, acidVolume: 25, baseConcentration: 0.1 })).toBe('invalid-titration-setup')
    expect(one({ type: 'titration_2d', acidConcentration: 0.1, acidVolume: 25, baseConcentration: 0.1, ka: -1 })).toBe('invalid-titration-ka')
  })
})

describe('biology normalisation', () => {
  it('canonicalises genotypes and keeps matching trait names', () => {
    expect(
      one({
        type: 'punnett_2d',
        mother: 'aA',
        father: 'Aa',
        traits: [{ gene: 'A', dominant: 'Tall', recessive: 'Short' }, { gene: 'z', dominant: 'x', recessive: 'y' }],
      }),
    ).toMatchObject({ mother: 'Aa', father: 'Aa', dominance: 'complete', traits: [{ gene: 'a', dominant: 'Tall', recessive: 'Short' }] })
    expect(one({ type: 'punnett_2d', mother: 'Aa', father: 'Bb' })).toBe('genotype-genes-differ')
    expect(one({ type: 'punnett_2d', mother: 'Ab', father: 'Aa' })).toBe('invalid-genotype')
  })

  it('validates a pedigree', () => {
    const members = [
      { id: 'f', sex: 'male', affected: false },
      { id: 'm', sex: 'female', affected: false, carrier: true },
      { id: 'c', sex: 'male', affected: true, father: 'f', mother: 'm' },
    ]
    expect(one({ type: 'pedigree_2d', members })).toMatchObject({ type: 'pedigree_2d' })
    expect(one({ type: 'pedigree_2d', members: [members[0], { ...members[2], father: 'm' }] })).toBe('invalid-pedigree-structure')
    expect(one({ type: 'pedigree_2d', members: members.slice(0, 2) })).toBe('pedigree-without-children')
  })

  it('validates a DNA strand', () => {
    expect(one({ type: 'translation_2d', dna: 'atg ttt gga taa', strand: 'coding' })).toMatchObject({ dna: 'ATGTTTGGATAA', strand: 'coding' })
    expect(one({ type: 'translation_2d', dna: 'AUGUUU' })).toBe('invalid-dna')
  })
})

describe('pedigree layout', () => {
  it('puts partners side by side and children under their parents', () => {
    const layout = pedigreeLayout([
      { id: 'gf', sex: 'male', affected: false },
      { id: 'gm', sex: 'female', affected: true },
      { id: 'son', sex: 'male', affected: false, father: 'gf', mother: 'gm' },
      { id: 'wife', sex: 'female', affected: false },
      { id: 'kid', sex: 'female', affected: true, father: 'son', mother: 'wife' },
    ])!
    expect(layout.rows).toEqual([['gf', 'gm'], ['son', 'wife'], ['kid']])
    expect(layout.couples).toHaveLength(2)
    expect(romanNumeral(4)).toBe('IV')
  })
})

describe('science lessons reach the visualization step', () => {
  it('recognises chemistry and biology figure topics', () => {
    expect(looksLikeChemistryFigureText('该反应的活化能为 85 kJ/mol')).toBe(true)
    expect(looksLikeChemistryFigureText('用 NaOH 滴定醋酸')).toBe(true)
    expect(looksLikeBiologyFigureText('亲本基因型为 Aa × Aa')).toBe(true)
    expect(looksLikeBiologyFigureText('The coding strand reads ATGGCCTTTAAA.')).toBe(true)
    expect(looksLikeChemistryFigureText('A group homomorphism preserves the operation.')).toBe(false)
    expect(looksLikeBiologyFigureText('A group homomorphism preserves the operation.')).toBe(false)
  })

  it('offers science figures only to matching subjects', () => {
    const chemistry = prompts.visualizationGenerator.buildSystemPrompt({ subject: 'chemistry' })
    const biology = prompts.visualizationGenerator.buildSystemPrompt({ subject: 'biology' })
    const calculus = prompts.visualizationGenerator.buildSystemPrompt({ subject: 'calculus' })
    expect(chemistry).toContain('molecule_2d')
    expect(chemistry).not.toContain('punnett_2d')
    expect(biology).toContain('pedigree_2d')
    expect(biology).not.toContain('titration_2d')
    expect(calculus).not.toContain('molecule_2d')
    expect(calculus).not.toContain('punnett_2d')
    expect(calculus).toContain('distribution_2d')
  })

  it('adds the lesson guidance only to lessons', () => {
    const lesson = prompts.subjectProfile.withSubject('SYSTEM', 'biology', { forLesson: true })
    const other = prompts.subjectProfile.withSubject('SYSTEM', 'biology')
    expect(lesson).toContain('In this lesson:')
    expect(other).not.toContain('In this lesson:')
  })
})

describe('science figures', () => {
  const base = { schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION, placement: { scope: 'lesson' as const } }

  it('renders an energy profile with computed ΔH and Eₐ', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'e',
          type: 'energy_2d',
          unit: 'kJ/mol',
          states: [
            { label: 'R', energy: 0 },
            { label: 'TS', energy: 120, transition: true },
            { label: 'P', energy: -80 },
          ],
        }}
      />,
    )
    expect(screen.getByRole('img', { name: /ΔH = -80 kJ\/mol/ })).toBeInTheDocument()
    expect(screen.getByText('Exothermic')).toBeInTheDocument()
  })

  it('renders a titration with its equivalence point', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 't',
          type: 'titration_2d',
          setup: { acidConcentration: 0.1, acidVolume: 25, baseConcentration: 0.1 },
        }}
      />,
    )
    expect(screen.getByText('Equivalence volume 25 mL')).toBeInTheDocument()
    expect(screen.getByText('pH at equivalence 7')).toBeInTheDocument()
  })

  it('renders a Punnett square with its ratios', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'p',
          type: 'punnett_2d',
          mother: 'Aa',
          father: 'Aa',
          dominance: 'complete',
          traits: [{ gene: 'a', dominant: 'Tall', recessive: 'Short' }],
        }}
      />,
    )
    expect(screen.getByRole('table', { name: /Aa × Aa/ })).toBeInTheDocument()
    expect(screen.getByText('Phenotype ratio 3 : 1')).toBeInTheDocument()
    expect(screen.getByText('Tall')).toBeInTheDocument()
  })

  it('renders a pedigree and the codon chart', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'g',
          type: 'pedigree_2d',
          members: [
            { id: 'f', sex: 'male', affected: false },
            { id: 'm', sex: 'female', affected: false },
            { id: 'c', sex: 'female', affected: true, father: 'f', mother: 'm' },
          ],
        }}
      />,
    )
    expect(screen.getByRole('img', { name: /3 family members, 1 affected/ })).toBeInTheDocument()

    render(
      <TutorVisualizationFigure
        visualization={{ ...base, id: 'd', type: 'translation_2d', dna: 'ATGTTTTAA', strand: 'coding' }}
      />,
    )
    expect(screen.getByText('Met–Phe')).toBeInTheDocument()
  })

  it('renders a molecule caption with its formula', () => {
    render(
      <TutorVisualizationFigure
        visualization={{ ...base, id: 'm', type: 'molecule_2d', molecules: [{ smiles: 'CCO', formula: 'C2H6O', name: 'ethanol' }] }}
      />,
    )
    expect(screen.getByText('ethanol')).toBeInTheDocument()
  })
})
