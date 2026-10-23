import JSZip from 'jszip'
import { ommlToLatex } from './omml'
import { describeDrawings, type DrawingBox, type DrawingElement } from './pptxDrawing'

export interface PptxSlide {
  slideNumber: number
  title?: string
  /** Slide text without the labels of drawn diagrams (those are in `figures`). */
  body: string
  notes: string
  tables: string[][][]
  imageCount: number
  /**
   * One structured caption per diagram drawn with shapes on the slide
   * (`[图：2 条实线（…），坐标轴 2，…，标签：…]`, see `pptxDrawing.ts`).
   */
  figures?: string[]
  /** PowerPoint equations converted to inline `$…$` LaTeX. */
  equations?: number
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

/** An Office Math element (`m:oMathPara` / `m:oMath`) inside a run container. */
function mathIn(el: Element): Element | undefined {
  const all = Array.from(el.getElementsByTagName('*'))
  return all.find((c) => localName(c) === 'oMathPara') ?? all.find((c) => localName(c) === 'oMath')
}

function collectParagraphText(p: Element): string {
  let out = ''
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? ''
    else if (node.nodeType === 1) {
      const el = node as Element
      const tag = localName(el)
      if (tag === 't') out += textOf(el)
      else if (tag === 'br') out += '\n'
      else if (tag === 'r' || tag === 'fld') out += collectParagraphText(el)
      else if (tag === 'm' || tag === 'oMathPara' || tag === 'oMath') {
        // PowerPoint equation (`a14:m`): written inline as LaTeX.
        const math = tag === 'm' ? mathIn(el) : el
        const latex = math ? ommlToLatex(math) : ''
        if (latex) out += `${out && !/\s$/.test(out) ? ' ' : ''}$${latex}$`
      }
    }
  }
  return out
}

/** EMU per point. */
const EMU = 12700

interface Affine {
  sx: number
  sy: number
  tx: number
  ty: number
}

const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 }

function directChild(el: Element | undefined, name: string): Element | undefined {
  if (!el) return undefined
  return Array.from(el.childNodes).find(
    (node): node is Element => node.nodeType === 1 && localName(node as Element) === name,
  )
}

function numberAttr(el: Element | undefined, name: string): number {
  const value = Number(el?.getAttribute(name) ?? 0)
  return Number.isFinite(value) ? value : 0
}

/** The `a:xfrm` of a shape / group, in its parent's coordinates (EMU). */
function readXfrm(xfrm: Element | undefined): {
  box: DrawingBox
  child?: DrawingBox
  flipH: boolean
  flipV: boolean
} | null {
  if (!xfrm) return null
  const off = directChild(xfrm, 'off')
  const ext = directChild(xfrm, 'ext')
  if (!off || !ext) return null
  const chOff = directChild(xfrm, 'chOff')
  const chExt = directChild(xfrm, 'chExt')
  return {
    box: {
      x: numberAttr(off, 'x'),
      y: numberAttr(off, 'y'),
      w: numberAttr(ext, 'cx'),
      h: numberAttr(ext, 'cy'),
    },
    ...(chOff && chExt
      ? {
          child: {
            x: numberAttr(chOff, 'x'),
            y: numberAttr(chOff, 'y'),
            w: numberAttr(chExt, 'cx'),
            h: numberAttr(chExt, 'cy'),
          },
        }
      : {}),
    flipH: xfrm.getAttribute('flipH') === '1',
    flipV: xfrm.getAttribute('flipV') === '1',
  }
}

function applyAffine(t: Affine, box: DrawingBox): DrawingBox {
  return {
    x: (t.sx * box.x + t.tx) / EMU,
    y: (t.sy * box.y + t.ty) / EMU,
    w: (t.sx * box.w) / EMU,
    h: (t.sy * box.h) / EMU,
  }
}

/** Compose a group's child-space mapping onto its parent's transform. */
function groupAffine(parent: Affine, xfrm: ReturnType<typeof readXfrm>): Affine {
  if (!xfrm?.child || xfrm.child.w === 0 || xfrm.child.h === 0) return parent
  const kx = xfrm.box.w / xfrm.child.w
  const ky = xfrm.box.h / xfrm.child.h
  // child c → group space: off + (c - chOff) * k ; then parent transform.
  return {
    sx: parent.sx * kx,
    sy: parent.sy * ky,
    tx: parent.sx * (xfrm.box.x - xfrm.child.x * kx) + parent.tx,
    ty: parent.sy * (xfrm.box.y - xfrm.child.y * ky) + parent.ty,
  }
}

