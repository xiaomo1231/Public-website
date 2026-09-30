import JSZip from 'jszip'

export interface PptxSlide {
  slideNumber: number
  title?: string
  body: string
  notes: string
  tables: string[][][]
  imageCount: number
}

export interface PptxExtractionResult {
  slideCount: number
  slides: PptxSlide[]
  textLength: number
  warnings: string[]
  metadata: { title?: string; author?: string }
}

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

function localName(el: Element): string {
  return el.localName || el.nodeName
}

function textOf(parent: Element | null): string {
  if (!parent) return ''
  let out = ''
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? ''
  }
  return out
}

function collectParagraphText(p: Element): string {
  let out = ''
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? ''
    else if (node.nodeType === 1) {
      const tag = localName(node as Element)
      if (tag === 't') out += textOf(node as Element)
      else if (tag === 'br') out += '\n'
      else if (tag === 'r') out += collectParagraphText(node as Element)
    }
  }
  return out
}

function parseSlide(slideXml: string): { title?: string; body: string; tables: string[][][]; imageCount: number } {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(slideXml, 'application/xml')
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    return { body: '', tables: [], imageCount: 0 }
  }

  const spTree = xmlDoc.getElementsByTagNameNS(NS.p, 'spTree')[0]
  const shapeList = spTree ? Array.from(spTree.getElementsByTagNameNS(NS.p, 'sp')) : []
  const tables: string[][][] = []
  let title: string | undefined
  const bodyParts: string[] = []

  for (const sp of shapeList) {
    const nvSpPr = sp.getElementsByTagNameNS(NS.p, 'nvSpPr')[0]
    const placeholder = nvSpPr ? nvSpPr.getElementsByTagNameNS(NS.p, 'ph')[0] : undefined
    const placeholderType = placeholder?.getAttribute('type') ?? ''
    const txBody = sp.getElementsByTagNameNS(NS.p, 'txBody')[0]
    if (!txBody) continue
    const paragraphs = Array.from(txBody.getElementsByTagNameNS(NS.a, 'p'))
    const text = paragraphs.map(collectParagraphText).join('\n').trim()
    if (placeholderType === 'title' || placeholderType === 'ctrTitle') {
      title = title ?? text
    } else if (text) {
      bodyParts.push(text)
    }
  }

  // Tables (a:tbl)
  const tableEls = spTree ? Array.from(spTree.getElementsByTagNameNS(NS.a, 'tbl')) : []
  for (const tbl of tableEls) {
    const rows: string[][] = []
    const trEls = tbl.getElementsByTagNameNS(NS.a, 'tr')
    for (const tr of Array.from(trEls)) {
      const row: string[] = []
      const tcEls = tr.getElementsByTagNameNS(NS.a, 'tc')
      for (const tc of Array.from(tcEls)) {
        const paras = Array.from(tc.getElementsByTagNameNS(NS.a, 'p'))
        row.push(paras.map(collectParagraphText).join(' ').trim())
      }
      rows.push(row)
    }
    tables.push(rows)
  }

  // Images via blip references
  const imageCount = spTree ? spTree.getElementsByTagNameNS(NS.a, 'blip').length : 0

  return { title, body: bodyParts.join('\n\n'), tables, imageCount }
}

function parseNotes(notesXml: string | undefined): string {
  if (!notesXml) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(notesXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return ''
  const paragraphs = Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))
  return paragraphs.map(collectParagraphText).join('\n').trim()
}

