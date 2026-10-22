import { AIService } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import {
  HandwritingRecognitionService,
  LocalModelRecognizer,
  VisionLlmRecognizer,
} from './recognition'

/**
 * The recognition service for this device: the configured AI (when a key is
 * set) reads images online; no on-device engine is installed (see
 * docs/handwriting-recognition.md), so offline the student types.
 */
export async function buildHandwritingRecognitionService(): Promise<HandwritingRecognitionService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'grading' })
    : null
  return new HandwritingRecognitionService({
    vision: new VisionLlmRecognizer(ai, { model: settings.model }),
    local: new LocalModelRecognizer(null),
  })
}
