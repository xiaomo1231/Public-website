import { describe, expect, it } from 'vitest'
import { extractPptx, extractPptxSlideImages } from '@/infrastructure/files/pptxExtractor'
import { chunksFromPptx } from '@/infrastructure/files/chunking'
import { ommlToLatex } from '@/infrastructure/files/omml'
import { colorName, describeDrawings, isLabelText } from '@/infrastructure/files/pptxDrawing'
import { makeTestPptx } from './fixtures/makeTestPptx'

// Synthetic slides only (positions in points, converted to EMU).
const EMU = 12700
let nextId = 10

function xfrm(x: number, y: number, w: number, h: number, flip = ''): string {
  return `<a:xfrm${flip}><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm>`
}

function connector(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { color?: string; dash?: string; flipV?: boolean; arrow?: boolean } = {},
): string {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${nextId++}" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
  <p:spPr>${xfrm(x, y, w, h, opts.flipV ? ' flipV="1"' : '')}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
  <a:ln w="19050"><a:solidFill><a:srgbClr val="${opts.color ?? '757070'}"/></a:solidFill>${opts.dash ? `<a:prstDash val="${opts.dash}"/>` : ''}${opts.arrow ? '<a:tailEnd type="triangle"/>' : ''}</a:ln></p:spPr></p:cxnSp>`
}

function textBox(x: number, y: number, w: number, h: number, text: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
  <p:txBody><a:bodyPr/>${text
    .split('\n')
    .map((line) => `<a:p><a:r><a:t>${line.replace(/&/g, '&amp;')}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp>`
}

/** A demand-shift graph: axes in a group, two demand lines, dashed guides, labels. */
function demandGraph(): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextId++}" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="${500 * EMU}" y="${100 * EMU}"/><a:ext cx="${400 * EMU}" cy="${300 * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${400 * EMU}" cy="${300 * EMU}"/></a:xfrm></p:grpSpPr>
    ${connector(40, 20, 0, 240)}
    ${connector(40, 260, 320, 0)}
    ${textBox(0, 0, 60, 20, 'Price')}
    ${textBox(300, 265, 80, 20, 'Quantity')}
  </p:grpSp>
  ${connector(600, 150, 150, 200, { color: '0070C0' })}
  ${connector(650, 130, 150, 200, { color: 'C00000' })}
  ${connector(540, 250, 130, 0, { dash: 'dash', color: 'C00000' })}
  ${connector(670, 250, 0, 110, { dash: 'dash', color: 'C00000' })}
  ${textBox(505, 240, 34, 20, '$1.4')}
  ${textBox(655, 362, 30, 18, '100')}
  ${textBox(700, 328, 90, 20, 'Old Demand')}
  ${textBox(805, 315, 110, 20, 'Increased Demand')}
  ${connector(720, 200, 40, 0, { arrow: true, color: '000000' })}`
}

