// modules/photo-feed/domain/mediaPolicy.ts

/** Entrada de una subida de archivo al módulo (bytes + tipo). */
export interface PhotoMediaInput {
  readonly data: Uint8Array
  readonly mimeType: string
}

/**
 * Política de validación de medios del módulo photo-feed.
 *
 * La validación de negocio vive en el DOMINIO (pura, testeable), no en los
 * adaptadores: el puerto MediaStorage solo valida integridad básica
 * (ADR-0004). Constantes documentadas; hacerlas configurables es un cambio
 * aditivo futuro.
 */
export const PHOTO_MEDIA_POLICY = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxBytes: 10 * 1024 * 1024, // 10 MB
} as const

/** Lanza `Error` descriptivo si la entrada viola la política. */
export function validatePhotoMedia(input: PhotoMediaInput): void {
  if (!input || !(input.data instanceof Uint8Array)) {
    throw new Error('Invalid media: data must be a Uint8Array')
  }
  if (input.data.byteLength === 0) {
    throw new Error('Invalid media: empty file')
  }

  const allowed: readonly string[] = PHOTO_MEDIA_POLICY.allowedMimeTypes
  if (!allowed.includes(input.mimeType)) {
    throw new Error(
      `Unsupported media type: ${input.mimeType} (allowed: ${allowed.join(', ')})`
    )
  }
  if (input.data.byteLength > PHOTO_MEDIA_POLICY.maxBytes) {
    throw new Error(
      `Media too large: ${input.data.byteLength} bytes (max ${PHOTO_MEDIA_POLICY.maxBytes} bytes)`
    )
  }
}
