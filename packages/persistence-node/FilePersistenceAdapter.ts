import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  PersistedRecord,
  PersistenceProvider,
  Repository,
} from '@morningstar/core'

type RecordMap<T> = Record<string, T>

/**
 * Los namespaces usan ':' (ej. 'photo-feed:photos'), carácter problemático en
 * algunos sistemas de archivos; se normaliza a un nombre de archivo seguro.
 */
function sanitizeNamespace(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Repositorio JSON sobre disco: un archivo por namespace con la forma
 * `{ [id]: record }`.
 *
 * La escritura es atómica (temp + rename): un crash a mitad de guardado no
 * deja el archivo corrupto. Sin control de concurrencia entre procesos: es un
 * adaptador de desarrollo Node (single-process), no una base de datos.
 */
class FileRepository<T extends PersistedRecord> implements Repository<T> {
  private readonly filePath: string

  constructor(baseDir: string, namespace: string) {
    this.filePath = join(baseDir, `${sanitizeNamespace(namespace)}.json`)
  }

  private async readAll(): Promise<RecordMap<T>> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as RecordMap<T>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private async writeAll(all: RecordMap<T>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.tmp`
    await writeFile(tmpPath, JSON.stringify(all, null, 2), 'utf8')
    await rename(tmpPath, this.filePath)
  }

  async get(id: string): Promise<T | null> {
    const all = await this.readAll()
    return all[id] ?? null
  }

  async save(record: T): Promise<T> {
    const all = await this.readAll()
    all[record.id] = record
    await this.writeAll(all)
    return record
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.readAll()
    if (!(id in all)) return false
    delete all[id]
    await this.writeAll(all)
    return true
  }

  async list(): Promise<T[]> {
    return Object.values(await this.readAll())
  }
}

export interface FilePersistenceOptions {
  /** Directorio base; cada namespace se guarda como `<namespace>.json`. Se crea si no existe. */
  baseDir: string
}

/**
 * Adaptador de persistencia durable de referencia para Node (ADR-0003).
 *
 * Demuestra que el puerto `PersistenceProvider` es sustituible con I/O real
 * sin tocar el dominio. Cuando exista el backend multiusuario (Fase 3+), un
 * adaptador remoto (DB/object storage) implementará el mismo puerto.
 */
export class FilePersistenceAdapter implements PersistenceProvider {
  private readonly baseDir: string

  constructor(options: FilePersistenceOptions) {
    this.baseDir = options.baseDir
  }

  repository<T extends PersistedRecord>(namespace: string): Repository<T> {
    return new FileRepository<T>(this.baseDir, namespace)
  }
}
