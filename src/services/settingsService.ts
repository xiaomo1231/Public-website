import { SettingsRepository } from '@/entities/settings/repository'
import {
  PROVIDER_PRESETS,
  type AISettings,
  type AISettingsRow,
  type UpdateAISettingsInput,
} from '@/entities/settings/types'
import { decryptString, encryptString } from '@/infrastructure/crypto/crypto'
import { getDeviceKey } from '@/infrastructure/crypto/deviceKey'
import { logger } from '@/infrastructure/logger/logger'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { normalizePrices } from '@/entities/aiUsage/types'
import { MANUAL_MAX_TOKENS_MAX, MANUAL_MAX_TOKENS_MIN } from '@/infrastructure/ai/outputLimit'
import { t } from '@/i18n'

/**
 * Owns AI settings: validation, encryption at rest, and legacy migration.
 *
 * Reads always return a decrypted `AISettings`; writes always persist an
 * `AISettingsRow` with the key encrypted. The plaintext key never reaches
 * IndexedDB.
 */
export class SettingsService {
  private repo: SettingsRepository

  constructor(db?: ConstructorParameters<typeof SettingsRepository>[0]) {
    this.repo = new SettingsRepository(db)
  }

  /** Read settings, migrating a legacy plaintext key if one is present. */
  async get(): Promise<AISettings> {
    return this.toSettings(await this.getMigratedRow())
  }

  private async toSettings(row: AISettingsRow): Promise<AISettings> {
    return {
      id: 'singleton',
      provider: row.provider,
      baseURL: row.baseURL,
      apiKey: await this.decryptApiKey(row),
      model: row.model,
      lightModel: row.lightModel ?? '',
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      // Rows from before the option keep their number.
      maxTokensMode: row.maxTokensMode ?? 'manual',
      // Limits read for another base URL describe other models: ignored.
      modelOutputLimits:
        row.modelOutputLimits && row.modelOutputLimits.baseURL === row.baseURL
          ? { ...row.modelOutputLimits.limits }
          : {},
      webImagesEnabled: row.webImagesEnabled === true,
      webImagesVisionCheck: row.webImagesVisionCheck === true,
      adminApiKey: await this.decryptSecret(row.adminApiKeyEncrypted),
      usagePrices: normalizePrices(row.usagePrices),
      updatedAt: row.updatedAt,
    }
  }

  async update(patch: UpdateAISettingsInput): Promise<AISettings> {
    const current = await this.getMigratedRow()
    const next: AISettingsRow = { ...current, updatedAt: Date.now() }

    if (patch.provider !== undefined) next.provider = patch.provider
    if (patch.baseURL !== undefined) {
      const url = patch.baseURL.trim()
      if (url && !/^https?:\/\//i.test(url)) {
        throw new ValidationError(t('errors.baseUrlInvalid'))
      }
      next.baseURL = url
    }
    if (patch.model !== undefined) next.model = patch.model.trim()
    if (patch.lightModel !== undefined) {
      const light = patch.lightModel.trim()
      if (light) next.lightModel = light
      else delete next.lightModel
    }
    if (patch.temperature !== undefined) {
      const temp = Number(patch.temperature)
      if (Number.isNaN(temp) || temp < 0 || temp > 2) {
        throw new ValidationError(t('errors.temperatureRange'))
      }
      next.temperature = temp
    }
    if (patch.maxTokens !== undefined) {
      const m = Number(patch.maxTokens)
      if (!Number.isInteger(m) || m < MANUAL_MAX_TOKENS_MIN || m > MANUAL_MAX_TOKENS_MAX) {
        throw new ValidationError(t('errors.maxTokensRange'))
      }
      next.maxTokens = m
    }
    if (patch.maxTokensMode !== undefined) {
      next.maxTokensMode = patch.maxTokensMode === 'model' ? 'model' : 'manual'
    }

    if (patch.webImagesEnabled !== undefined)
      next.webImagesEnabled = patch.webImagesEnabled === true
    if (patch.webImagesVisionCheck !== undefined)
      next.webImagesVisionCheck = patch.webImagesVisionCheck === true

    if (patch.apiKey !== undefined) {
      const trimmed = patch.apiKey.trim()
      if (trimmed) {
        next.apiKeyEncrypted = await encryptString(await getDeviceKey(), trimmed)
      } else {
        delete next.apiKeyEncrypted
      }
      // Plaintext must never survive a write.
      delete next.apiKey
    }

    if (patch.adminApiKey !== undefined) {
      const trimmed = patch.adminApiKey.trim()
      if (trimmed) {
        next.adminApiKeyEncrypted = await encryptString(await getDeviceKey(), trimmed)
      } else {
        delete next.adminApiKeyEncrypted
      }
    }
    if (patch.usagePrices !== undefined) {
      const prices = normalizePrices(patch.usagePrices)
      if (prices) next.usagePrices = prices
      else delete next.usagePrices
    }

    const saved = await this.repo.putRow(next)
    logger.info('AI settings updated', { provider: saved.provider, model: saved.model })
    return this.toSettings(saved)
  }

