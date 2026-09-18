import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'

const enEntries = Object.entries(en)
const enKeys = Object.keys(en)

function placeholders(value: string): string[] {
  return (value.match(/\{(\w+)\}/g) ?? []).sort()
}

describe('translation catalogs', () => {
  it('English is non-empty', () => {
    expect(enKeys.length).toBeGreaterThan(400)
  })

  it('zh-CN defines exactly the same keys as English', () => {
    const zhKeys = Object.keys(zhCN)
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k))
    const extraInZh = zhKeys.filter((k) => !enKeys.includes(k))
    expect(missingInZh).toEqual([])
    expect(extraInZh).toEqual([])
  })

  it('no English value is undefined, empty or the literal "undefined"', () => {
    for (const [key, value] of enEntries) {
      expect(typeof value, key).toBe('string')
      expect(value.trim().length, key).toBeGreaterThan(0)
      expect(value, key).not.toBe('undefined')
    }
  })

  it('no Chinese value is undefined, empty or the literal "undefined"', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(typeof value, key).toBe('string')
      expect(value.trim().length, key).toBeGreaterThan(0)
      expect(value, key).not.toBe('undefined')
    }
  })

  it('every interpolation placeholder in English also appears in Chinese', () => {
    const mismatched = enKeys.filter((key) => {
      const a = placeholders(en[key as keyof typeof en])
      const b = placeholders(zhCN[key as keyof typeof zhCN])
      return JSON.stringify(a) !== JSON.stringify(b)
    })
    expect(mismatched).toEqual([])
  })

  it('uses natural Simplified Chinese, not raw English, for navigation labels', () => {
    expect(zhCN['nav.dashboard']).toBe('仪表盘')
    expect(zhCN['nav.projects']).toBe('项目')
    expect(zhCN['nav.settings']).toBe('设置')
    expect(zhCN['tutor.title']).toBe('AI 导师')
    expect(zhCN['mistakes.title']).toBe('错题本')
    expect(zhCN['settings.language.label']).toBe('界面语言')
  })

  it('does not translate technical identifiers', () => {
    expect(zhCN['docType.pdf']).toBe('PDF')
    expect(zhCN['docType.word']).toBe('Word')
    expect(zhCN['provider.custom']).toContain('OpenAI')
    expect(zhCN['language.en']).toBe('English')
    expect(zhCN['language.zhCN']).toBe('简体中文')
  })
})
