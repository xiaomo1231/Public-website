import { describe, expect, it } from 'vitest'
import { extractPptx } from '@/infrastructure/files/pptxExtractor'
import { makeTestPptx } from './fixtures/makeTestPptx'

describe('extractPptx', () => {
  it('extracts slides with title and body', async () => {
    const blob = await makeTestPptx({
      slides: [
        { title: 'Intro', body: 'Welcome to the course.', notes: 'Greet students.' },
        { title: 'Vectors', body: 'Magnitude and direction.', notes: '' },
      ],
    })
    const result = await extractPptx(blob)
    expect(result.slideCount).toBe(2)
    expect(result.slides[0]!.title).toBe('Intro')
    expect(result.slides[0]!.body).toMatch(/Welcome/)
    expect(result.slides[0]!.notes).toMatch(/Greet/)
    expect(result.textLength).toBeGreaterThan(0)
  })

  it('handles pptx without notes', async () => {
    const blob = await makeTestPptx({
      slides: [{ title: 'A', body: 'B' }],
    })
    const result = await extractPptx(blob)
    expect(result.slideCount).toBe(1)
    expect(result.slides[0]!.notes).toBe('')
  })

  it('records warnings when parts are missing', async () => {
    const bad = new Blob(['not a real pptx'], { type: 'application/octet-stream' })
    await expect(extractPptx(bad)).rejects.toBeDefined()
  })
})