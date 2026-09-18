import 'fake-indexeddb/auto'

import { describe, expect, it, beforeEach } from 'vitest'
import { AppDatabase } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { UserService } from '@/services/userService'

function freshDb() {
  return new AppDatabase()
}

describe('ProjectService', () => {
  let svc: ProjectService

  beforeEach(() => {
    svc = new ProjectService(freshDb())
  })

  it('creates and lists projects', async () => {
    const project = await svc.create({ name: 'Calculus I', subject: 'calculus' })
    expect(project.id).toBeTypeOf('string')
    expect(project.name).toBe('Calculus I')
    expect(project.subject).toBe('calculus')

    const list = await svc.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(project.id)
  })

  it('rejects empty project names', async () => {
    await expect(svc.create({ name: '   ', subject: 'physics' })).rejects.toThrow(/required/i)
  })

  it('renames a project', async () => {
    const p = await svc.create({ name: 'Old', subject: 'cs' })
    const updated = await svc.rename(p.id, '  New Name  ')
    expect(updated.name).toBe('New Name')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)
  })

  it('updates subject and description', async () => {
    const p = await svc.create({ name: 'Course', subject: 'cs' })
    const updated = await svc.update(p.id, { subject: 'stats', description: 'intro' })
    expect(updated.subject).toBe('stats')
    expect(updated.description).toBe('intro')
  })

  it('throws NotFound when updating a missing project', async () => {
    await expect(svc.rename('does-not-exist', 'X')).rejects.toThrow(/not found/i)
  })

  it('deletes a project', async () => {
    const p = await svc.create({ name: 'Tmp', subject: 'other' })
    await svc.delete(p.id)
    const list = await svc.list()
    expect(list.find((x) => x.id === p.id)).toBeUndefined()
  })

  it('isolates projects from other ProjectService instances backed by the same DB', async () => {
    const a = new ProjectService(freshDb())
    await a.create({ name: 'A', subject: 'cs' })

    const b = new ProjectService(freshDb())
    expect(await b.count()).toBe(1)

    await b.create({ name: 'B', subject: 'cs' })
    expect(await a.count()).toBe(2)
    expect(await b.count()).toBe(2)
  })

  it('coexists with UserService without collision', async () => {
    const users = new UserService(freshDb())
    const profile = await users.get()
    expect(profile.id).toBe('singleton')
    expect(profile.name).toBe('Student')
  })
})