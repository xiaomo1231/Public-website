import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import {
  detectPhotoGroups,
  keepBothName,
  mergedPdfName,
  splitSequence,
} from '@/entities/document/photoGroups'
import { suggestMaterialType } from '@/entities/document/folders'
import { planQueue, type UploadQueueItem } from '@/features/documents/batchUpload'
import { buildPhotoPdfFile, fitOnPage, imagesToPdf } from '@/infrastructure/files/photoPdf'
import { shouldAutoTranscribe } from '@/services/pageTranscriptionService'

/** A solid-colour RGB PNG of the given size (no image library in node). */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array(height * (1 + width * 3))
  for (let y = 0; y < height; y++) raw[y * (1 + width * 3)] = 0
  const idat = deflateSync(raw)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND', new Uint8Array()),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('photo groups (考卷照片合并)', () => {
  it('splits a name into stem and sequence number', () => {
    expect(splitSequence('大题（带答案和评分）01.jpg')).toEqual({
      stem: '大题（带答案和评分）',
      number: 1,
    })
    expect(splitSequence('选择题 04.jpg')).toEqual({ stem: '选择题', number: 4 })
    expect(splitSequence('IMG_0012.JPG')).toEqual({ stem: 'IMG', number: 12 })
    expect(splitSequence('scan (3).png')).toEqual({ stem: 'scan', number: 3 })
    expect(splitSequence('Midterm page 2.jpg')).toEqual({ stem: 'Midterm', number: 2 })
    expect(splitSequence('notes.jpg')).toBeNull()
  })

  it('groups numbered photos by stem, in numeric order, keeping groups apart', () => {
    const names = [
      '大题（带答案和评分）02.jpg',
      '选择题 01.jpg',
      '大题（带答案和评分）10.jpg',
      '大题（带答案和评分）01.jpg',
      '选择题 02.jpg',
      '大题（带答案和评分）09.jpg',
      'cover.jpg',
      'Lecture 1.pdf',
      'Lecture 2.pdf',
    ]
    const groups = detectPhotoGroups(names.map((name) => ({ id: name, name })))
    expect(groups.map((g) => g.name)).toEqual(['大题（带答案和评分）.pdf', '选择题.pdf'])
    expect(groups[0]!.ids).toEqual([
      '大题（带答案和评分）01.jpg',
      '大题（带答案和评分）02.jpg',
      '大题（带答案和评分）09.jpg',
      '大题（带答案和评分）10.jpg',
    ])
    expect(groups[0]!.numbers).toEqual([1, 2, 9, 10])
  })

  it('never groups a single numbered photo, unnumbered photos or non-images', () => {
    expect(detectPhotoGroups([{ id: 'a', name: 'IMG_0001.jpg' }])).toEqual([])
    expect(
      detectPhotoGroups([
        { id: 'a', name: 'front.jpg' },
        { id: 'b', name: 'back.jpg' },
      ]),
    ).toEqual([])
    expect(
      detectPhotoGroups([
        { id: 'a', name: 'HW 1.pdf' },
        { id: 'b', name: 'HW 2.pdf' },
      ]),
    ).toEqual([])
  })

  it('keeps photos of different folders apart and names a stemless group after its folder', () => {
    const groups = detectPhotoGroups([
      { id: 'a', name: '01.jpg', folderPath: 'Midterm 2024' },
      { id: 'b', name: '02.jpg', folderPath: 'Midterm 2024' },
      { id: 'c', name: '01.jpg', folderPath: 'Final' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Midterm 2024.pdf')
    expect(mergedPdfName('', '', 'photos')).toBe('photos.pdf')
  })

  it('names a second copy "name (2).ext" and counts on', () => {
    expect(keepBothName('Lecture 01.pdf', ['lecture 01.pdf'])).toBe('Lecture 01 (2).pdf')
    expect(keepBothName('Lecture 01.pdf', ['Lecture 01.pdf', 'Lecture 01 (2).pdf'])).toBe(
      'Lecture 01 (3).pdf',
    )
    expect(keepBothName('a (2).pdf', ['a (2).pdf'])).toBe('a (3).pdf')
    expect(keepBothName('new.pdf', ['old.pdf'])).toBe('new.pdf')
  })
})

describe('upload queue plan', () => {
  const item = (over: Partial<UploadQueueItem> & { name: string }): UploadQueueItem => ({
    id: over.name,
    kind: 'file',
    file: new File(['x'], over.name, { type: 'image/jpeg' }),
    sizeBytes: 1,
    type: 'image',
    materialType: 'textbook',
    status: 'queued',
    ...over,
  })

  it('merges a photo group into one PDF row (default on) and can switch it off', () => {
    const raw = [item({ name: '选择题 02.jpg' }), item({ name: '选择题 01.jpg' })]
    const planned = planQueue(raw)
    expect(planned).toHaveLength(1)
    expect(planned[0]).toMatchObject({ name: '选择题.pdf', type: 'pdf', status: 'queued' })
    expect(planned[0]!.mergeNames).toEqual(['选择题 01.jpg', '选择题 02.jpg'])
    expect(planned[0]!.mergeIds).toEqual(['选择题 01.jpg', '选择题 02.jpg'])

    const off = planQueue(raw, { mergeOff: new Set([planned[0]!.mergeKey!]) })
    expect(off.map((i) => i.name)).toEqual(['选择题 02.jpg', '选择题 01.jpg'])
  })

  it('treats a merged PDF named like a stored file as a duplicate', () => {
    const raw = [item({ name: 'Quiz 1.jpg' }), item({ name: 'Quiz 2.jpg' })]
    const planned = planQueue(raw, { existing: [{ id: 'd1', name: 'quiz.pdf' }] })
    expect(planned[0]).toMatchObject({
      status: 'skipped',
      issue: 'duplicate',
      duplicateOf: { documentId: 'd1', name: 'quiz.pdf' },
    })
  })

  it('applies duplicate choices: skip, replace, keep both (with a free name)', () => {
    const dup = (name: string, id: string, of?: string): UploadQueueItem => ({
      ...item({ name, type: 'pdf' }),
      id,
      status: 'skipped',
      issue: 'duplicate',
      ...(of ? { duplicateOf: { documentId: of, name } } : {}),
    })
    const raw = [
      dup('A.pdf', 'a', 'doc-a'),
      dup('B.pdf', 'b', 'doc-b'),
      dup('C.pdf', 'c', 'doc-c'),
      dup('C.pdf', 'c2'),
    ]
    const planned = planQueue(raw, {
      choices: { a: 'skip', b: 'replace', c: 'keep', c2: 'replace' },
      existing: [
        { id: 'doc-a', name: 'A.pdf' },
        { id: 'doc-b', name: 'B.pdf' },
        { id: 'doc-c', name: 'C.pdf' },
        { id: 'doc-c2', name: 'C (2).pdf' },
      ],
    })
    const by = new Map(planned.map((i) => [i.id, i]))
    expect(by.get('a')).toMatchObject({ status: 'skipped', duplicateChoice: 'skip' })
    expect(by.get('b')).toMatchObject({ status: 'queued', duplicateChoice: 'replace' })
    expect(by.get('c')).toMatchObject({ status: 'queued', saveAs: 'C (3).pdf' })
    // Nothing stored to replace: falls back to skip.
    expect(by.get('c2')).toMatchObject({ status: 'skipped', duplicateChoice: 'skip' })
  })
})

describe('photo PDF (pdf-lib)', () => {
  it('fits a photo on an A4 page matching its orientation', () => {
    expect(fitOnPage(1000, 2000).page).toEqual([595.28, 841.89])
    const landscape = fitOnPage(2000, 1000)
    expect(landscape.page).toEqual([841.89, 595.28])
    expect(landscape.box.width / landscape.box.height).toBeCloseTo(2, 5)
  })

  it('makes one page per image, in the given order', async () => {
    const bytes = await imagesToPdf([
      { bytes: png(20, 40), mimeType: 'image/png', width: 20, height: 40 },
      { bytes: png(40, 20), mimeType: 'image/png', width: 40, height: 20 },
      { bytes: png(30, 30), mimeType: 'image/png', width: 30, height: 30 },
    ])
    const pdf = await PDFDocument.load(bytes)
    const sizes = pdf.getPages().map((p) => p.getSize())
    expect(sizes).toHaveLength(3)
    expect(sizes[0]!.width).toBeLessThan(sizes[0]!.height)
    expect(sizes[1]!.width).toBeGreaterThan(sizes[1]!.height)
  })

  it('builds a named PDF file from photos with a page preparer', async () => {
    const photos = [new Blob(['a']), new Blob(['b'])]
    const seen: string[] = []
    const file = await buildPhotoPdfFile(photos, '选择题.pdf', async (blob) => {
      seen.push(await blob.text())
      return { bytes: png(10, 10), mimeType: 'image/png', width: 10, height: 10 }
    })
    expect(seen).toEqual(['a', 'b'])
    expect(file.name).toBe('选择题.pdf')
    expect(file.type).toBe('application/pdf')
    const pdf = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))
    expect(pdf.getPageCount()).toBe(2)
  })

  it('reads a merged-photo PDF like a photo (看图识别)', () => {
    const setup = { hasAI: true, mode: 'auto' as const }
    const pdf = {
      type: 'pdf' as const,
      materialType: 'past_exam' as const,
      status: 'ready' as const,
    }
    expect(shouldAutoTranscribe({ ...pdf, photoPages: 4 }, setup)).toBe(true)
    expect(shouldAutoTranscribe(pdf, setup)).toBe(false)
    expect(shouldAutoTranscribe({ ...pdf, photoPages: 4 }, { ...setup, mode: 'local' })).toBe(false)
  })
})

describe('file name rules (2s)', () => {
  it('prefers a past paper for 大题 / 选择题 / 题目 / 试卷 / exam paper names', () => {
    for (const name of [
      '大题（带答案和评分）.pdf',
      '大题（带答案和评分）01.jpg',
      '选择题 01.jpg',
      '题目.pdf',
      '期末试卷（含答案）.pdf',
      'Exam paper 2023.pdf',
      'Practice test with solutions.pdf',
    ]) {
      expect(suggestMaterialType(name), name).toBe('past_exam')
    }
  })

  it('keeps a name that is just answers / solutions / key an answer key', () => {
    for (const name of ['HW3 solutions.pdf', '答案.pdf', '大题答案.pdf', 'Answer key.pdf']) {
      expect(suggestMaterialType(name), name).toBe('homework_answer')
    }
    expect(suggestMaterialType('hw3.pdf')).toBe('homework')
  })
})
