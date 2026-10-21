import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { translate } from '@/i18n/translate'
import { formatNumber } from '@/i18n'
import { FigureStrip } from '@/widgets/dashboard/Figures'

describe('count strings', () => {
  it('uses singular English forms for one', () => {
    expect(translate('en', 'vocab.wordCount', { count: 1, n: '1' })).toBe('1 word')
    expect(translate('en', 'vocab.wordCount', { count: 14912, n: '14,912' })).toBe('14,912 words')
    expect(
      translate('en', 'projectDetail.fig.pendingSub', { count: 1, mistakes: 1, homework: 1 }),
    ).toBe('1 mistake · 1 homework open')
    expect(
      translate('en', 'projectDetail.fig.pendingSub', { count: 3, mistakes: 3, homework: 0 }),
    ).toBe('3 mistakes · 0 homework open')
  })

  it('keeps the Chinese strings unchanged', () => {
    expect(translate('zh-CN', 'vocab.wordCount', { count: 1, n: '1' })).toBe('1 个词')
  })
})

describe('figure values', () => {
  it('groups thousands in numeric readouts', () => {
    const { container } = render(
      <FigureStrip label="figures" items={[{ label: 'Words', value: 14912 }]} />,
    )
    expect(container.querySelector('dd')?.textContent).toContain(formatNumber(14912))
    expect(formatNumber(14912, 'en')).toBe('14,912')
  })
})