/** `mc:AlternateContent`: the branch we can read — the maths choice, else the fallback. */
function alternateBranch(el: Element): Element | undefined {
  const branches = Array.from(el.childNodes).filter((node): node is Element => node.nodeType === 1)
  const choice = branches.find(
    (b) => localName(b) === 'Choice' && /\ba14\b/.test(b.getAttribute('Requires') ?? ''),
  )
  return (
    choice ??
    branches.find((b) => localName(b) === 'Fallback') ??
    branches.find((b) => localName(b) === 'Choice')
  )
}

const LINE_GEOMETRY = /^(?:line|straightConnector\d*|bentConnector\d|curvedConnector\d|arc)$/
const ARROW_GEOMETRY = /arrow/i

interface OutlineStyle {
  visible: boolean
  dashed: boolean
  color?: string
  arrowHead: boolean
}

function readOutline(spPr: Element | undefined): OutlineStyle {
  const ln = directChild(spPr, 'ln')
  if (!ln) return { visible: true, dashed: false, arrowHead: false }
  const visible = !directChild(ln, 'noFill')
  const dash = directChild(ln, 'prstDash')?.getAttribute('val') ?? 'solid'
  const color =
    directChild(directChild(ln, 'solidFill'), 'srgbClr')?.getAttribute('val') ?? undefined
  const end = (name: string) => {
    const type = directChild(ln, name)?.getAttribute('type')
    return !!type && type !== 'none'
  }
  return {
    visible,
    dashed: dash !== 'solid',
    ...(color ? { color } : {}),
    arrowHead: end('headEnd') || end('tailEnd'),
  }
}

function tableRows(tbl: Element): string[][] {
  const rows: string[][] = []
  for (const tr of Array.from(tbl.getElementsByTagNameNS(NS.a, 'tr'))) {
    const row: string[] = []
    for (const tc of Array.from(tr.getElementsByTagNameNS(NS.a, 'tc'))) {
      const paras = Array.from(tc.getElementsByTagNameNS(NS.a, 'p'))
      row.push(paras.map(collectParagraphText).join(' ').trim())
    }
    rows.push(row)
  }
  return rows
}

interface SlideWalk {
  elements: DrawingElement[]
  /** Reading-order index → text, title / placeholder flags. */
  texts: Map<number, { text: string; title: boolean }>
  tables: string[][][]
  imageCount: number
  equations: number
  /** Equation objects kept only as a picture (MathType / OLE). */
  oleEquations: number
  nextGroup: number
}

