import { fnv1a } from '@/shared/lib/hash'

/**
 * Fingerprint of the material a slide explanation was built from.
 *
 * It is content-based (the slide's own text, tables and speaker notes), not
 * id-based: re-processing a document with identical content keeps the cached
 * explanation, while an edited slide invalidates it. The prompt version and the
 * teaching language are folded in so a prompt change or a language switch
 * regenerates once.
 *
 * Switching the UI language, the colour theme or the light/dark mode is NOT part
 * of the hash — none of them changes the slide content.
 */
export function computeSlideContentHash(input: {
  material: string
  promptVersion: string
  language: string
  hasImage: boolean
}): string {
  return fnv1a(
    [input.promptVersion, input.language, input.hasImage ? '1' : '0', input.material].join('\n'),
  )
}