describe('PPTX drawn diagrams', () => {
  it('moves diagram labels out of the slide text into one structured caption', async () => {
    const blob = await makeTestPptx({
      slides: [
        {
          title: 'Demand shifts',
          body: 'An increase in demand shifts the demand curve to the right.',
          shapesXml: demandGraph(),
        },
      ],
    })
    const [slide] = (await extractPptx(blob)).slides
    expect(slide!.body).toBe('An increase in demand shifts the demand curve to the right.')
    for (const label of ['$1.4', '100', 'Old Demand', 'Price', 'Quantity'])
      expect(slide!.body).not.toContain(label)
    const caption = slide!.figures![0]!
    expect(caption).toContain('2 条实线（蓝 Old Demand、红 Increased Demand）')
    expect(caption).toContain('坐标轴 2')
    expect(caption).toContain('虚线辅助线 2')
    expect(caption).toContain('箭头 1')
    expect(caption).toMatch(/标签：.*\$1\.4.*100/)

    const chunks = chunksFromPptx(
      { documentId: 'd', projectId: 'p', documentName: 'econ.pptx', type: 'pptx' },
      [slide!],
    )
    const captionChunk = chunks.find((chunk) => chunk.contentType === 'caption')
    expect(captionChunk?.text).toBe(caption)
    const body = chunks.find((chunk) => chunk.contentType === 'paragraph')!
    expect(body.text).not.toMatch(/^\$1\.4$/m)
  })

  it('keeps long text boxes and slides without a drawing unchanged', async () => {
    const blob = await makeTestPptx({
      slides: [
        {
          title: 'Plain',
          shapesXml:
            textBox(
              40,
              400,
              500,
              60,
              'Shifts versus movements: a change in price moves along the curve.',
            ) + connector(40, 380, 500, 0),
        },
      ],
    })
    const [slide] = (await extractPptx(blob)).slides
    expect(slide!.body).toContain('Shifts versus movements')
    expect(slide!.figures).toBeUndefined()
  })

  it('describes a box-and-connector diagram (no axes) as 示意图 in reading order', () => {
    const figures = describeDrawings([
      { index: 0, kind: 'text', box: { x: 0, y: 0, w: 100, h: 30 }, text: 'Attending School' },
      { index: 1, kind: 'line', box: { x: 20, y: 30, w: 10, h: 40 }, curve: true, group: 0 },
      {
        index: 2,
        kind: 'text',
        box: { x: 40, y: 60, w: 140, h: 30 },
        text: 'Tuition $60,000',
        group: 0,
      },
      { index: 3, kind: 'line', box: { x: 20, y: 30, w: 10, h: 90 }, curve: true, group: 0 },
      {
        index: 4,
        kind: 'text',
        box: { x: 40, y: 110, w: 140, h: 30 },
        text: 'You quit your job',
        group: 0,
      },
    ])
    expect(figures).toHaveLength(1)
    expect(figures[0]!.caption).toBe(
      '[示意图：连接线 2，文字：Attending School、Tuition $60,000、You quit your job]',
    )
  })

  it('names colours and recognises labels conservatively', () => {
    expect(colorName('C00000')).toBe('红')
    expect(colorName('0070C0')).toBe('蓝')
    expect(colorName('757070')).toBe('灰')
    expect(colorName(undefined)).toBeUndefined()
    expect(isLabelText('$1.4')).toBe(true)
    expect(isLabelText('This is a full sentence that explains a concept in several words.')).toBe(
      false,
    )
  })
})

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

function math(xml: string): Element {
  const doc = new DOMParser().parseFromString(`<m:oMath ${M}>${xml}</m:oMath>`, 'application/xml')
  return doc.documentElement
}

const r = (text: string, normal = false) =>
  `<m:r>${normal ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t>${text}</m:t></m:r>`

describe('OMML → LaTeX', () => {
  it('converts fractions, scripts, accents and text words', () => {
    const latex = ommlToLatex(
      math(
        `<m:acc><m:accPr><m:chr m:val="&#770;"/></m:accPr><m:e>${r('𝜂')}</m:e></m:acc>${r('=')}` +
          `<m:f><m:num>${r('% ')}${r('𝑐h𝑎𝑛𝑔𝑒')}${r(' ')}${r('𝑖𝑛')}${r(' ')}${r('𝑄')}</m:num><m:den>${r('Δ', true)}${r('𝑃')}</m:den></m:f>`,
      ),
    )
    expect(latex).toBe('\\hat{\\eta}=\\frac{\\%\\text{ change in }Q}{\\Delta P}')
  })

  it('converts sub/superscripts, radicals, n-ary sums and delimiters', () => {
    expect(ommlToLatex(math(`<m:sSub><m:e>${r('𝑄')}</m:e><m:sub>${r('𝑑')}</m:sub></m:sSub>`))).toBe(
      '{Q}_{d}',
    )
    expect(ommlToLatex(math(`<m:sSup><m:e>${r('𝑥')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`))).toBe(
      '{x}^{2}',
    )
    expect(
      ommlToLatex(
        math(
          `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('𝑥')}</m:e></m:rad>`,
        ),
      ),
    ).toBe('\\sqrt{x}')
    expect(
      ommlToLatex(
        math(
          `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('𝑖=1')}</m:sub><m:sup>${r('𝑛')}</m:sup><m:e>${r('𝑥')}</m:e></m:nary>`,
        ),
      ),
    ).toBe('\\sum_{i=1}^{n} x')
    expect(ommlToLatex(math(`<m:d><m:e>${r('1−𝑡')}</m:e></m:d>`))).toBe('\\left(1-t\\right)')
  })
})

/** A text box whose paragraph is an `a14:m` equation, with a picture fallback. */
function equationShape(): string {
  return `<mc:AlternateContent><mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="eq"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr>${xfrm(40, 300, 300, 60)}</p:spPr><p:txBody><a:bodyPr/><a:p><a14:m><m:oMathPara><m:oMath>
  ${r('𝐸')}${r('=')}<m:f><m:num>${r('Δ', true)}${r('𝑄')}</m:num><m:den>${r('𝑄')}</m:den></m:f>
  </m:oMath></m:oMathPara></a14:m></a:p></p:txBody></p:sp></mc:Choice>
  <mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="eq"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr>${xfrm(40, 300, 300, 60)}<a:blipFill><a:blip r:embed="rIdImg1"/></a:blipFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t> </a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>`
}