export async function extractPptx(blob: Blob): Promise<PptxExtractionResult> {
  const arrayBuffer = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const warnings: string[] = []

  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? '0')
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? '0')
      return na - nb
    })

  const slides: PptxSlide[] = []
  let totalText = 0
  for (let i = 0; i < slideFiles.length; i++) {
    const name = slideFiles[i]!
    const num = Number(name.match(/slide(\d+)/)?.[1] ?? `${i + 1}`)
    try {
      const xml = await zip.files[name]!.async('text')
      const parsed = parseSlide(xml)
      const notesName = name.replace('/slides/slide', '/notesSlides/notesSlide')
      const notes = parseNotes(await zip.file(notesName)?.async('text'))
      const body = [parsed.title, parsed.body].filter(Boolean).join('\n')
      totalText += body.length + notes.length
      slides.push({
        slideNumber: num,
        title: parsed.title,
        body: parsed.body,
        notes,
        tables: parsed.tables,
        imageCount: parsed.imageCount,
      })
    } catch (err) {
      warnings.push(`Slide ${num} failed: ${(err as Error).message}`)
      slides.push({ slideNumber: num, body: '', notes: '', tables: [], imageCount: 0 })
    }
  }

  // Read core properties for title/author
  let title: string | undefined
  let author: string | undefined
  try {
    const coreXml = await zip.file('docProps/core.xml')?.async('text')
    if (coreXml) {
      const parser = new DOMParser()
      const doc = parser.parseFromString(coreXml, 'application/xml')
      title = textOf(doc.getElementsByTagName('dc:title')[0]!) || undefined
      author = textOf(doc.getElementsByTagName('dc:creator')[0]!) || undefined
    }
  } catch (err) {
    warnings.push(`Metadata failed: ${(err as Error).message}`)
  }

  return {
    slideCount: slides.length,
    slides,
    textLength: totalText,
    warnings,
    metadata: { title, author },
  }
}

/** An image embedded in a slide, extracted verbatim from the .pptx media. */
export interface PptxSlideImage {
  slideNumber: number
  bytes: ArrayBuffer
  mimeType: string
}

/** Only formats a browser can display inline; EMF/WMF/TIFF are skipped. */
const DISPLAYABLE_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

function mimeFromPath(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return DISPLAYABLE_IMAGE_MIME[ext]
}

/** Resolve an OPC relationship target (e.g. `../media/image1.png`) to a zip path. */
function resolvePart(baseDir: string, target: string): string {
  const segments = `${baseDir}/${target}`.split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

/**
 * Extract the images each slide embeds, straight from the .pptx media.
 *
 * The original slide layout is not rasterised (there is no PPTX renderer in
 * this app), so the honest "original picture" we can preserve is the media the
 * slide itself contains. This only ever copies bytes that are already in the
 * user's file — nothing is invented or re-drawn.
 */
export async function extractPptxSlideImages(
  blob: Blob,
  options: { maxPerSlide?: number; minBytes?: number } = {},
): Promise<PptxSlideImage[]> {
  const maxPerSlide = options.maxPerSlide ?? 3
  const minBytes = options.minBytes ?? 1024
  const arrayBuffer = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)
  const parser = new DOMParser()
  const out: PptxSlideImage[] = []

  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? '0')
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? '0')
      return na - nb
    })

  for (const name of slideFiles) {
    const slideNumber = Number(name.match(/slide(\d+)/)?.[1] ?? '0')
    if (!slideNumber) continue
    const relsName = name.replace('/slides/slide', '/slides/_rels/slide') + '.rels'
    const relsXml = await zip.file(relsName)?.async('text')
    if (!relsXml) continue

    const doc = parser.parseFromString(relsXml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) continue

    const candidates: PptxSlideImage[] = []
    for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
      const type = rel.getAttribute('Type') ?? ''
      if (!type.endsWith('/image')) continue
      const target = rel.getAttribute('Target')
      if (!target || /^https?:/i.test(target)) continue
      const path = resolvePart('ppt/slides', target)
      const mimeType = mimeFromPath(path)
      if (!mimeType) continue
      const file = zip.file(path)
      if (!file) continue
      const bytes = await file.async('arraybuffer')
      if (bytes.byteLength < minBytes) continue
      candidates.push({ slideNumber, bytes, mimeType })
    }

    candidates.sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)
    out.push(...candidates.slice(0, maxPerSlide))
  }

  return out
}