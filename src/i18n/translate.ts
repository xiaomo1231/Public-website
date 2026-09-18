import { en, type TranslationKey } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { LOCALE_TAGS, type TranslationParams, type UILanguage } from './types'
import { logger } from '@/infrastructure/logger/logger'

type Catalog = Record<string, string>

export const CATALOGS: Record<UILanguage, Catalog> = {
  en,
  'zh-CN': zhCN,
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

const pluralRules = new Map<UILanguage, Intl.PluralRules>()

function pluralCategory(language: UILanguage, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(language)
  if (!rules) {
    rules = new Intl.PluralRules(LOCALE_TAGS[language])
    pluralRules.set(language, rules)
  }
  return rules.select(count)
}

const warned = new Set<string>()

function warnMissing(language: UILanguage, key: string): void {
  const id = `${language}:${key}`
  if (warned.has(id)) return
  warned.add(id)
  logger.warn('Missing translation key', { language, key })
}

/**
 * Resolve a translation key for a language.
 *
 * Order of resolution:
 *   1. `<key>.<pluralCategory>` when a numeric `count` param is supplied
 *   2. `<key>` in the requested language
 *   3. `<key>` in English (fallback)
 *   4. the key itself — never the string "undefined"
 */
export function translate(
  language: UILanguage,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const catalog = CATALOGS[language] ?? CATALOGS.en
  const count = params?.count

  let template: string | undefined
  if (typeof count === 'number') {
    template = catalog[`${key}.${pluralCategory(language, count)}`] ?? catalog[key]
  } else {
    template = catalog[key]
  }

  if (template === undefined && language !== 'en') {
    warnMissing(language, key)
    template = en[key]
  }

  if (template === undefined) {
    warnMissing(language, key)
    return key
  }

  return interpolate(template, params)
}

/** Test helper — clears the de-duplication set for missing-key warnings. */
export function resetMissingKeyWarnings(): void {
  warned.clear()
}
