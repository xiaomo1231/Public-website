import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { ReferenceImageService, referenceSourcesFor } from '@/services/referenceImageService'
import { SettingsService } from '@/services/settingsService'
import { DataManagementService } from '@/services/dataManagementService'
import { ReferenceImageRepository } from '@/entities/referenceImage/repository'
import {
  downloadImage,
  findPubChemCompound,
  isReusableLicense,
  plainText,
  searchCommons,
  type FetchLike,
} from '@/infrastructure/referenceImages/sources'
import { buildSystemPrompt as buildReferenceQueryPrompt, normalizeReferenceQueries } from '@/infrastructure/ai/prompts/reference-image-query/v2'
import { OpenAICompatibleProvider } from '@/infrastructure/ai/openaiCompatible'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function png(type = 'image/png'): Response {
  return new Response(PNG, { status: 200, headers: { 'content-type': type } })
}

const COMMONS_RESULT = {
  query: {
    pages: {
      '2': {
        index: 2,
        title: 'File:Mitochondrion structure.png',
        imageinfo: [
          {
            thumburl: 'https://upload.wikimedia.org/thumb/mito.png',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Mito.png',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
              Artist: { value: '<a href="//x">Jane Doe</a>' },
            },
          },
        ],
      },
      '1': {
        index: 1,
        title: 'File:Non free.png',
        imageinfo: [
          {
            thumburl: 'https://upload.wikimedia.org/thumb/nc.png',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nc.png',
            extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } },
          },
        ],
      },
      '3': {
        index: 3,
        title: 'File:Elsewhere.png',
        imageinfo: [
          {
            thumburl: 'https://evil.example.com/x.png',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:E.png',
            extmetadata: { LicenseShortName: { value: 'Public domain' } },
          },
        ],
      },
    },
  },
}

/** A fake network that only knows the two open sources. */
function fakeNetwork(overrides: Partial<Record<'pubchemFormula', string>> = {}) {
  const fetch = vi.fn<FetchLike>(async (url: string) => {
    if (url.includes('/rest/pug/compound/name/')) {
      return json({
        PropertyTable: {
          Properties: [{ CID: 702, MolecularFormula: overrides.pubchemFormula ?? 'C2H6O', Title: 'Ethanol' }],
        },
      })
    }
    if (url.includes('/rest/pug/compound/cid/')) return png()
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) return json(COMMONS_RESULT)
    if (url.startsWith('https://upload.wikimedia.org/')) return png('image/jpeg')
    return new Response('not found', { status: 404 })
  })
  return fetch
}

describe('open image sources', () => {
  it('accepts only licences that allow reuse', () => {
    expect(isReusableLicense('CC BY-SA 4.0')).toBe(true)
    expect(isReusableLicense('Public domain')).toBe(true)
    expect(isReusableLicense('CC0')).toBe(true)
    expect(isReusableLicense('CC BY-NC-SA 3.0')).toBe(false)
    expect(isReusableLicense('CC BY-ND 4.0')).toBe(false)
    expect(isReusableLicense('Fair use')).toBe(false)
    expect(isReusableLicense('')).toBe(false)
  })

  it('strips HTML from Commons metadata', () => {
    expect(plainText('<a href="x">Jane &amp; Joe</a>')).toBe('Jane & Joe')
  })

  it('finds a PubChem structure and checks its formula', async () => {
    const found = await findPubChemCompound('ethanol', { fetch: fakeNetwork(), expectedFormula: 'C2H5OH' })
    expect(found).toMatchObject({
      source: 'pubchem',
      imageUrl: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/702/PNG?image_size=large',
      pageUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/702',
    })
    const wrong = await findPubChemCompound('ethanol', {
      fetch: fakeNetwork({ pubchemFormula: 'C2H4O2' }),
      expectedFormula: 'C2H6O',
    })
    expect(wrong).toBeNull()
  })

  it('keeps only reusable Commons images from allowed hosts, in search order', async () => {
    const results = await searchCommons('mitochondrion diagram', { fetch: fakeNetwork() })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ license: 'CC BY-SA 4.0', author: 'Jane Doe', title: 'Mitochondrion structure' })
  })

  it('downloads only safe image types from allowed hosts', async () => {
    const network = fakeNetwork()
    expect(await downloadImage('https://upload.wikimedia.org/a.png', { fetch: network })).toMatchObject({ mimeType: 'image/jpeg' })
    expect(await downloadImage('https://evil.example.com/a.png', { fetch: network })).toBeNull()
    expect(await downloadImage('http://upload.wikimedia.org/a.png', { fetch: network })).toBeNull()
    const svg = vi.fn<FetchLike>(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    expect(await downloadImage('https://upload.wikimedia.org/a.svg', { fetch: svg })).toBeNull()
  })
})

