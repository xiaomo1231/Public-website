import type { TranslationKey } from '@/i18n'
import type { UserColorTheme } from '@/entities/user/types'

/**
 * Color Themes — the *palette* dimension of appearance, separate from the
 * Light / Dark / System *mode* dimension.
 *
 * This file is the single place where the theme colours are defined. The CSS
 * variable mapping lives in `shared/styles/globals.css` (one block per theme);
 * no component is allowed to hardcode a theme colour.
 *
 * `palette` holds the raw source colours exactly as specified. They are used
 * for the picker preview only — the page itself is painted from the semantic
 * tokens in `globals.css`, never from these literals.
 */

export const COLOR_THEME_IDS = [
  'default',
  'pinkAqua',
  'warmOrange',
  'academic',
] as const satisfies readonly UserColorTheme[]

export type ColorThemeId = UserColorTheme

export interface ColorThemeDefinition {
  id: ColorThemeId
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  /**
   * Named source colours for this theme. Shown in the picker preview; not
   * consumed by CSS (see the module comment).
   */
  palette: Readonly<Record<string, string>>
  /** The swatches the picker renders, in display order. */
  preview: readonly string[]
}

/** The original palette. Selecting it leaves every token at its default. */
const DEFAULT_THEME: ColorThemeDefinition = {
  id: 'default',
  labelKey: 'theme.default',
  descriptionKey: 'theme.default.description',
  palette: {
    primary: '#172340',
    secondary: '#F1F5F9',
    accent: '#E2E8F0',
    border: '#CBD5E1',
    muted: '#64748B',
  },
  preview: ['#172340', '#F1F5F9', '#E2E8F0', '#CBD5E1', '#64748B'],
}

const PINK_AQUA: ColorThemeDefinition = {
  id: 'pinkAqua',
  labelKey: 'theme.pinkAqua',
  descriptionKey: 'theme.pinkAqua.description',
  palette: {
    secondary: '#F1B2D1',
    secondarySoft: '#F4C4E0',
    secondarySoftest: '#F7D6EC',
    accentSoft: '#B2E0F0',
    accentLight: '#7CD8E5',
    accent: '#4DB7D2',
    primary: '#2A9BB8',
    primaryStrong: '#1E8F9C',
  },
  preview: ['#F1B2D1', '#F4C4E0', '#7CD8E5', '#4DB7D2', '#1E8F9C'],
}

const WARM_ORANGE: ColorThemeDefinition = {
  id: 'warmOrange',
  labelKey: 'theme.warmOrange',
  descriptionKey: 'theme.warmOrange.description',
  palette: {
    accentSoft: '#F8B78B',
    secondary: '#F09D58',
    accent: '#E6853B',
    warm: '#D9703C',
    primary: '#D15C2C',
    primaryDeep: '#BF4D2E',
    primaryDeeper: '#A4402E',
    primaryStrong: '#8C3332',
    burgundy: '#6F262D',
    /**
     * Preserved verbatim as supplied. NOTE: this is not a valid 3/6/8-digit
     * hex literal, so it is metadata only — it is never emitted into a CSS
     * variable, and the picker renders it as an "unavailable" swatch rather
     * than substituting a guessed colour. Awaiting the correct value.
     */
    deep: '#4C1A2',
  },
  preview: ['#F8B78B', '#F09D58', '#D9703C', '#8C3332', '#4C1A2'],
}

const ACADEMIC: ColorThemeDefinition = {
  id: 'academic',
  labelKey: 'theme.academic',
  descriptionKey: 'theme.academic.description',
  palette: {
    secondary: '#A8D3E6',
    accent: '#F1C841',
    positive: '#B5E28A',
    warmAccent: '#D9703C',
    primary: '#2C7F4D',
    primaryStrong: '#0E4A55',
    neutralWarm: '#D1B3A0',
    accentSoft: '#F5E1A5',
    mutedGreen: '#A1C6B2',
    muted: '#5B7F8E',
  },
  preview: ['#A8D3E6', '#F1C841', '#B5E28A', '#2C7F4D', '#0E4A55'],
}

export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  DEFAULT_THEME,
  PINK_AQUA,
  WARM_ORANGE,
  ACADEMIC,
]

/**
 * The theme a profile without an explicit choice gets. This is the palette the
 * app already shipped with — new themes are opt-in, never forced.
 */
export const DEFAULT_COLOR_THEME: ColorThemeId = 'default'

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && (COLOR_THEME_IDS as readonly string[]).includes(value)
}

/** Resolve a possibly-missing persisted value to a usable theme id. */
export function resolveColorTheme(value: unknown): ColorThemeId {
  return isColorThemeId(value) ? value : DEFAULT_COLOR_THEME
}

/**
 * Is this a syntactically valid CSS hex colour (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)?
 *
 * Used to keep an invalid palette entry out of CSS entirely: the picker shows
 * it as "unavailable" rather than letting the browser silently drop the
 * declaration or inventing a replacement colour.
 */
export function isCssHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}
