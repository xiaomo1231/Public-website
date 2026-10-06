import type { AIService } from './aiService'
import { loadProjectSubject } from './projectSubject'
import { prompts } from '@/infrastructure/ai/prompts'
import type { ReferenceImageQuery } from '@/infrastructure/ai/prompts/reference-image-query/v2'
import {
  downloadImage,
  findPubChemCompound,
  searchCommons,
  type FetchLike,
  type WebImageCandidate,
} from '@/infrastructure/referenceImages/sources'
import { ReferenceImageRepository } from '@/entities/referenceImage/repository'
import type { ReferenceImage } from '@/entities/referenceImage/types'
import type { Subject } from '@/entities/project/types'
import type { AppDatabase } from '@/infrastructure/db/database'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

/**
 * Opt-in web reference images for chemistry and biology topics.
 *
 * The model proposes search terms only. Pictures come from PubChem (compound
 * structures, cross-checked by formula) and Wikimedia Commons (reusable
 * licences only), are optionally checked by a vision model, and are cached
 * locally per topic with their source, licence and author.
 */

export interface ReferenceImageSearchInput {
  projectId: string
  topicId: string
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  lessonContent: string
  signal?: AbortSignal
}

export interface ReferenceImageOptions {
  enabled: boolean
  visionCheck: boolean
}

/** Which sources a subject may use; null when the subject gets no web images. */
export function referenceSourcesFor(subject: Subject | undefined): { allowPubChem: boolean; medical?: boolean } | null {
  if (subject === 'chemistry') return { allowPubChem: true }
  if (subject === 'biology') return { allowPubChem: false }
  // Anatomy and histology are learnt from images; drugs come from PubChem.
  if (subject === 'medicine') return { allowPubChem: true, medical: true }
  return null
}

function toDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export class ReferenceImageService {
  private repo: ReferenceImageRepository
  private db: AppDatabase | undefined
  private ai: AIService | undefined
  private fetchImpl: FetchLike
  private options: ReferenceImageOptions

  constructor(deps: {
    db?: AppDatabase
    ai?: AIService
    fetch?: FetchLike
    options: ReferenceImageOptions
  }) {
    this.db = deps.db
    this.repo = new ReferenceImageRepository(deps.db)
    this.ai = deps.ai
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init))
    this.options = deps.options
  }

  get enabled(): boolean {
    return this.options.enabled
  }

  async list(projectId: string, topicId: string): Promise<ReferenceImage[]> {
    return this.repo.listByTopic(projectId, topicId)
  }

  async getImage(id: string): Promise<Blob | null> {
    return this.repo.getImage(id)
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id)
  }

  /** Whether the project's subject gets web reference images at all. */
  async availableFor(projectId: string): Promise<boolean> {
    return referenceSourcesFor(await loadProjectSubject(projectId, this.db)) !== null
  }

  /**
   * Search, download, (optionally) verify and cache pictures for one topic.
   * Returns every cached picture for the topic afterwards.
   */
  async search(input: ReferenceImageSearchInput): Promise<ReferenceImage[]> {
    if (!this.options.enabled) throw new AppError(t('referenceImages.disabled'), 'WEB_IMAGES_DISABLED')
    if (!this.ai) throw new AppError(t('errors.aiKeyRequired'), 'AI_NOT_CONFIGURED')
    const sources = referenceSourcesFor(await loadProjectSubject(input.projectId, this.db))
    if (!sources) return this.list(input.projectId, input.topicId)

    const { data } = await this.ai.chatJSON<unknown>(
      [
        { role: 'system', content: prompts.referenceImageQuery.buildSystemPrompt(sources) },
        {
          role: 'user',
          content: prompts.referenceImageQuery.buildUserPrompt({
            topicName: input.topicName,
            topicDescription: input.topicDescription,
            language: input.language,
            lessonContent: input.lessonContent,
            allowPubChem: sources.allowPubChem,
            ...(sources.medical ? { medical: true } : {}),
          }),
        },
      ],
      { maxTokens: 512, ...(input.signal ? { signal: input.signal } : {}) },
    )
    const queries = prompts.referenceImageQuery.normalizeReferenceQueries(data, sources)
    const existing = await this.list(input.projectId, input.topicId)
    const seenPages = new Set(existing.map((image) => image.pageUrl))
    let visionAvailable = this.options.visionCheck

    for (const query of queries) {
      try {
        const candidates = await this.candidatesFor(query, input.signal)
        for (const candidate of candidates) {
          if (seenPages.has(candidate.pageUrl)) continue
          const image = await downloadImage(candidate.imageUrl, {
            fetch: this.fetchImpl,
            ...(input.signal ? { signal: input.signal } : {}),
          })
          if (!image) continue

          let relevance: ReferenceImage['relevance'] = 'unverified'
          if (visionAvailable) {
            const verdict = await this.checkRelevance(input.topicName, query, candidate, image, input.signal)
            if (verdict === false) continue
            if (verdict === true) relevance = 'verified'
            // The model could not look at images: stop asking for this search.
            else visionAvailable = false
          }

          const record: ReferenceImage = {
            id: crypto.randomUUID(),
            projectId: input.projectId,
            topicId: input.topicId,
            source: candidate.source,
            query: query.term,
            purpose: query.purpose,
            title: candidate.title,
            pageUrl: candidate.pageUrl,
            license: candidate.license,
            ...(candidate.licenseUrl ? { licenseUrl: candidate.licenseUrl } : {}),
            ...(candidate.author ? { author: candidate.author } : {}),
            relevance,
            mimeType: image.mimeType,
            createdAt: Date.now(),
          }
          await this.repo.save(record, image.bytes)
          seenPages.add(candidate.pageUrl)
          break // one picture per query
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err
        // One failed source must not cost the others.
        logger.warn('Reference image query failed', { source: query.source, error: (err as Error)?.message })
      }
    }
    return this.list(input.projectId, input.topicId)
  }

  private async candidatesFor(query: ReferenceImageQuery, signal?: AbortSignal): Promise<WebImageCandidate[]> {
    if (query.source === 'pubchem') {
      const found = await findPubChemCompound(query.term, {
        fetch: this.fetchImpl,
        ...(query.formula ? { expectedFormula: query.formula } : {}),
        ...(signal ? { signal } : {}),
      })
      return found ? [found] : []
    }
    return searchCommons(query.term, { fetch: this.fetchImpl, limit: 3, ...(signal ? { signal } : {}) })
  }

  /** true / false from the vision model, or null when it cannot judge images. */
  private async checkRelevance(
    topicName: string,
    query: ReferenceImageQuery,
    candidate: WebImageCandidate,
    image: { bytes: ArrayBuffer; mimeType: string },
    signal?: AbortSignal,
  ): Promise<boolean | null> {
    try {
      const { data } = await this.ai!.chatJSON<unknown>(
        [
          { role: 'system', content: prompts.referenceImageCheck.buildSystemPrompt() },
          {
            role: 'user',
            content: prompts.referenceImageCheck.buildUserPrompt({
              topicName,
              purpose: query.purpose,
              title: candidate.title,
            }),
            images: [toDataUrl(image.bytes, image.mimeType)],
          },
        ],
        { maxTokens: 64, ...(signal ? { signal } : {}) },
      )
      return prompts.referenceImageCheck.readRelevance(data)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      logger.warn('Reference image vision check unavailable', { error: (err as Error)?.message })
      return null
    }
  }
}
