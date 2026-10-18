import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineMediaStorageContractTests } from '@morningstar/core/testing'
import type { MediaStorage } from '@morningstar/core'
import { FileMediaStorage } from './FileMediaStorage.js'

const tempDirs: string[] = []

defineMediaStorageContractTests('FileMediaStorage', {
  create: async (): Promise<MediaStorage> => {
    const dir = await mkdtemp(join(tmpdir(), 'morningstar-fm-'))
    tempDirs.push(dir)
    return new FileMediaStorage({ baseDir: dir })
  },
  destroy: async () => {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  },
})

describe('FileMediaStorage — durabilidad', () => {
  it('los binarios sobreviven a reaperturas (nueva instancia, mismo directorio)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'morningstar-fm-dur-'))
    try {
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      const first = new FileMediaStorage({ baseDir: dir })
      const object = await first.put(bytes, 'application/octet-stream')

      const second = new FileMediaStorage({ baseDir: dir })
      const fetched = await second.get(object.id)
      expect(Array.from(fetched!)).toEqual([1, 2, 3, 4, 5])

      const uri = await second.getUri(object.id)
      expect(uri).toMatch(/^file:\/\//)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