function walkTree(container: Element, affine: Affine, group: number | undefined, walk: SlideWalk) {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType !== 1) continue
    const el = node as Element
    const name = localName(el)
    if (name === 'AlternateContent') {
      const branch = alternateBranch(el)
      if (branch) walkTree(branch, affine, group, walk)
      continue
    }
    if (name === 'grpSp') {
      const xfrm = readXfrm(directChild(directChild(el, 'grpSpPr'), 'xfrm'))
      const id = group ?? walk.nextGroup++
      walkTree(el, groupAffine(affine, xfrm), id, walk)
      continue
    }
    if (name === 'pic') {
      walk.imageCount += el.getElementsByTagNameNS(NS.a, 'blip').length || 1
      continue
    }
    if (name === 'graphicFrame') {
      const tables = Array.from(el.getElementsByTagNameNS(NS.a, 'tbl'))
      for (const tbl of tables) walk.tables.push(tableRows(tbl))
      const ole = Array.from(el.getElementsByTagName('*')).find((c) => localName(c) === 'oleObj')
      if (ole && /equation/i.test(`${ole.getAttribute('progId')} ${ole.getAttribute('name')}`))
        walk.oleEquations++
      walk.imageCount += el.getElementsByTagNameNS(NS.a, 'blip').length
      continue
    }
    if (name !== 'sp' && name !== 'cxnSp') continue

    const spPr = directChild(el, 'spPr')
    const xfrm = readXfrm(directChild(spPr, 'xfrm'))
    const box = xfrm ? applyAffine(affine, xfrm.box) : { x: 0, y: 0, w: 0, h: 0 }
    const index = walk.elements.length
    const geometry = directChild(spPr, 'prstGeom')?.getAttribute('prst') ?? ''
    const custom = !!directChild(spPr, 'custGeom')
    const nv = directChild(el, 'nvSpPr')
    const ph = nv ? nv.getElementsByTagNameNS(NS.p, 'ph')[0] : undefined
    const placeholderType = ph?.getAttribute('type') ?? (ph ? 'body' : '')
    const txBody = directChild(el, 'txBody')
    const paragraphs = txBody ? Array.from(txBody.getElementsByTagNameNS(NS.a, 'p')) : []
    walk.equations += txBody
      ? Array.from(txBody.getElementsByTagName('*')).filter((c) => localName(c) === 'oMath').length
      : 0
    // The slide number and date placeholders are page furniture, not content.
    if (placeholderType === 'sldNum' || placeholderType === 'dt') continue
    const text = paragraphs.map(collectParagraphText).join('\n').trim()
    walk.imageCount += el.getElementsByTagNameNS(NS.a, 'blip').length
    const outline = readOutline(spPr)
    const base = {
      index,
      box,
      ...(group !== undefined ? { group } : {}),
    }
    if (text) {
      const title = placeholderType === 'title' || placeholderType === 'ctrTitle'
      walk.texts.set(index, { text, title })
      walk.elements.push({
        ...base,
        kind: 'text',
        text,
        ...(ph ? { placeholder: true } : {}),
      })
      continue
    }
    const isLine = name === 'cxnSp' || LINE_GEOMETRY.test(geometry) || custom
    if (isLine && outline.visible) {
      walk.elements.push({
        ...base,
        kind: 'line',
        ...(outline.dashed ? { dashed: true } : {}),
        ...(outline.color ? { color: outline.color } : {}),
        ...(outline.arrowHead ? { arrowHead: true } : {}),
        ...(xfrm && xfrm.flipH !== xfrm.flipV ? { flipped: true } : {}),
        ...(custom || /^(?:curvedConnector\d|arc)$/.test(geometry) ? { curve: true } : {}),
      })
    } else if (ARROW_GEOMETRY.test(geometry)) {
      walk.elements.push({ ...base, kind: 'arrow' })
    } else if (!ph) {
      walk.elements.push({ ...base, kind: 'shape' })
    }
  }
}

function parseSlide(slideXml: string): {
  title?: string
  body: string
  tables: string[][][]
  imageCount: number
  figures: string[]
  equations: number
} {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(slideXml, 'application/xml')
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    return { body: '', tables: [], imageCount: 0, figures: [], equations: 0 }
  }

  const spTree = xmlDoc.getElementsByTagNameNS(NS.p, 'spTree')[0]
  const walk: SlideWalk = {
    elements: [],
    texts: new Map(),
    tables: [],
    imageCount: 0,
    equations: 0,
    oleEquations: 0,
    nextGroup: 0,
  }
  if (spTree) walkTree(spTree, IDENTITY, undefined, walk)

  // Short labels of a drawn diagram leave the body and are described once,
  // in the figure caption.
  const drawings = describeDrawings(walk.elements)
  const labelIndexes = new Set(drawings.flatMap((figure) => figure.labelIndexes))

  let title: string | undefined
  const bodyParts: string[] = []
  for (const [index, { text, title: isTitle }] of walk.texts) {
    if (isTitle) {
      title = title ?? text
      continue
    }
    if (labelIndexes.has(index)) continue
    bodyParts.push(text)
  }
  const figures = drawings.map((figure) => figure.caption)
  if (walk.oleEquations > 0)
    figures.push(`[公式：${walk.oleEquations} 个公式对象只有图片，未能转为文字]`)

  return {
    title,
    body: bodyParts.join('\n\n'),
    tables: walk.tables,
    imageCount: walk.imageCount,
    figures,
    equations: walk.equations,
  }
}

/** Relationship type suffixes (the namespace prefix differs between OOXML editions). */
const REL_SLIDE = '/slide'
const REL_NOTES = '/notesSlide'

interface Relationship {
  id: string
  type: string
  target: string
  external: boolean
}