  /**
   * Remember the output limits a `/models` call returned for `baseURL`
   * (replacing any earlier list). Only positive integers are kept; an empty
   * list clears what was stored for that base URL.
   */
  async rememberModelOutputLimits(
    baseURL: string,
    limits: Record<string, number>,
  ): Promise<AISettings> {
    const current = await this.getMigratedRow()
    const clean: Record<string, number> = {}
    for (const [model, value] of Object.entries(limits)) {
      if (Number.isFinite(value) && value > 0) clean[model] = Math.floor(value)
    }
    const next: AISettingsRow = { ...current }
    if (Object.keys(clean).length > 0) {
      next.modelOutputLimits = { baseURL: baseURL.trim(), limits: clean }
    } else if (current.modelOutputLimits?.baseURL === baseURL.trim()) {
      delete next.modelOutputLimits
    } else {
      return this.toSettings(current)
    }
    return this.toSettings(await this.repo.putRow(next))
  }

  /**
   * When the user picks a provider preset, copy its default baseURL + model
   * only if the current values still match the previous preset's defaults.
   */
  async applyProviderPreset(providerId: AISettings['provider']): Promise<AISettings> {
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)
    if (!preset) return this.update({ provider: providerId })

    const current = await this.getMigratedRow()
    const currentPreset = PROVIDER_PRESETS.find((p) => p.id === current.provider)
    const isUsingCurrentPresetDefaults =
      Boolean(currentPreset) && currentPreset!.baseURL === current.baseURL

    const patch: UpdateAISettingsInput = { provider: providerId }
    if (isUsingCurrentPresetDefaults) {
      patch.baseURL = preset.baseURL
      patch.model = preset.defaultModel || current.model
    }
    const saved = await this.update(patch)
    logger.info('Provider preset applied', { provider: providerId })
    return saved
  }

  async reset(): Promise<void> {
    await this.repo.reset()
  }

  /**
   * Ensure the stored row has no plaintext key.
   *
   * A pre-encryption install has `apiKey` populated. We encrypt it once,
   * store the ciphertext, and remove the plaintext — so an existing user
   * keeps their configuration and never sees it disappear.
   */
  private async getMigratedRow(): Promise<AISettingsRow> {
    const row = await this.repo.getRow()
    const legacy = row.apiKey?.trim()
    if (!legacy) return row

    if (row.apiKeyEncrypted) {
      // Already encrypted; just drop the stale plaintext copy.
      const cleaned: AISettingsRow = { ...row }
      delete cleaned.apiKey
      logger.warn('Removed stale plaintext API key from settings')
      return this.repo.putRow(cleaned)
    }

    try {
      const encrypted = await encryptString(await getDeviceKey(), legacy)
      const migrated: AISettingsRow = { ...row, apiKeyEncrypted: encrypted, updatedAt: Date.now() }
      delete migrated.apiKey
      logger.info('Migrated legacy plaintext API key to encrypted storage')
      return this.repo.putRow(migrated)
    } catch (err) {
      // Never fall back to leaving the plaintext behind silently.
      logger.error('API key migration failed', undefined, err)
      throw err
    }
  }

  private async decryptApiKey(row: AISettingsRow): Promise<string> {
    return this.decryptSecret(row.apiKeyEncrypted)
  }

  private async decryptSecret(payload: string | undefined): Promise<string> {
    if (!payload) return ''
    try {
      return await decryptString(await getDeviceKey(), payload)
    } catch (err) {
      // A lost device key makes the ciphertext unreadable. Report it as "not
      // configured" rather than crashing; the user can re-enter the key.
      logger.warn('Could not decrypt stored API key', { error: (err as Error)?.message })
      return ''
    }
  }
}
