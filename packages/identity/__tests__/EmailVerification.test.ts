// Flujo completo de verificación por email (Baseline v1.0 §1 + ADR-0006)
import { describe, it, expect, beforeEach } from 'vitest'
import { IdentityModule, EMAIL_VERIFICATION_TTL_MS } from '../IdentityModule.js'
import {
  InMemoryEmailDelivery,
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import {
  InvalidVerificationTokenError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidatedError,
} from '../errors.js'
import { generateTokenValue, hashToken } from '../domain/tokenUtils.js'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

/** Extrae el token del link de verificación del último email del outbox. */
function tokenFromLastEmail(delivery: InMemoryEmailDelivery): string {
  const email = delivery.outbox.at(-1)
  if (!email) throw new Error('No hay emails en el outbox')
  const match = email.body.match(/token=([A-Za-z0-9_-]+)/)
  if (!match) throw new Error('Email sin token de verificación')
  return match[1]!
}

describe('Email verification (Baseline: single-use, expires, invalidates previous, SUSPENDED intacto)', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let delivery: InMemoryEmailDelivery
  let emitted: DomainEvent<unknown>[]
  let identity: IdentityModule
  let context: CoreContext<CoreEventMap>

  const buildContext = (): CoreContext<CoreEventMap> => ({
    events: bus,
    storage: nullStorage,
    persistence,
    email: delivery,
    permission: { has: () => true, request: async () => true },
    logger: console,
    config: { environment: 'test', version: '0.0.0' },
  })

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    delivery = new InMemoryEmailDelivery()
    emitted = []
    bus.on('*', (event) => emitted.push(event))

    identity = new IdentityModule()
    context = buildContext()
    await identity.init(context)
  })

  const registerTestUser = async (username = 'verifyme') =>
    identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'Verify Me',
    })

  it('request envía email al usuario y emite identity:verification-requested', async () => {
    const user = await registerTestUser()
    await identity.requestEmailVerification(user.id)

    expect(delivery.outbox).toHaveLength(1)
    expect(delivery.outbox[0].to).toBe('verifyme@test.dev')
    expect(delivery.outbox[0].body).toMatch(/token=/)

    const event = emitted.find((e) => e.name === 'identity:verification-requested')
    expect(event?.payload).toMatchObject({
      userId: user.id,
      email: 'verifyme@test.dev',
      expiresAt: expect.any(Number),
    })
  })

  it('request falla con error explícito si falta context.email', async () => {
    const user = await registerTestUser('noemail1')
    const module = new IdentityModule()
    const { email: _drop, ...withoutEmail } = context
    await module.init(withoutEmail as CoreContext<CoreEventMap>)

    await expect(module.requestEmailVerification(user.id)).rejects.toThrow(/context\.email/)
  })

  it('confirmEmail con token válido: emailVerified + PENDING_VERIFICATION → ACTIVE', async () => {
    const user = await registerTestUser()
    await identity.requestEmailVerification(user.id)
    const token = tokenFromLastEmail(delivery)

    const verified = await identity.confirmEmail(token)

    expect(verified.verificationFlags).toEqual({ emailVerified: true })
    expect(verified.accountStatus).toBe('ACTIVE')

    // Emite status-changed (razón: email confirmado) y email-verified
    const statusEvent = emitted.find((e) => e.name === 'identity:status-changed')
    expect(statusEvent?.payload).toMatchObject({
      userId: user.id,
      from: 'PENDING_VERIFICATION',
      to: 'ACTIVE',
      reason: 'email confirmed',
    })
    const verifiedEvent = emitted.find((e) => e.name === 'identity:email-verified')
    expect(verifiedEvent?.payload).toMatchObject({ userId: user.id, email: 'verifyme@test.dev' })
  })

  it('single-use: reutilizar un token consumido lanza TokenAlreadyUsedError', async () => {
    const user = await registerTestUser()
    await identity.requestEmailVerification(user.id)
    const token = tokenFromLastEmail(delivery)

    await identity.confirmEmail(token)
    await expect(identity.confirmEmail(token)).rejects.toThrow(TokenAlreadyUsedError)
  })

  it('una nueva solicitud invalida los tokens activos anteriores', async () => {
    const user = await registerTestUser()

    await identity.requestEmailVerification(user.id)
    const oldToken = tokenFromLastEmail(delivery)

    await identity.requestEmailVerification(user.id)
    const newToken = tokenFromLastEmail(delivery)
    expect(newToken).not.toBe(oldToken)

    await expect(identity.confirmEmail(oldToken)).rejects.toThrow(TokenInvalidatedError)

    // El token nuevo sí funciona
    const verified = await identity.confirmEmail(newToken)
    expect(verified.accountStatus).toBe('ACTIVE')
  })

  it('token expirado lanza TokenExpiredError', async () => {
    // TTL diminuto para forzar expiración determinista
    const shortTtlIdentity = new IdentityModule({ tokenTtlMs: 10 })
    await shortTtlIdentity.init(context)

    const user = await shortTtlIdentity.registerUser({
      username: 'expiring',
      email: 'expiring@test.dev',
      displayName: 'Expiring',
    })
    await shortTtlIdentity.requestEmailVerification(user.id)
    const token = tokenFromLastEmail(delivery)

    await new Promise((resolve) => setTimeout(resolve, 25))

    await expect(shortTtlIdentity.confirmEmail(token)).rejects.toThrow(TokenExpiredError)
    // El estado NO cambió
    expect((await shortTtlIdentity.getUser(user.id))?.accountStatus).toBe('PENDING_VERIFICATION')
  })

  it('token inexistente lanza InvalidVerificationTokenError', async () => {
    await expect(identity.confirmEmail('token-fantasma')).rejects.toThrow(InvalidVerificationTokenError)
  })

  it('REGLA BASELINE: cuenta SUSPENDED verifica el email pero NO cambia de estado', async () => {
    const user = await registerTestUser('suspended1')
    await identity.changeStatus(user.id, 'SUSPENDED', 'moderación')

    await identity.requestEmailVerification(user.id)
    const token = tokenFromLastEmail(delivery)

    const confirmed = await identity.confirmEmail(token)

    expect(confirmed.verificationFlags).toEqual({ emailVerified: true }) // flag marcado
    expect(confirmed.accountStatus).toBe('SUSPENDED')                    // estado intacto

    // Y no se emitió ningún status-changed por la confirmación
    const statusEvents = emitted.filter((e) => e.name === 'identity:status-changed')
    expect(statusEvents).toHaveLength(1) // solo el de la suspensión inicial
    expect(statusEvents[0].payload).toMatchObject({ to: 'SUSPENDED' })
  })

  it('el token en claro no se persiste: los records se guardan por hash', async () => {
    const user = await registerTestUser()
    await identity.requestEmailVerification(user.id)
    const token = tokenFromLastEmail(delivery)

    const tokens = persistence.repository<{ id: string }>('identity:email-tokens')
    const records = await tokens.list()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe(await hashToken(token))
    expect(records[0].id).not.toBe(token)
  })

  it('tokenUtils: tokens únicos y hash determinista en hex de 64 chars', async () => {
    const a = generateTokenValue()
    const b = generateTokenValue()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)

    expect(await hashToken('same')).toBe(await hashToken('same'))
    expect(await hashToken('same')).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken('same')).not.toBe(await hashToken('other'))
  })

  it('TTL por defecto es 24 horas', () => {
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(86_400_000)
  })
})