function parseRelationships(xml: string | undefined): Relationship[] {
  if (!xml) return []
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return []
  return Array.from(doc.getElementsByTagName('Relationship')).map((rel) => ({
    id: rel.getAttribute('Id') ?? '',
    type: rel.getAttribute('Type') ?? '',
    target: rel.getAttribute('Target') ?? '',
    external: (rel.getAttribute('TargetMode') ?? '').toLowerCase() === 'external',
  }))
}

/** `ppt/slides/slide3.xml` → `ppt/slides/_rels/slide3.xml.rels`. */
function relsPathOf(partPath: string): string {
  const slash = partPath.lastIndexOf('/')
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`
}

function dirOf(partPath: string): string {
  return partPath.slice(0, partPath.lastIndexOf('/'))
}

function slideFileNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? '0')
}

/**
 * The deck's slides in presentation order: `p:sldIdLst` in
 * `ppt/presentation.xml`, resolved through `ppt/_rels/presentation.xml.rels`.
 * File names (`slide7.xml`) do not follow the order once slides have been
 * moved in PowerPoint. Falls back to file-name order when the presentation
 * part is missing or unreadable. Slide numbers are 1-based positions in the
 * returned list — the number PowerPoint shows.
 */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const byFileName = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideFileNumber(a) - slideFileNumber(b))
  try {
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text')
    if (!presentationXml) return byFileName
    const doc = new DOMParser().parseFromString(presentationXml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return byFileName
    const rels = parseRelationships(
      await zip.file('ppt/_rels/presentation.xml.rels')?.async('text'),
    )
    const targets = new Map(
      rels
        .filter((rel) => rel.type.endsWith(REL_SLIDE) && !rel.external)
        .map((rel) => [rel.id, resolvePart('ppt', rel.target)]),
    )
    const ordered: string[] = []
    for (const sldId of Array.from(doc.getElementsByTagNameNS(NS.p, 'sldId'))) {
      const relId = sldId.getAttributeNS(NS.r, 'id') ?? sldId.getAttribute('r:id') ?? ''
      const path = targets.get(relId)
      if (path && zip.file(path) && !ordered.includes(path)) ordered.push(path)
    }
    return ordered.length > 0 ? ordered : byFileName
  } catch {
    return byFileName
  }
}

/**
 * The notes part of a slide, found through the slide's own relationships
 * (`ppt/slides/_rels/slideN.xml.rels`, type notesSlide). Notes files are not
 * numbered like the slides they belong to, so matching by file name attaches
 * notes to the wrong slide.
 */
function notesPathOf(slidePath: string, slideRels: Relationship[]): string | undefined {
  const rel = slideRels.find((r) => r.type.endsWith(REL_NOTES) && !r.external && r.target)
  return rel ? resolvePart(dirOf(slidePath), rel.target) : undefined
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

  const slideFiles = await orderedSlidePaths(zip)

  const slides: PptxSlide[] = []
  let totalText = 0
  for (let i = 0; i < slideFiles.length; i++) {
    const name = slideFiles[i]!
    const num = i + 1
    try {
      const xml = await zip.file(name)!.async('text')
      const parsed = parseSlide(xml)
      const slideRels = parseRelationships(await zip.file(relsPathOf(name))?.async('text'))
      const notesName = notesPathOf(name, slideRels)
      const notes = notesName ? parseNotes(await zip.file(notesName)?.async('text')) : ''
      const body = [parsed.title, parsed.body].filter(Boolean).join('\n')
      totalText += body.length + notes.length
      slides.push({
        slideNumber: num,
        title: parsed.title,
        body: parsed.body,
        notes,
        tables: parsed.tables,
        imageCount: parsed.imageCount,
        ...(parsed.figures.length > 0 ? { figures: parsed.figures } : {}),
        ...(parsed.equations > 0 ? { equations: parsed.equations } : {}),
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
  /** Empty for an image the browser cannot display (`unsupportedFormat`). */
  bytes: ArrayBuffer
  mimeType: string
  /**
   * The slide's image is an EMF / WMF / TIFF picture no browser can show and
   * the file has no displayable fallback for it. `bytes` is empty unless
   * `substitute` is set.
   */
  unsupportedFormat?: string
  /**
   * The bytes are not the picture itself but the presentation's own
   * thumbnail of slide 1 (`docProps/thumbnail.jpeg`), used in its place.
   */
  substitute?: 'thumbnail'
}

/** Picture formats PowerPoint embeds that no browser can display. */
const UNDISPLAYABLE_IMAGE = /\.(emf|wmf|emz|wmz|tiff?)$/i

/**
 * Relationship ids of unsupported pictures that have a displayable twin in
 * the same `mc:AlternateContent` (a PNG fallback of an EMF): those need no
 * "cannot display" note, the twin is extracted as an ordinary image.
 */
function coveredRelIds(slideXml: string | undefined, targets: Map<string, string>): Set<string> {
  const covered = new Set<string>()
  if (!slideXml) return covered
  const doc = new DOMParser().parseFromString(slideXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return covered
  for (const alt of Array.from(doc.getElementsByTagName('*')).filter(
    (el) => localName(el) === 'AlternateContent',
  )) {
    const ids = Array.from(alt.getElementsByTagName('*'))
      .map((el) => el.getAttributeNS(NS.r, 'embed') ?? el.getAttribute('r:embed') ?? '')
      .filter(Boolean)
    const displayable = ids.some((id) => {
      const path = targets.get(id)
      return !!path && !!mimeFromPath(path)
    })
    if (displayable) for (const id of ids) covered.add(id)
  }
  return covered
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

  const slideFiles = await orderedSlidePaths(zip)

  for (let index = 0; index < slideFiles.length; index++) {
    const name = slideFiles[index]!
    // Same numbering as `extractPptx`: the slide's position in the deck.
    const slideNumber = index + 1
    const relsName = relsPathOf(name)
    const relsXml = await zip.file(relsName)?.async('text')
    if (!relsXml) continue

    const doc = parser.parseFromString(relsXml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) continue

    const candidates: PptxSlideImage[] = []
    const imageRels = Array.from(doc.getElementsByTagName('Relationship')).filter((rel) => {
      const target = rel.getAttribute('Target')
      return (
        (rel.getAttribute('Type') ?? '').endsWith('/image') &&
        !!target &&
        !/^https?:/i.test(target) &&
        (rel.getAttribute('TargetMode') ?? '').toLowerCase() !== 'external'
      )
    })
    const targets = new Map(
      imageRels.map((rel) => [
        rel.getAttribute('Id') ?? '',
        resolvePart(dirOf(name), rel.getAttribute('Target')!),
      ]),
    )
    const unsupported: string[] = []
    let covered: Set<string> | undefined
    for (const rel of imageRels) {
      const id = rel.getAttribute('Id') ?? ''
      const path = targets.get(id)!
      const mimeType = mimeFromPath(path)
      if (!mimeType) {
        if (!UNDISPLAYABLE_IMAGE.test(path) || !zip.file(path)) continue
        covered ??= coveredRelIds(await zip.file(name)?.async('text'), targets)
        if (!covered.has(id)) unsupported.push(path.slice(path.lastIndexOf('.') + 1).toLowerCase())
        continue
      }
      const file = zip.file(path)
      if (!file) continue
      const bytes = await file.async('arraybuffer')
      if (bytes.byteLength < minBytes) continue
      candidates.push({ slideNumber, bytes, mimeType })
    }

    candidates.sort((a, b) => b.bytes.byteLength - a.bytes.byteLength)
    out.push(...candidates.slice(0, maxPerSlide))

    // An EMF / WMF picture: kept as a figure the browser cannot show, so the
    // slide says a picture is there. Slide 1 may use the deck's own thumbnail.
    if (unsupported.length > 0) {
      const format = unsupported[0]!.replace(/z$/, 'f')
      const thumbnail =
        slideNumber === 1 && candidates.length === 0
          ? await zip.file('docProps/thumbnail.jpeg')?.async('arraybuffer')
          : undefined
      out.push(
        thumbnail && thumbnail.byteLength > 0
          ? {
              slideNumber,
              bytes: thumbnail,
              mimeType: 'image/jpeg',
              unsupportedFormat: format,
              substitute: 'thumbnail',
            }
          : { slideNumber, bytes: new ArrayBuffer(0), mimeType: '', unsupportedFormat: format },
      )
    }
  }

  return out
}
