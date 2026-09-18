import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'
import { SettingsService } from '@/services/settingsService'
import { PROVIDER_PRESETS } from '@/entities/settings/types'

describe('SettingsService', () => {
  it('returns default settings on first read', async () => {
    const svc = new SettingsService()
    const settings = await svc.get()
    expect(settings.provider).toBe('openai')
    expect(settings.baseURL).toContain('api.openai.com')
    expect(settings.model).toBe('gpt-4o-mini')
    expect(settings.temperature).toBe(0.7)
    expect(settings.maxTokens).toBe(2048)
  })

  it('updates individual fields', async () => {
    const svc = new SettingsService()
    const updated = await svc.update({ apiKey: 'sk-test', model: 'gpt-4o' })
    expect(updated.apiKey).toBe('sk-test')
    expect(updated.model).toBe('gpt-4o')
  })

  it('validates temperature range', async () => {
    const svc = new SettingsService()
    await expect(svc.update({ temperature: 3 })).rejects.toThrow(/Temperature/i)
  })

  it('validates baseURL format', async () => {
    const svc = new SettingsService()
    await expect(svc.update({ baseURL: 'not-a-url' })).rejects.toThrow(/http/i)
  })

  it('validates maxTokens range', async () => {
    const svc = new SettingsService()
    await expect(svc.update({ maxTokens: 32 })).rejects.toThrow(/Max tokens/i)
  })

  it('applyProviderPreset adopts defaults for fresh user', async () => {
    const svc = new SettingsService()
    const next = await svc.applyProviderPreset('deepseek')
    expect(next.provider).toBe('deepseek')
    expect(next.baseURL).toBe(PROVIDER_PRESETS.find((p) => p.id === 'deepseek')!.baseURL)
    expect(next.model).toBe('deepseek-chat')
  })

  it('preserves custom baseURL when switching provider', async () => {
    const svc = new SettingsService()
    await svc.update({ baseURL: 'https://my-proxy.example.com/v1' })
    const next = await svc.applyProviderPreset('qwen')
    expect(next.provider).toBe('qwen')
    expect(next.baseURL).toBe('https://my-proxy.example.com/v1')
  })
})