import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineRepositoryContractTests } from '@morningstar/core/testing'
import type { PersistenceProvider } from '@morningstar/core'
import { FilePersistenceAdapter } from './FilePersistenceAdapter.js'

const tempDirs: string[] = []

defineRepositoryContractTests('FilePersistenceAdapter', {
  create: async (): Promise<PersistenceProvider> => {
    const dir = await mkdtemp(join(tmpdir(), 'morningstar-fp-'))
    tempDirs.push(dir)
    return new FilePersistenceAdapter({ baseDir: dir })
  },
  destroy: async () => {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  },
})

describe('FilePersistenceAdapter — durabilidad', () => {
  it('los datos sobreviven a reaperturas (nuevo provider, mismo directorio)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'morningstar-fp-dur-'))
    try {
      const first = new FilePersistenceAdapter({ baseDir: dir })
      const repoA = first.repository<{ id: string; v: number }>('test:durability')
      await repoA.save({ id: 'x', v: 1 })

      const second = new FilePersistenceAdapter({ baseDir: dir })
      const repoB = second.repository<{ id: string; v: number }>('test:durability')
      expect(await repoB.get('x')).toEqual({ id: 'x', v: 1 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('namespaces distintos viven en archivos distintos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'morningstar-fp-ns-'))
    try {
      const adapter = new FilePersistenceAdapter({ baseDir: dir })
      await adapter.repository('ns:uno').save({ id: '1' })
      await adapter.repository('ns:dos').save({ id: '2' })

      expect((await adapter.repository('ns:uno').list()).map((r) => r.id)).toEqual(['1'])
      expect((await adapter.repository('ns:dos').list()).map((r) => r.id)).toEqual(['2'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