function oleEquation(): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nextId++}" name="o"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
  <p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">
  <mc:AlternateContent><mc:Choice Requires="v"><p:oleObj name="Equation" r:id="rIdOle" progId="Equation.DSMT4"><p:embed/></p:oleObj></mc:Choice>
  <mc:Fallback><p:oleObj name="Equation" r:id="rIdOle" progId="Equation.DSMT4"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="${nextId++}" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill><p:spPr/></p:pic></p:oleObj></mc:Fallback>
  </mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame>`
}

function tableFrame(): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nextId++}" name="tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
  <p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
  <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Price</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Qd</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
  <a:tr><a:tc><a:txBody><a:p><a:r><a:t>$5</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>10</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
  </a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

describe('PPTX equations, unsupported images and tables', () => {
  it('writes an a14:m equation inline as $…$ once (the fallback is not repeated)', async () => {
    const blob = await makeTestPptx({
      slides: [
        {
          title: 'Elasticity',
          shapesXml: equationShape(),
          images: [{ name: 'eq.png', bytes: new Uint8Array(4096) }],
        },
      ],
    })
    const [slide] = (await extractPptx(blob)).slides
    expect(slide!.body).toBe('$E=\\frac{\\Delta Q}{Q}$')
    expect(slide!.equations).toBe(1)
  })

  it('notes an OLE (MathType) equation and its WMF picture the browser cannot show', async () => {
    const blob = await makeTestPptx({
      slides: [
        {
          title: 'Formula',
          shapesXml: oleEquation(),
          images: [{ name: 'image1.wmf', bytes: new Uint8Array(4096) }],
        },
      ],
    })
    const [slide] = (await extractPptx(blob)).slides
    expect(slide!.figures).toEqual(['[公式：1 个公式对象只有图片，未能转为文字]'])
    const images = await extractPptxSlideImages(blob)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ slideNumber: 1, unsupportedFormat: 'wmf', mimeType: '' })
    expect(images[0]!.bytes.byteLength).toBe(0)
  })

  it('needs no note for an EMF that has a PNG twin; uses the thumbnail for slide 1', async () => {
    const twin = `<mc:AlternateContent><mc:Choice Requires="a14"><p:pic><p:nvPicPr><p:cNvPr id="${nextId++}" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/></p:blipFill><p:spPr/></p:pic></mc:Choice>
      <mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="${nextId++}" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg2"/></p:blipFill><p:spPr/></p:pic></mc:Fallback></mc:AlternateContent>`
    const covered = await makeTestPptx({
      slides: [
        {
          title: 'Twin',
          shapesXml: twin,
          images: [
            { name: 'chart.emf', bytes: new Uint8Array(4096) },
            { name: 'chart.png', bytes: new Uint8Array(4096) },
          ],
        },
      ],
    })
    const twinImages = await extractPptxSlideImages(covered)
    expect(twinImages).toHaveLength(1)
    expect(twinImages[0]!.mimeType).toBe('image/png')

    const thumb = await makeTestPptx({
      thumbnail: new Uint8Array(2048).fill(7),
      slides: [{ title: 'Cover', images: [{ name: 'logo.emf', bytes: new Uint8Array(4096) }] }],
    })
    const thumbImages = await extractPptxSlideImages(thumb)
    expect(thumbImages[0]).toMatchObject({
      slideNumber: 1,
      unsupportedFormat: 'emf',
      substitute: 'thumbnail',
      mimeType: 'image/jpeg',
    })
  })

  it('emits slide tables as Markdown tables', async () => {
    const blob = await makeTestPptx({ slides: [{ title: 'Schedule', shapesXml: tableFrame() }] })
    const [slide] = (await extractPptx(blob)).slides
    const chunks = chunksFromPptx(
      { documentId: 'd', projectId: 'p', documentName: 'econ.pptx', type: 'pptx' },
      [slide!],
    )
    const table = chunks.find((chunk) => chunk.contentType === 'table')!
    expect(table.text).toBe('| Price | Qd |\n| --- | --- |\n| $5 | 10 |')
  })
})
