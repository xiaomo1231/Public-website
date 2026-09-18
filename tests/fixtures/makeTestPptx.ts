import JSZip from 'jszip'

export interface TestPptxSlide {
  title?: string
  body?: string
  notes?: string
}

export interface TestPptxOptions {
  slides?: TestPptxSlide[]
}

/**
 * Build a minimal valid .pptx file in memory.
 *
 * Required parts for jszip parsing:
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - ppt/presentation.xml
 *   - ppt/_rels/presentation.xml.rels
 *   - ppt/slides/slide{1..N}.xml
 *   - ppt/notesSlides/notesSlide{1..N}.xml (optional, only if notes present)
 */
export async function makeTestPptx(options: TestPptxOptions = {}): Promise<Blob> {
  const slides = options.slides ?? [
    { title: 'Introduction', body: 'Welcome to the course.', notes: 'Greet the class.' },
    { title: 'Vectors', body: 'A vector has magnitude and direction.', notes: '' },
  ]

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('\n')}
  ${slides
    .filter((s) => s.notes)
    .map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`)
    .join('\n')}
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldIdLst>
    ${slides.map((_, i) => `<p:sldId id="${100 + i}" r:id="rId${i + 2}"/>`).join('\n')}
  </p:sldIdLst>
</p:presentation>`

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slides.map((s, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>${s.notes ? `<Relationship Id="rIdNotes${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="notesSlides/notesSlide${i + 1}.xml"/>` : ''}`).join('\n')}
</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels')!.file('.rels', rels)
  zip.folder('ppt')!.file('presentation.xml', presentationXml)
  zip.folder('ppt/_rels')!.file('presentation.xml.rels', presentationRels)
  const slideFolder = zip.folder('ppt/slides')!
  const notesFolder = zip.folder('ppt/notesSlides')!
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!
    slideFolder.file(`slide${i + 1}.xml`, makeSlideXml(slide))
    if (slide.notes) {
      notesFolder.file(`notesSlide${i + 1}.xml`, makeNotesXml(slide.notes))
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
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      ${titleShape}
      ${bodyShape}
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}