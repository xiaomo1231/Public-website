import JSZip from 'jszip'

export interface TestDocxOptions {
  paragraphs?: string[]
  headings?: string[]
}

/**
 * Build a minimal but structurally valid .docx file in memory.
 *
 * We only include the bare minimum parts that mammoth needs:
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - word/document.xml
 *   - word/_rels/document.xml.rels
 *   - word/styles.xml (optional, but recommended)
 */
export async function makeTestDocx(options: TestDocxOptions = {}): Promise<Blob> {
  const headings = options.headings ?? ['Lecture 3: Eigenvalues']
  const paragraphs = options.paragraphs ?? [
    'The eigenvalues of a matrix are the roots of its characteristic polynomial.',
    'For a 2x2 matrix the formula simplifies nicely.',
  ]

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${headings
      .map(
        (h) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escape(h)}</w:t></w:r></w:p>`,
      )
      .join('\n')}
    ${paragraphs
      .map((p) => `<w:p><w:r><w:t>${escape(p)}</w:t></w:r></w:p>`)
      .join('\n')}
  </w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels')!.file('.rels', rels)
  zip.folder('word')!.file('document.xml', documentXml)
  return zip.generateAsync({ type: 'blob' })
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}