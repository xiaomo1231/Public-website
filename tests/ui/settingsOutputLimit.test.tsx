import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from '@/pages/SettingsPage'
import { SettingsService } from '@/services/settingsService'
import { setSettingsServiceForTesting, useSettingsStore } from '@/features/settings/settingsStore'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'
import { setDbForTesting, AppDatabase } from '@/infrastructure/db/database'
import { DEFAULT_AI_SETTINGS } from '@/entities/settings/types'
import {
  clearLearnedOutputLimitsForTesting,
  PROBE_OUTPUT_TOKENS,
} from '@/infrastructure/ai/outputLimit'
import { t } from '@/i18n'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  setSettingsServiceForTesting(new SettingsService(db))
  clearCachedDeviceKey()
  clearLearnedOutputLimitsForTesting()
  useSettingsStore.setState({
    settings: null,
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  })
})

const BASE = 'https://api.minimax.example/v1'

async function seed(extra: Record<string, unknown> = {}): Promise<void> {
  await db.settings.put({
    ...DEFAULT_AI_SETTINGS,
    provider: 'MiniMax',
    baseURL: BASE,
    model: 'MiniMax-M3',
    maxTokensMode: 'model',
    updatedAt: 1,
    ...extra,
  })
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('最大 Token 数 readout in model mode', () => {
  it('says an unknown limit will be detected automatically', async () => {
    await seed()
    renderPage()
    expect(
      await screen.findByText(
        t('settings.sampling.modelMaxProbe', { tokens: PROBE_OUTPUT_TOKENS }),
      ),
    ).toBeInTheDocument()
  })

  it('shows a learned limit with its source 自动探测', async () => {
    await seed({ learnedOutputLimits: { baseURL: BASE, limits: { 'MiniMax-M3': 40_960 } } })
    renderPage()
    expect(
      await screen.findByText(
        t('settings.sampling.modelMaxKnown', {
          tokens: 40_960,
          max: 40_960,
          source: t('settings.sampling.sourceLearned'),
        }),
      ),
    ).toBeInTheDocument()
  })
})

describe('同时进行的 AI 请求数', () => {
  it('shows the stored value, 4 for a row from before the option', async () => {
    await seed()
    renderPage()
    expect(await screen.findByText(t('settings.sampling.concurrency'))).toBeInTheDocument()
    expect(screen.getByTestId('concurrency-value')).toHaveTextContent('4')
    expect(screen.getByText(t('settings.sampling.concurrencyHint'))).toBeInTheDocument()
  })
})
