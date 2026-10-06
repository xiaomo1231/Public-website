import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import {
  looksLikeBiochemistryText,
  looksLikeMorphologyText,
  looksLikePharmacokineticsText,
  looksLikePhysiologyText,
} from '@/entities/tutorVisualization/graphable'
import type { TutorVisualization } from '@/entities/tutorVisualization/types'
import type { Subject } from '@/entities/project/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { LessonFigureContext } from '@/features/tutor/lessonFigureContext'
import { ReviewCardService } from '@/services/reviewCardService'

function one(draft: Record<string, unknown>): TutorVisualization | string {
  const result = normalizeVisualizations({ visualizations: [draft] })
  return result.visualizations[0] ?? result.rejected[0]!.reason
}

function draw(draft: Record<string, unknown>) {
  const value = one(draft)
  if (typeof value === 'string') throw new Error(value)
  return render(<TutorVisualizationFigure visualization={value} />)
}

const text = (container: HTMLElement) => (container.textContent ?? '').replace(/−/g, '-')

describe('physiology figures', () => {
  it('computes Nernst and GHK potentials from the lesson concentrations', () => {
    const { container } = draw({
      type: 'membrane_potential_2d',
      ions: [
        { ion: 'K⁺', inside: 140, outside: 4, permeability: 1 },
        { ion: 'Na+', inside: 15, outside: 145, permeability: 0.04 },
        { ion: 'Cl-', inside: 10, outside: 110, permeability: 0.45 },
      ],
    })
    expect(text(container)).toMatch(/-95/)
    expect(text(container)).toMatch(/Vm = -\d+/)
  })

  it('rejects unknown or duplicated ions', () => {
    expect(one({ type: 'membrane_potential_2d', ions: [{ ion: 'Mg2+', inside: 1, outside: 1 }] })).toBe('invalid-ion')
    expect(one({ type: 'membrane_potential_2d', ions: [{ ion: 'K+', inside: 140, outside: 4 }, { ion: 'K⁺', inside: 140, outside: 4 }] })).toBe('duplicate-ion')
  })

  it('derives SV, EF and CO for the pressure–volume loop', () => {
    const { container } = draw({ type: 'cardiac_2d', edv: 120, esv: 50, hr: 75 })
    const content = text(container)
    expect(content).toContain('70')
    expect(content).toMatch(/58(\.3)?\s*%/)
    expect(content).toMatch(/5\.25/)
    expect(one({ type: 'cardiac_2d', edv: 50, esv: 120 })).not.toHaveProperty('type')
  })

  it('adds lung capacities up from the volumes', () => {
    const { container } = draw({ type: 'lung_volumes_2d', tv: 500, irv: 3000, erv: 1100, rv: 1200 })
    const content = text(container)
    for (const value of ['4600', '5800', '2300', '3500']) expect(content).toContain(value)
  })

  it('computes the net filtration pressure and clearance', () => {
    const { container } = draw({
      type: 'renal_2d',
      forces: { pgc: 45, pbs: 10, pigc: 25 },
      substances: [{ name: '菊粉', urine: 30, plasma: 0.25 }],
      urineFlow: 1,
    })
    const content = text(container)
    expect(content).toContain('10')
    expect(content).toContain('120')
    expect(one({ type: 'renal_2d', substances: [{ name: '菊粉', urine: 30, plasma: 0.25 }] })).toBe('missing-urine-flow')
  })

  it('classifies a compensated metabolic acidosis with the textbook formula', () => {
    const { container } = draw({ type: 'acid_base_2d', ph: 7.3, paco2: 30, hco3: 15 })
    const content = text(container)
    expect(content).toMatch(/metabolic acidosis/i)
    expect(content).toMatch(/28\.5.*32\.5/)
    expect(content).not.toMatch(/coexisting/i)
  })

  it('flags a second disorder when compensation falls outside the range', () => {
    const { container } = draw({ type: 'acid_base_2d', ph: 7.15, paco2: 40, hco3: 13.5 })
    expect(text(container)).toMatch(/coexisting respiratory acidosis/i)
  })

  it('shows the dissociation curve at the lesson’s PO₂ values', () => {
    const { container } = draw({ type: 'oxygen_2d', curves: [{ label: 'HbA', p50: 26.8 }], markers: [100, 40] })
    expect(text(container)).toMatch(/PO₂ 100/)
    expect(text(container)).toMatch(/PO₂ 40/)
  })
})