describe('reference image queries', () => {
  it('keeps search terms only and requires a formula for PubChem', () => {
    const queries = normalizeReferenceQueries(
      {
        queries: [
          { source: 'pubchem', term: 'ethanol', formula: 'C2H6O', purpose: '乙醇结构' },
          { source: 'pubchem', term: 'acetic acid', purpose: 'no formula' },
          { source: 'wikimedia', term: 'https://evil.example.com/x.png', purpose: 'url' },
          { source: 'wikimedia', term: 'mitochondrion diagram', purpose: '线粒体结构' },
          { source: 'other', term: 'x', purpose: 'y' },
        ],
      },
      { allowPubChem: true },
    )
    expect(queries.map((query) => query.term)).toEqual(['ethanol', 'mitochondrion diagram'])
    expect(normalizeReferenceQueries({ queries: [{ source: 'pubchem', term: 'ethanol', formula: 'C2H6O', purpose: 'x' }] }, { allowPubChem: false })).toEqual([])
  })
})

describe('vision messages', () => {
  it('sends images as an OpenAI content array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"relevant":true}' } }], model: 'm' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const provider = new OpenAICompatibleProvider(
      'openai',
      'OpenAI',
      {
        provider: 'openai',
        baseURL: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'm',
        temperature: 0,
        maxTokens: 64,
      },
      { defaultModel: 'm', supportsJsonMode: false },
    )
    await provider.chat({ messages: [{ role: 'user', content: 'Is it relevant?', images: ['data:image/png;base64,AAAA'] }] })
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Is it relevant?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
    fetchSpy.mockRestore()
  })
})

