import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { MediaStorage } from '../context/MediaStorage.js'

export interface MediaStorageContractOptions {
  /** Crea un adaptador con su almacén limpio (llamado antes de cada test). */
  create: () => MediaStorage | Promise<MediaStorage>
  /** Libera los recursos creados por `create` (archivos, bases de datos...). */
  destroy?: (storage: MediaStorage) => void | Promise<void>
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])

/**
 * Contract-tests compartidos del puerto `MediaStorage` (ADR-0004).
 *
 * TODO adaptador de medios —actual o futuro— DEBE pasar esta suite.
 * Uso:
 * ```ts
 * defineMediaStorageContractTests('MiAdaptador', {
 *   create: () => new MiAdaptador(...),
 * })
 * ```
 */
export function defineMediaStorageContractTests(
  suiteName: string,
  options: MediaStorageContractOptions
): void {
  describe(`MediaStorage contract — ${suiteName}`, () => {
    let storage: MediaStorage

    beforeEach(async () => {
      storage = await options.create()
    })

    afterEach(async () => {
      await options.destroy?.(storage)
    })

    it('put→get hace roundtrip exacto de los bytes', async () => {
      const object = await storage.put(PNG_BYTES, 'image/png')
      const fetched = await storage.get(object.id)

      expect(fetched).not.toBeNull()
      expect(Array.from(fetched!)).toEqual(Array.from(PNG_BYTES))
    })

    it('put devuelve metadata correcta', async () => {
      const before = Date.now()
      const object = await storage.put(PNG_BYTES, 'image/png')

      expect(object.id).toBeTruthy()
      expect(object.mimeType).toBe('image/png')
      expect(object.size).toBe(PNG_BYTES.byteLength)
      expect(object.createdAt).toBeGreaterThanOrEqual(before)
    })

    it('cada put genera un id único', async () => {
      const first = await storage.put(PNG_BYTES, 'image/png')
      const second = await storage.put(PNG_BYTES, 'image/png')

      expect(first.id).not.toBe(second.id)
    })

    it('get devuelve null para un id inexistente', async () => {
      expect(await storage.get('does-not-exist')).toBeNull()
    })

    it('getUri devuelve una URI no vacía, y null para id inexistente', async () => {
      const object = await storage.put(PNG_BYTES, 'image/png')

      const uri = await storage.getUri(object.id)
      expect(uri).toBeTruthy()
      expect(typeof uri).toBe('string')

      expect(await storage.getUri('does-not-exist')).toBeNull()
    })

    it('remove elimina el binario y devuelve el estado correcto', async () => {
      const object = await storage.put(PNG_BYTES, 'image/png')

      expect(await storage.remove(object.id)).toBe(true)
      expect(await storage.get(object.id)).toBeNull()
      expect(await storage.getUri(object.id)).toBeNull()
      expect(await storage.remove(object.id)).toBe(false)
    })

    it('put con data vacía es rechazado', async () => {
      await expect(storage.put(new Uint8Array(0), 'image/png')).rejects.toThrow(/empty/i)
    })

    it('almacena copias defensivas de la entrada', async () => {
      const data = new Uint8Array(PNG_BYTES)
      const object = await storage.put(data, 'image/png')

      // Mutar el buffer original después del put no corrompe el almacén
      data[0] = 0x00
      const fetched = await storage.get(object.id)
      expect(fetched![0]).toBe(0x89)
    })
  })
}