describe('biochemistry and pharmacokinetics figures', () => {
  it('finds the isoelectric point of glycine', () => {
    const { container } = draw({
      type: 'amino_acid_2d',
      name: 'Glycine',
      groups: [{ pka: 2.34, kind: 'acid' }, { pka: 9.6, kind: 'base' }],
    })
    expect(text(container)).toMatch(/5\.97/)
    expect(one({ type: 'amino_acid_2d', name: 'X', groups: [{ pka: 2, kind: 'acid' }, { pka: 4, kind: 'acid' }] })).toBe('invalid-amino-acid')
  })

  it('totals the ATP of glycolysis and switches shuttle', () => {
    const { container } = draw({
      type: 'metabolism_2d',
      pathway: '糖酵解',
      steps: [
        { label: '己糖激酶', atp: -1 },
        { label: '磷酸果糖激酶-1', atp: -1 },
        { label: '3-磷酸甘油醛脱氢酶', nadh: 1, compartment: 'cytosol', times: 2 },
        { label: '磷酸甘油酸激酶', atp: 1, times: 2 },
        { label: '丙酮酸激酶', atp: 1, times: 2 },
      ],
    })
    // 2 net ATP + 2 cytosolic NADH × 2.5 (malate–aspartate) = 7.
    expect(text(container)).toMatch(/Total\s*7 ATP/)
    fireEvent.click(screen.getByRole('button', { name: /Glycerol-3-phosphate/ }))
    // Glycerol-phosphate shuttle: 2 + 2 × 1.5 = 5.
    expect(text(container)).toMatch(/Total\s*5 ATP/)
  })

  it('draws repeated dosing with a teaching-only disclaimer', () => {
    const { container } = draw({ type: 'pharmacokinetics_2d', route: 'iv_bolus', dose: 500, vd: 50, halfLife: 6, doses: 5, interval: 6, mec: 5 })
    expect(text(container)).toMatch(/not dosing advice/i)
    expect(one({ type: 'pharmacokinetics_2d', route: 'oral', dose: 500, vd: 50, halfLife: 6 })).not.toHaveProperty('type')
  })
})

