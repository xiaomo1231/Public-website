import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import {
  applyAiVerdict,
  firstPagesText,
  needsAiCheck,
  type MaterialSuggestion,
} from '@/entities/document/materialSuggestion'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { withLightModel, type AIService } from '@/services/aiService'
import {
  createGenerationRun,
  type GenerationControl,
  type GenerationRun,
} from '@/shared/lib/generationControl'

/** Chunks read for the AI check of a close call (the first pages only). */
const CHECK_CHUNKS = 40

/**
 * 资料类型按内容自动判断: 忽略 for a content-based role suggestion and the
 * optional light-model check of a close call. 改 goes through the one
 * role-change path (`DocumentService.changeMaterialType`); nothing here ever
 * changes a role.
 */
export class MaterialTypeService {
  private readonly db: AppDatabase
  private readonly documents: DocumentRepository

  constructor(deps: { db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.documents = new DocumentRepository(this.db)
  }

  /** 忽略: remember the dismissal (it stays until the suggested role changes). */
  async dismiss(documentId: string, now: number = Date.now()): Promise<void> {
    await this.db.transaction('rw', this.db.documents, async () => {
      const document = await this.db.documents.get(documentId)
      const suggestion = document?.suggestedMaterialType
      if (!document || !suggestion) return
      await this.db.documents.put({
        ...document,
        suggestedMaterialType: { ...suggestion, dismissedAt: now },
      })
    })
  }

  /**
   * A close call: ask the light model which of the two candidate roles the
   * first two pages are. One small request (usage `other`); the answer must
   * be a candidate. Stopped or failed checks are recorded as checked so they
   * are not repeated; the suggestion is only written if it did not change
   * meanwhile.
   */
  async checkWithAi(
    documentId: string,
    ai: AIService,
    options: { control?: GenerationControl; now?: () => number } = {},
  ): Promise<MaterialSuggestion | null> {
    const now = options.now ?? Date.now
    const document = await this.documents.get(documentId)
    if (!needsAiCheck(document)) return null
    const original = document.suggestedMaterialType!
    const chunks = await this.db.chunks
      .where('[documentId+order]')
      .between([documentId, -Infinity], [documentId, Infinity])
      .limit(CHECK_CHUNKS)
      .toArray()
    let next: MaterialSuggestion
    try {
      if (options.control && !options.control.shouldContinue()) throw new Error('stopped')
      const { data } = await withLightModel(ai).chatJSON<unknown>(
        [
          { role: 'system', content: prompts.materialTypeCheck.buildSystemPrompt() },
          {
            role: 'user',
            content: prompts.materialTypeCheck.buildUserPrompt({
              fileName: document.name,
              candidates: original.candidates ?? [],
              firstPages: firstPagesText(chunks),
            }),
          },
        ],
        {
          usageKind: 'other',
          reasoning: 'low',
          ...(options.control ? { signal: options.control.signal } : {}),
        },
      )
      next = applyAiVerdict(original, data, now())
    } catch (err) {
      logger.info('Material type check skipped', {
        id: documentId,
        error: (err as { code?: string })?.code ?? (err as Error)?.message,
      })
      next = { ...original, aiCheckedAt: now() }
    }
    await this.db.transaction('rw', this.db.documents, async () => {
      const latest = await this.db.documents.get(documentId)
      if (!latest?.suggestedMaterialType || latest.suggestedMaterialType.at !== original.at) return
      await this.db.documents.put({ ...latest, suggestedMaterialType: next })
    })
    return next
  }
}

/** In-flight AI checks by document (the file list shows them with 停止). */
const checkRuns = new Map<string, GenerationRun>()
const checkListeners = new Set<() => void>()

function notifyChecks(): void {
  for (const listener of [...checkListeners]) listener()
}

/** The running AI check of a document, if any. */
export function materialCheckRun(documentId: string): GenerationRun | undefined {
  return checkRuns.get(documentId)
}

export function subscribeMaterialChecks(listener: () => void): () => void {
  checkListeners.add(listener)
  return () => checkListeners.delete(listener)
}

/**
 * After processing: if the content scores were close and an AI key is
 * configured, run the one small check in the background. Never blocks or
 * fails the upload.
 */
export async function autoCheckMaterialType(
  documentId: string,
  deps: { db?: AppDatabase; ai?: AIService } = {},
): Promise<void> {
  if (checkRuns.has(documentId)) return
  try {
    const service = new MaterialTypeService(deps.db ? { db: deps.db } : {})
    const document = await new DocumentRepository(deps.db ?? getDb()).get(documentId)
    if (!needsAiCheck(document)) return
    let ai = deps.ai
    if (!ai) {
      const [{ SettingsService }, { AIService }] = await Promise.all([
        import('@/services/settingsService'),
        import('@/services/aiService'),
      ])
      const settings = await new SettingsService().get()
      if (!settings.apiKey.trim() || !settings.model.trim()) return
      ai = new AIService({ config: settings, usageKind: 'other' })
    }
    const run = createGenerationRun()
    checkRuns.set(documentId, run)
    notifyChecks()
    try {
      await service.checkWithAi(documentId, ai, { control: run })
    } finally {
      run.finish()
      checkRuns.delete(documentId)
      notifyChecks()
    }
  } catch (err) {
    logger.info('Automatic material type check skipped', {
      documentId,
      error: (err as { code?: string })?.code ?? (err as Error)?.message,
    })
  }
}
