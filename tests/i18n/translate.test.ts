import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGS, resetMissingKeyWarnings, translate } from '@/i18n/translate'
import { en, type TranslationKey } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'

describe('translate', () => {
  afterEach(() => {
    resetMissingKeyWarnings()
  })

  it('resolves a key in the requested language', () => {
    expect(translate('en', 'nav.dashboard')).toBe('Dashboard')
    expect(translate('zh-CN', 'nav.dashboard')).toBe('仪表盘')
  })

  it('interpolates named parameters', () => {
    expect(translate('en', 'projects.deleteBody', { name: 'Physics 101' })).toContain(
      'Physics 101',
    )
    expect(translate('zh-CN', 'projects.deleteBody', { name: 'Physics 101' })).toContain(
      'Physics 101',
    )
    expect(translate('en', 'projects.deleteBody', { name: 'Physics 101' })).not.toContain('{name}')
  })

  it('interpolates multiple parameters', () => {
    const out = translate('en', 'settings.connectionOkBody', { model: 'gpt-4o-mini', latency: 42 })
    expect(out).toContain('gpt-4o-mini')
    expect(out).toContain('42')
  })

  it('leaves unknown placeholders untouched rather than printing undefined', () => {
    const out = translate('en', 'projects.deleteBody', {})
    expect(out).not.toContain('undefined')
  })

  it('selects the singular variant for count === 1 in English', () => {
    const one = translate('en', 'documents.count', { count: 1, shown: 1, total: 1 })
    const many = translate('en', 'documents.count', { count: 2, shown: 2, total: 2 })
    expect(one).toBe('1 of 1 item')
    expect(many).toBe('2 of 2 items')
  })

  it('uses a single plural form for Chinese', () => {
    const one = translate('zh-CN', 'documents.count', { count: 1, shown: 1, total: 1 })
    const many = translate('zh-CN', 'documents.count', { count: 2, shown: 2, total: 2 })
    expect(one).toBe('共 1 项，显示 1 项')
    expect(many).toBe('共 2 项，显示 2 项')
  })

  it('falls back to English when a Chinese key is missing at runtime', () => {
    const key: TranslationKey = 'common.save'
    const original = CATALOGS['zh-CN'][key]
    delete CATALOGS['zh-CN'][key]
    try {
      expect(translate('zh-CN', key)).toBe(en[key])
    } finally {
      CATALOGS['zh-CN'][key] = original
    }
  })

  it('returns the key itself — never "undefined" — for an unknown key', () => {
    const missing = 'this.key.does.not.exist' as TranslationKey
    expect(translate('en', missing)).toBe(missing)
    expect(translate('zh-CN', missing)).toBe(missing)
    expect(translate('zh-CN', missing)).not.toBe('undefined')
  })

  it('produces no undefined for any key in either language', () => {
    for (const key of Object.keys(en) as TranslationKey[]) {
      for (const lang of ['en', 'zh-CN'] as const) {
        const out = translate(lang, key)
        expect(out, `${lang}:${key}`).not.toBe('undefined')
        expect(out.length, `${lang}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('Chinese catalog is fully reachable through translate()', () => {
    for (const key of Object.keys(zhCN) as TranslationKey[]) {
      expect(translate('zh-CN', key)).toBe(zhCN[key])
    }
  })
})