describe('morphology figures', () => {
  it('shows an FDI chart and converts the notation', () => {
    draw({ type: 'dental_chart_2d', dentition: 'permanent', teeth: [{ code: 16, label: '第一恒磨牙' }] })
    expect(screen.getAllByText('16').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Universal/ }))
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })

  it('rejects invalid FDI codes and mixed dentitions', () => {
    expect(one({ type: 'dental_chart_2d', teeth: [{ code: 19 }] })).toBe('invalid-fdi-code')
    expect(one({ type: 'dental_chart_2d', dentition: 'permanent', teeth: [{ code: 16 }, { code: 55 }] })).toBe('dentition-mismatch')
    const primary = one({ type: 'dental_chart_2d', teeth: [{ code: 55 }, { code: 85 }] })
    expect(primary).toMatchObject({ dentition: 'primary' })
  })

  it('places the corticospinal decussation in the medulla, not the cortex', () => {
    const { container } = draw({
      type: 'neural_pathway_2d',
      name: '皮质脊髓侧束',
      kind: 'motor',
      side: 'left',
      neurons: [
        { cellBody: '中央前回', level: 'cortex', tract: '锥体束', decussates: true, crossesAt: 'medulla' },
        { cellBody: '脊髓前角', level: 'spinal_cord' },
      ],
    })
    expect(text(container)).toMatch(/Decussates at the Medulla/)
  })

  it('checks the order of a pathway and where it can cross', () => {
    expect(
      one({ type: 'neural_pathway_2d', name: 'x', kind: 'sensory', neurons: [{ cellBody: 'a', level: 'thalamus' }, { cellBody: 'b', level: 'medulla' }] }),
    ).toBe('pathway-out-of-order')
    expect(
      one({
        type: 'neural_pathway_2d',
        name: 'x',
        kind: 'sensory',
        neurons: [{ cellBody: 'a', level: 'periphery' }, { cellBody: 'b', level: 'medulla', decussates: true, crossesAt: 'spinal_cord' }, { cellBody: 'c', level: 'thalamus' }],
      }),
    ).toBe('pathway-crossing-out-of-range')
    expect(
      one({
        type: 'neural_pathway_2d',
        name: 'x',
        kind: 'sensory',
        neurons: [{ cellBody: 'a', level: 'periphery', decussates: true }, { cellBody: 'b', level: 'medulla', decussates: true }],
      }),
    ).toBe('pathway-multiple-decussations')
  })

  it('limits timeline lanes and table shapes', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((group, i) => ({ label: group, start: i, group }))
    expect(one({ type: 'timeline_2d', unit: 'week', events })).toBe('too-many-timeline-groups')
    expect(one({ type: 'anatomy_table_2d', columns: ['起点', '止点'], rows: [{ name: '三角肌', cells: ['锁骨外侧'] }] })).toBe('invalid-anatomy-row')
  })

  it('turns an anatomy table into flashcards inside a lesson', async () => {
    const addFromTable = vi.spyOn(ReviewCardService.prototype, 'addFromTable').mockResolvedValue(2)
    const value = one({
      type: 'anatomy_table_2d',
      columns: ['神经支配', '作用'],
      rows: [{ name: '三角肌', cells: ['腋神经', '肩关节外展'] }],
    })
    if (typeof value === 'string') throw new Error(value)
    const { rerender } = render(<TutorVisualizationFigure visualization={value} />)
    expect(screen.queryByRole('button', { name: /flashcards/i })).toBeNull()
    rerender(
      <LessonFigureContext.Provider value={{ projectId: 'p1', topicId: 't1' }}>
        <TutorVisualizationFigure visualization={value} />
      </LessonFigureContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add 2 flashcards/ }))
    await vi.waitFor(() => expect(addFromTable).toHaveBeenCalled())
    expect(addFromTable.mock.calls[0]![0]).toBe('p1')
    expect(addFromTable.mock.calls[0]![1]).toMatchObject({ topicId: 't1', columns: ['神经支配', '作用'] })
    addFromTable.mockRestore()
  })
})

describe('medical prompt families and gates', () => {
  const prompt = (subject: Subject) => prompts.visualizationGenerator.buildSystemPrompt({ subject })

  it('sends the medical figures to medicine and the shared ones to biology / chemistry', () => {
    const medicine = prompt('medicine')
    for (const type of ['acid_base_2d', 'cardiac_2d', 'pharmacokinetics_2d', 'dental_chart_2d', 'neural_pathway_2d', 'punnett_2d', 'enzyme_2d', 'chisquare_test_2d']) {
      expect(medicine).toContain(type)
    }
    expect(medicine).not.toContain('optics_2d')
    expect(prompt('biology')).toContain('oxygen_2d')
    expect(prompt('biology')).not.toContain('dental_chart_2d')
    expect(prompt('chemistry')).toContain('amino_acid_2d')
    expect(prompt('chemistry')).not.toContain('cardiac_2d')
    expect(prompt('physics')).not.toContain('metabolism_2d')
  })

  it('recognises medical lessons worth a figure', () => {
    expect(looksLikePhysiologyText('血气分析：pH 7.30，PaCO₂ 30 mmHg，判断酸碱平衡紊乱')).toBe(true)
    expect(looksLikePhysiologyText('心动周期中左心室压力–容积环')).toBe(true)
    expect(looksLikeBiochemistryText('计算甘氨酸的等电点')).toBe(true)
    expect(looksLikeBiochemistryText('1 分子葡萄糖经糖酵解净生成 2 分子 ATP')).toBe(true)
    expect(looksLikePharmacokineticsText('静脉注射后血药浓度按一级动力学消除')).toBe(true)
    expect(looksLikeMorphologyText('皮质脊髓束在延髓锥体交叉')).toBe(true)
    expect(looksLikeMorphologyText('第一恒磨牙约 6 岁萌出，FDI 记为 16')).toBe(true)
    expect(looksLikePhysiologyText('细胞膜的流动镶嵌模型')).toBe(false)
  })
})
