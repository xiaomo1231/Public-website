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
    const row = await this.getMigratedRow()
    return {
      id: 'singleton',
      provider: row.provider,
      baseURL: row.baseURL,
      apiKey: await this.decryptApiKey(row),
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
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
    if (patch.temperature !== undefined) {
      const temp = Number(patch.temperature)
      if (Number.isNaN(temp) || temp < 0 || temp > 2) {
        throw new ValidationError(t('errors.temperatureRange'))
      }
      next.temperature = temp
    }
    if (patch.maxTokens !== undefined) {
      const m = Number(patch.maxTokens)
      if (!Number.isInteger(m) || m < 64 || m > 32000) {
        throw new ValidationError(t('errors.maxTokensRange'))
      }
      next.maxTokens = m
    }

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

    const saved = await this.repo.putRow(next)
    logger.info('AI settings updated', { provider: saved.provider, model: saved.model })
    return {
      id: 'singleton',
      provider: saved.provider,
      baseURL: saved.baseURL,
      apiKey: await this.decryptApiKey(saved),
      model: saved.model,
      temperature: saved.temperature,
      maxTokens: saved.maxTokens,
      updatedAt: saved.updatedAt,
    }
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
    if (!row.apiKeyEncrypted) return ''
    try {
      return await decryptString(await getDeviceKey(), row.apiKeyEncrypted)
    } catch (err) {
      // A lost device key makes the ciphertext unreadable. Report it as "not
      // configured" rather than crashing; the user can re-enter the key.
      logger.warn('Could not decrypt stored API key', { error: (err as Error)?.message })
      return ''
    }
  }
}
