/**
 * Open image sources for opt-in reference pictures.
 *
 * - PubChem (NCBI): 2D structure depictions of a named compound. The compound
 *   is cross-checked against the formula the model expected, so a name that
 *   resolves to a different substance is never shown.
 * - Wikimedia Commons: diagrams and photos, restricted to licences that allow
 *   reuse (public domain, CC0, CC BY, CC BY-SA).
 *
 * Only these hosts are ever contacted, and only search terms leave the device.
 * Every response is untrusted: fields are type-checked and image bytes are
 * accepted only as PNG / JPEG / GIF / WebP within a size cap (never SVG).
 */
import { parseSpecies } from '@/infrastructure/chemistry/equation'

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>

export interface WebImageCandidate {
  source: 'pubchem' | 'wikimedia'
  title: string
  imageUrl: string
  pageUrl: string
  license: string
  licenseUrl?: string
  author?: string
}

export const ALLOWED_IMAGE_HOSTS = [
  'pubchem.ncbi.nlm.nih.gov',
  'commons.wikimedia.org',
  'upload.wikimedia.org',
] as const

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (ALLOWED_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname)
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Plain text from a Commons metadata value (which may contain HTML). */
export function plainText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, max) : undefined
}

/** Licences that allow showing the picture with attribution. */
export function isReusableLicense(name: string): boolean {
  const license = name.trim().toLowerCase()
  if (!license) return false
  if (/\bnc\b|\bnd\b|non-?commercial|no-?deriv|fair use|copyrighted|all rights reserved/.test(license)) return false
  return /^(public domain|pd\b|pd-|cc0|cc[ -]by(?:[ -]sa)?\b)/.test(license)
}

// --- PubChem -------------------------------------------------------------------

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov'

/** The structure depiction of a named compound, or null. */
export async function findPubChemCompound(
  name: string,
  options: { fetch: FetchLike; expectedFormula?: string; signal?: AbortSignal },
): Promise<WebImageCandidate | null> {
  const url = `${PUBCHEM}/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,Title/JSON`
  const response = await options.fetch(url, options.signal ? { signal: options.signal } : undefined)
  if (!response.ok) return null
  const json = asRecord(await response.json())
  const table = asRecord(json?.PropertyTable)
  const first = Array.isArray(table?.Properties) ? asRecord(table!.Properties[0]) : null
  const cid = typeof first?.CID === 'number' && Number.isInteger(first.CID) && first.CID > 0 ? first.CID : null
  const formula = typeof first?.MolecularFormula === 'string' ? first.MolecularFormula : ''
  if (!cid) return null
  // The name must resolve to the substance the lesson is about.
  if (options.expectedFormula) {
    const expected = parseSpecies(options.expectedFormula)
    const actual = parseSpecies(formula)
    if (!expected || !actual || expected.key !== actual.key) return null
  }
  const title = plainText(first?.Title, 80) ?? name
  return {
    source: 'pubchem',
    title: formula ? `${title} (${formula})` : title,
    imageUrl: `${PUBCHEM}/rest/pug/compound/cid/${cid}/PNG?image_size=large`,
    pageUrl: `${PUBCHEM}/compound/${cid}`,
    license: 'Public domain (NCBI / PubChem)',
    licenseUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/',
  }
}

// --- Wikimedia Commons -----------------------------------------------------------

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** Reusable images on Commons for a search phrase, best match first. */
export async function searchCommons(
  query: string,
  options: { fetch: FetchLike; limit?: number; signal?: AbortSignal },
): Promise<WebImageCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '640',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName',
  })
  const response = await options.fetch(`${COMMONS_API}?${params.toString()}`, options.signal ? { signal: options.signal } : undefined)
  if (!response.ok) return []
  const json = asRecord(await response.json())
  const pages = asRecord(asRecord(json?.query)?.pages)
  if (!pages) return []

  const ranked = Object.values(pages)
    .map((page) => asRecord(page))
    .filter((page): page is Record<string, unknown> => page !== null)
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))

  const out: WebImageCandidate[] = []
  for (const page of ranked) {
    const info = Array.isArray(page.imageinfo) ? asRecord(page.imageinfo[0]) : null
    const meta = asRecord(info?.extmetadata)
    const field = (key: string) => asRecord(meta?.[key])?.value
    const license = plainText(field('LicenseShortName'), 60) ?? ''
    const imageUrl = typeof info?.thumburl === 'string' ? info.thumburl : ''
    const pageUrl = typeof info?.descriptionurl === 'string' ? info.descriptionurl : ''
    if (!isReusableLicense(license) || !isAllowedUrl(imageUrl) || !isAllowedUrl(pageUrl)) continue
    const licenseUrl = plainText(field('LicenseUrl'), 200)
    const author = plainText(field('Artist'), 80)
    const title =
      plainText(field('ObjectName'), 80) ??
      (typeof page.title === 'string' ? page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '') : query)
    out.push({
      source: 'wikimedia',
      title,
      imageUrl,
      pageUrl,
      license,
      ...(licenseUrl && /^https?:\/\//.test(licenseUrl) ? { licenseUrl } : {}),
      ...(author ? { author } : {}),
    })
    if (out.length >= (options.limit ?? 3)) break
  }
  return out
}

// --- download ------------------------------------------------------------------

/** Image bytes from an allowed host, or null when the response is not a safe image. */
export async function downloadImage(
  url: string,
  options: { fetch: FetchLike; signal?: AbortSignal },
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  if (!isAllowedUrl(url)) return null
  const response = await options.fetch(url, options.signal ? { signal: options.signal } : undefined)
  if (!response.ok) return null
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!ALLOWED_MIME.includes(mimeType)) return null
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_IMAGE_BYTES) return null
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null
  return { bytes, mimeType }
}
