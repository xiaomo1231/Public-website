import { describe, expect, it } from 'vitest'
import { chunkLowConfidence, findProofreadRisks } from '@/entities/homework/proofread'
import { needsVisualProofread } from '@/entities/chunk/layoutWarnings'
import { normalizeIllumination } from '@/infrastructure/files/ocrPreprocess'

describe('proofreading pages read from a picture', () => {
  it('treats OCR chunks as low confidence', () => {
    expect(chunkLowConfidence({ contentType: 'ocr', text: 'x' })).toBe(true)
    expect(chunkLowConfidence({ contentType: 'paragraph', layoutWarnings: ['ocr'] })).toBe(true)
    expect(chunkLowConfidence({ contentType: 'paragraph' })).toBe(false)
    expect(needsVisualProofread({ layoutWarnings: ['ocr'] })).toBe(true)
  })

  it('flags unreadable parts and hand-changed marks', () => {
    const text = '(c) (8 [?:handwritten 10] points) Draw the [?] diagram.'
    const risks = findProofreadRisks(text).filter((risk) => risk.kind === 'unreadable')
    expect(risks.map((risk) => risk.text)).toEqual(['[?:handwritten 10]', '[?]'])
  })
})

describe('illumination normalisation (shadows on photos)', () => {
  it('evens out a shadow gradient while keeping dark ink dark', () => {
    const width = 64
    const height = 64
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Paper from bright (left) to shadowed (right), with an ink stroke.
        const paper = 230 - x * 2
        const ink = x === 32 ? 0.25 : 1
        const v = paper * ink
        const i = 4 * (y * width + x)
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    const out = normalizeIllumination(rgba, width, height)
    const at = (x: number) => out[4 * (32 * width + x)]!
    // Paper on both sides ends up similarly bright; the stroke stays dark.
    expect(Math.abs(at(5) - at(58))).toBeLessThan(25)
    expect(at(32)).toBeLessThan(at(31) - 100)
    expect(out[3]).toBe(255)
  })
})
