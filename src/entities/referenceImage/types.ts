/**
 * Reference images fetched from the web for a chemistry or biology topic.
 *
 * Strictly opt-in (off by default): the model only proposes search terms; the
 * pictures come from open sources (PubChem, Wikimedia Commons) whose licence
 * allows reuse, and the source page, licence and author are always shown.
 * Once fetched, the bytes are cached locally like course figures, so a topic
 * never searches twice.
 */

export type ReferenceImageSource = 'pubchem' | 'wikimedia'

/**
 * `verified`: a vision model confirmed the picture matches the purpose.
 * `unverified`: not checked — shown with a "may not match exactly" note.
 */
export type ReferenceImageRelevance = 'verified' | 'unverified'

export interface ReferenceImage {
  id: string
  projectId: string
  topicId: string
  source: ReferenceImageSource
  /** The search term the model proposed. */
  query: string
  /** What the picture is meant to show, in the lesson language. */
  purpose: string
  title: string
  /** Human-readable page about the image (opened in a new tab). */
  pageUrl: string
  /** Licence name, e.g. "Public domain", "CC BY-SA 4.0". */
  license: string
  licenseUrl?: string
  author?: string
  relevance: ReferenceImageRelevance
  mimeType: string
  createdAt: number
}

export interface ReferenceImageBlobRow {
  id: string
  projectId: string
  bytes: ArrayBuffer
  mimeType: string
}
