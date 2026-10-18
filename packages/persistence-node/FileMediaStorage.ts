import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertValidMediaInput,
  type MediaObject,
  type MediaStorage,
} from '@morningstar/core'

/**
 * Los mediaId se usan como nombres de archivo: se limita el conjunto de
 * caracteres para evitar path traversal y nombres inválidos.
 */
function sanitizeMediaId(mediaId: string): string {
  return mediaId.replace(/[^a-zA-Z0-9-]/g, '_')
}

/**
 * Adaptador de MediaStorage durable para Node: cada binario vive en
 * `<baseDir>/media/<id>.bin` con su metadata en un sidecar `<id>.json`.
 *
 * `getUri` devuelve `file://` URLs (consumibles desde Node; un navegador no
 * puede cargarlas — en web se usa IndexedDbMediaStorage).
 *
 * Limitaciones (por diseño): single-process, sin control de concurrencia.
 * Es el adaptador de referencia durable hasta que exista el backend remoto.
 */
export class FileMediaStorage implements MediaStorage {
  private readonly mediaDir: string

  constructor(options: { baseDir: string }) {
    this.mediaDir = join(options.baseDir, 'media')
  }

  private pathsFor(mediaId: string): { binPath: string; metaPath: string } {
    const safe = sanitizeMediaId(mediaId)
    return {
      binPath: join(this.mediaDir, `${safe}.bin`),
      metaPath: join(this.mediaDir, `${safe}.json`),
    }
  }

  private async readMeta(mediaId: string): Promise<MediaObject | null> {
    try {
      const raw = await readFile(this.pathsFor(mediaId).metaPath, 'utf8')
      return JSON.parse(raw) as MediaObject
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async put(data: Uint8Array, mimeType: string): Promise<MediaObject> {
    assertValidMediaInput(data, mimeType)

    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const { binPath, metaPath } = this.pathsFor(id)
    const object: MediaObject = { id, mimeType, size: data.byteLength, createdAt }

    await mkdir(this.mediaDir, { recursive: true })
    await writeFile(binPath, data)
    // Escritura atómica de la metadata (temp + rename)
    await writeFile(`${metaPath}.tmp`, JSON.stringify(object, null, 2), 'utf8')
    await rename(`${metaPath}.tmp`, metaPath)

    return object
  }

  async get(mediaId: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathsFor(mediaId).binPath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async getUri(mediaId: string): Promise<string | null> {
    const meta = await this.readMeta(mediaId)
    if (!meta) return null
    return pathToFileURL(this.pathsFor(mediaId).binPath).href
  }

  async remove(mediaId: string): Promise<boolean> {
    const { binPath, metaPath } = this.pathsFor(mediaId)
    const existed = (await this.readMeta(mediaId)) !== null

    await rm(binPath, { force: true })
    await rm(metaPath, { force: true })

    return existed
  }
}
