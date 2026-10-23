import JSZip from 'jszip'

export interface TestPptxImage {
  /** File name inside `ppt/media` (extension decides the mime type). */
  name?: string
  bytes?: Uint8Array
  mimeType?: string
}

export interface TestPptxSlide {
  title?: string
  body?: string
  notes?: string
  /**
   * Number used for this slide's notes file (`notesSlide{n}.xml`). Defaults to
   * the slide's own file number; set it to prove notes are resolved through
   * the slide's relationships rather than by file name.
   */
  notesFileNumber?: number
  /** Images embedded in this slide (written to `ppt/media`). */
  images?: TestPptxImage[]
  /**
   * Raw `p:spTree` children appended after the title / body shapes (drawings,
   * groups, `mc:AlternateContent`, tables). Image `k` (1-based) of the slide
   * is referenced as `r:embed="rIdImg{k}"`.
   */
  shapesXml?: string
}

export interface TestPptxOptions {
  /** Slides in file order: `slides[i]` is written to `ppt/slides/slide{i+1}.xml`. */
  slides?: TestPptxSlide[]
  /**
   * Presentation order as 1-based file numbers (the `p:sldIdLst`). Defaults to
   * file order. A slide left out is an orphan part that is not in the deck.
   */
  order?: number[]
  /** Bytes of `docProps/thumbnail.jpeg` (PowerPoint's thumbnail of slide 1). */
  thumbnail?: Uint8Array
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Build a minimal valid .pptx file in memory.
 *
 * Parts:
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - ppt/presentation.xml (`p:sldIdLst`) + ppt/_rels/presentation.xml.rels
 *   - ppt/slides/slide{1..N}.xml (+ _rels when the slide has notes or images)
 *   - ppt/notesSlides/notesSlide{n}.xml, linked from the slide's rels
 */
export async function makeTestPptx(options: TestPptxOptions = {}): Promise<Blob> {
  const slides = options.slides ?? [
    { title: 'Introduction', body: 'Welcome to the course.', notes: 'Greet the class.' },
    { title: 'Vectors', body: 'A vector has magnitude and direction.', notes: '' },
  ]
  const order = options.order ?? slides.map((_, i) => i + 1)
  const notesNumber = (slide: TestPptxSlide, i: number) => slide.notesFileNumber ?? i + 1

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('\n')}
  ${slides
    .map((s, i) =>
      s.notes
        ? `<Override PartName="/ppt/notesSlides/notesSlide${notesNumber(s, i)}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
        : '',
    )
    .join('\n')}
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="${REL}">
  <p:sldIdLst>
    ${order.map((n, k) => `<p:sldId id="${256 + k}" r:id="rIdSlide${n}"/>`).join('\n')}
  </p:sldIdLst>
</p:presentation>`

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slides.map((_, i) => `<Relationship Id="rIdSlide${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n')}
</Relationships>`

  const zip = new JSZip()
  if (options.thumbnail) zip.file('docProps/thumbnail.jpeg', options.thumbnail)
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels')!.file('.rels', rels)
  zip.folder('ppt')!.file('presentation.xml', presentationXml)
  zip.folder('ppt/_rels')!.file('presentation.xml.rels', presentationRels)
  const slideFolder = zip.folder('ppt/slides')!
  const slideRelsFolder = zip.folder('ppt/slides/_rels')!
  const notesFolder = zip.folder('ppt/notesSlides')!
  const mediaFolder = zip.folder('ppt/media')!
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!
    slideFolder.file(`slide${i + 1}.xml`, makeSlideXml(slide))
    const relationships: string[] = []
    if (slide.notes) {
      const n = notesNumber(slide, i)
      notesFolder.file(`notesSlide${n}.xml`, makeNotesXml(slide.notes))
      relationships.push(
        `<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`,
      )
    }
    const images = slide.images ?? []
    images.forEach((image, k) => {
      const name = image.name ?? `image${i + 1}_${k + 1}.png`
      mediaFolder.file(name, image.bytes ?? new Uint8Array(2048))
      relationships.push(
        `<Relationship Id="rIdImg${k + 1}" Type="${REL}/image" Target="../media/${name}"/>`,
      )
    })
    if (relationships.length > 0) {
      slideRelsFolder.file(
        `slide${i + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships.join('\n')}
</Relationships>`,
      )
    }
  }
  return zip.generateAsync({ type: 'blob' })
}

function makeSlideXml(slide: TestPptxSlide): string {
  const titleShape = slide.title
    ? `<p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>${escape(slide.title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>`
    : ''
  const bodyShape = slide.body
    ? `<p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>${escape(slide.body)}</a:t></a:r></a:p></p:txBody>
      </p:sp>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="${REL}"
       xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
       xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
       xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <p:cSld>
    <p:spTree>
      ${titleShape}
      ${bodyShape}
      ${slide.shapesXml ?? ''}
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function makeNotesXml(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody><a:p><a:r><a:t>${escape(notes)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
