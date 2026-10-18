import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  PersistedRecord,
  PersistenceProvider,
  Repository,
} from '../context/Persistence.js'

interface TestRecord extends PersistedRecord {
  name: string
  tags?: string[]
}

export interface RepositoryContractOptions {
  /** Crea un provider con su almacén limpio (llamado antes de cada test). */
  create: () => PersistenceProvider | Promise<PersistenceProvider>
  /** Libera los recursos creados por `create` (archivos temporales, stubs...). */
  destroy?: (provider: PersistenceProvider) => void | Promise<void>
}

/**
 * Contract-tests compartidos del puerto `Repository` (ADR-0003).
 *
 * TODO adaptador de persistencia —actual o futuro— DEBE pasar esta suite.
 * Uso:
 * ```ts
 * defineRepositoryContractTests('MiAdaptador', {
 *   create: () => new MiAdaptador(...),
 *   destroy: async (p) => p.close?.(),
 * })
 * ```
 */
export function defineRepositoryContractTests(
  suiteName: string,
  options: RepositoryContractOptions
): void {
  describe(`Repository contract — ${suiteName}`, () => {
    let provider: PersistenceProvider
    let repo: Repository<TestRecord>

    beforeEach(async () => {
      provider = await options.create()
      repo = provider.repository<TestRecord>('test:records')
    })

    afterEach(async () => {
      await options.destroy?.(provider)
    })

    const makeRecord = (id: string, name = id, extra?: Partial<TestRecord>): TestRecord => ({
      id,
      name,
      ...extra,
    })

    it('get devuelve null para un id inexistente', async () => {
      expect(await repo.get('nope')).toBeNull()
    })

    it('save→get hace roundtrip de todos los campos', async () => {
      const record = makeRecord('r1', 'Foto', { tags: ['a', 'b'] })
      await repo.save(record)
      expect(await repo.get('r1')).toEqual(record)
    })

    it('save es un upsert por id', async () => {
      await repo.save(makeRecord('r1', 'v1'))
      await repo.save(makeRecord('r1', 'v2'))

      const all = await repo.list()
      expect(all).toHaveLength(1)
      expect((await repo.get('r1'))?.name).toBe('v2')
    })

    it('save devuelve el registro persistido', async () => {
      const saved = await repo.save(makeRecord('r1', 'x'))
      expect(saved).toEqual(makeRecord('r1', 'x'))
    })

    it('remove elimina y devuelve true; false si no existía', async () => {
      await repo.save(makeRecord('r1'))
      expect(await repo.remove('r1')).toBe(true)
      expect(await repo.get('r1')).toBeNull()
      expect(await repo.remove('r1')).toBe(false)
    })

    it('list devuelve todos los registros del namespace', async () => {
      await repo.save(makeRecord('r1'))
      await repo.save(makeRecord('r2'))

      const all = await repo.list()
      expect(all).toHaveLength(2)
      expect(all.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    })

    it('los namespaces están aislados entre sí', async () => {
      const other = provider.repository<TestRecord>('test:other')
      await repo.save(makeRecord('r1'))
      await other.save(makeRecord('r2'))

      expect((await repo.list()).map((r) => r.id)).toEqual(['r1'])
      expect((await other.list()).map((r) => r.id)).toEqual(['r2'])
    })

    it('almacena copias defensivas (entrada y salida)', async () => {
      const record = makeRecord('r1', 'original')
      await repo.save(record)

      // Mutar la entrada después de save no corrompe el almacén
      record.name = 'mutated-input'
      expect((await repo.get('r1'))?.name).toBe('original')

      // Mutar el resultado de get tampoco
      const fetched = (await repo.get('r1'))!
      fetched.name = 'mutated-output'
      expect((await repo.get('r1'))?.name).toBe('original')
    })

    it('los registros sin campos opcionales hacen roundtrip correctamente', async () => {
      await repo.save({ id: 'r1', name: 'sin tags' })

      const fetched = await repo.get('r1')
      expect(fetched).toEqual({ id: 'r1', name: 'sin tags' })
      expect(fetched?.tags).toBeUndefined()
    })
  })
}