describe('reference image service', () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
  })

  function fakeAI(relevant: boolean | 'error' | null) {
    const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
      const system = messages[0]!.content
      if (system.includes('suggest search terms')) {
        return {
          data: {
            queries: [
              { source: 'pubchem', term: 'ethanol', formula: 'C2H6O', purpose: '乙醇的结构' },
              { source: 'wikimedia', term: 'ethanol molecule model', purpose: '乙醇分子模型' },
            ],
          },
          raw: { content: '{}', model: 'fake' },
        }
      }
      if (relevant === 'error') throw new Error('model does not accept images')
      return { data: relevant === null ? {} : { relevant }, raw: { content: '{}', model: 'fake' } }
    })
    return { ai: { chatJSON } as unknown as AIService, chatJSON }
  }

  async function project(subject: 'chemistry' | 'biology' | 'calculus') {
    return (await new ProjectService(db).create({ name: 'Course', subject })).id
  }

  const input = (projectId: string) => ({
    projectId,
    topicId: 'topic-1',
    topicName: '乙醇',
    topicDescription: '',
    language: 'zh' as const,
    lessonContent: '乙醇的结构式为 CH3CH2OH。',
  })

  it('refuses to search while the setting is off', async () => {
    const projectId = await project('chemistry')
    const service = new ReferenceImageService({ db, ai: fakeAI(true).ai, fetch: fakeNetwork(), options: { enabled: false, visionCheck: false } })
    await expect(service.search(input(projectId))).rejects.toMatchObject({ code: 'WEB_IMAGES_DISABLED' })
  })

  it('caches unverified pictures with their source and licence', async () => {
    const projectId = await project('chemistry')
    const network = fakeNetwork()
    const service = new ReferenceImageService({ db, ai: fakeAI(true).ai, fetch: network, options: { enabled: true, visionCheck: false } })
    const images = await service.search(input(projectId))
    expect(images.map((image) => [image.source, image.relevance])).toEqual([
      ['pubchem', 'unverified'],
      ['wikimedia', 'unverified'],
    ])
    expect(images[1]).toMatchObject({ license: 'CC BY-SA 4.0', author: 'Jane Doe' })
    expect(await service.getImage(images[0]!.id)).toBeInstanceOf(Blob)
    // Every request went to one of the two open sources.
    for (const [url] of network.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/(pubchem\.ncbi\.nlm\.nih\.gov|commons\.wikimedia\.org|upload\.wikimedia\.org)\//)
    }
  })

  it('drops pictures the vision model rejects and marks confirmed ones', async () => {
    const projectId = await project('chemistry')
    const rejected = new ReferenceImageService({ db, ai: fakeAI(false).ai, fetch: fakeNetwork(), options: { enabled: true, visionCheck: true } })
    expect(await rejected.search(input(projectId))).toEqual([])

    const verified = new ReferenceImageService({ db, ai: fakeAI(true).ai, fetch: fakeNetwork(), options: { enabled: true, visionCheck: true } })
    const images = await verified.search(input(projectId))
    expect(images.every((image) => image.relevance === 'verified')).toBe(true)
  })

  it('falls back to unverified when the model cannot look at images', async () => {
    const projectId = await project('chemistry')
    const { ai, chatJSON } = fakeAI('error')
    const service = new ReferenceImageService({ db, ai, fetch: fakeNetwork(), options: { enabled: true, visionCheck: true } })
    const images = await service.search(input(projectId))
    expect(images).toHaveLength(2)
    expect(images.every((image) => image.relevance === 'unverified')).toBe(true)
    // One failed vision call, then no more attempts in this search.
    expect(chatJSON).toHaveBeenCalledTimes(2)
  })

  it('does nothing for subjects without web images, and never uses PubChem for biology', async () => {
    const calculus = await project('calculus')
    const network = fakeNetwork()
    const service = new ReferenceImageService({ db, ai: fakeAI(true).ai, fetch: network, options: { enabled: true, visionCheck: false } })
    expect(await service.search(input(calculus))).toEqual([])
    expect(network).not.toHaveBeenCalled()

    const biology = await project('biology')
    const images = await service.search(input(biology))
    expect(images.map((image) => image.source)).toEqual(['wikimedia'])
  })

  it('offers medicine Gray plates, histology and drug structures, never patient photos', () => {
    expect(referenceSourcesFor('medicine')).toEqual({ allowPubChem: true, medical: true })
    const prompt = buildReferenceQueryPrompt({ allowPubChem: true, medical: true })
    expect(prompt).toContain("Gray's Anatomy")
    expect(prompt).toMatch(/histology/)
    expect(prompt).toMatch(/patient/i)
    expect(buildReferenceQueryPrompt({ allowPubChem: false })).not.toContain("Gray's Anatomy")
  })

  it('is removed with its project and stays off by default in settings', async () => {
    const projectId = await project('chemistry')
    const service = new ReferenceImageService({ db, ai: fakeAI(true).ai, fetch: fakeNetwork(), options: { enabled: true, visionCheck: false } })
    await service.search(input(projectId))
    await new DataManagementService(db).deleteProject(projectId)
    expect(await new ReferenceImageRepository(db).listByTopic(projectId, 'topic-1')).toEqual([])

    const settings = await new SettingsService(db).get()
    expect(settings.webImagesEnabled).toBe(false)
    expect(settings.webImagesVisionCheck).toBe(false)
    const saved = await new SettingsService(db).update({ webImagesEnabled: true })
    expect(saved.webImagesEnabled).toBe(true)
  })
})
