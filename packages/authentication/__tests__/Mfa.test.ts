// MFA: enrolamiento, login en dos pasos con challenge, backup codes, anti-replay (ADR-0010)
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationModule, MFA_CHALLENGE_DEFAULTS } from '../AuthenticationModule.js'
import { Pbkdf2PasswordHasher } from '../infraestructure/Pbkdf2PasswordHasher.js'
import { TotpService } from '../domain/TotpService.js'
import {
  InvalidMfaChallengeError,
  InvalidMfaCodeError,
  MfaAlreadyActiveError,
  MfaNotEnrolledError,
  MfaRequiredError,
} from '../errors.js'
import { IdentityModule } from '@morningstar/identity'
import {
  InMemoryEmailDelivery,
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import type { UserDirectoryPort } from '../UserDirectoryPort.js'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const PASSWORD = 'ClaveSegura123!'
const FIXED_NOW = 1_700_000_010_000 // reloj determinista para códigos TOTP

describe('AuthenticationModule — MFA (TOTP)', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let delivery: InMemoryEmailDelivery
  let emitted: DomainEvent<unknown>[]
  let context: CoreContext<CoreEventMap>
  let identity: IdentityModule
  let totp: TotpService
  let auth: AuthenticationModule

  const directory: (m: IdentityModule) => UserDirectoryPort = (identityModule) => ({
    lookupUser: async (identifier) => {
      const user =
        (await identityModule.getByUsername(identifier)) ??
        (await identityModule.getByEmail(identifier))
      return user
        ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
        : null
    },
    getUserAccount: async (userId) => {
      const user = await identityModule.getUser(userId)
      return user
        ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
        : null
    },
  })

  const makeAuth = (mfaOptions?: { challengeTtlMs?: number; maxAttempts?: number }) =>
    new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }),
      userDirectory: directory(identity),
      totp, // reloj determinista compartido
      mfa: mfaOptions,
    })

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    delivery = new InMemoryEmailDelivery()
    emitted = []
    bus.on('*', (event) => emitted.push(event))
    totp = new TotpService({ now: () => FIXED_NOW })

    context = {
      events: bus,
      storage: nullStorage,
      persistence,
      email: delivery,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    }

    identity = new IdentityModule()
    await identity.init(context)
    auth = makeAuth()
    await auth.init(context)
  })

  /** Usuario ACTIVE con contraseña y MFA activado (retorna backupCodes). */
  const mfaUser = async (username = 'mfauser') => {
    const user = await identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'MFA User',
    })
    await identity.requestEmailVerification(user.id)
    await identity.confirmEmail(delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!)
    await auth.setPassword(user.id, PASSWORD)

    const enrollment = await auth.enrollMfa(user.id)
    const code = await totp.generateCode(enrollment.secret)
    const activation = await auth.confirmMfa(user.id, code)

    return { user, enrollment, activation }
  }

  it('enrollMfa → confirmMfa activa MFA y entrega backup codes una vez', async () => {
    const user = await identity.registerUser({
      username: 'enrolling',
      email: 'enrolling@test.dev',
      displayName: 'Enrolling',
    })
    await identity.requestEmailVerification(user.id)
    await identity.confirmEmail(delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!)

    expect(await auth.getMfaStatus(user.id)).toEqual({ enrolled: false, active: false })

    const enrollment = await auth.enrollMfa(user.id)
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\/MorningStar:enrolling%40test\.dev\?/)
    expect(await auth.getMfaStatus(user.id)).toEqual({ enrolled: true, active: false })

    // Código incorrecto no activa
    await expect(auth.confirmMfa(user.id, '000000')).rejects.toThrow(InvalidMfaCodeError)

    const code = await totp.generateCode(enrollment.secret)
    const activation = await auth.confirmMfa(user.id, code)
    expect(activation.backupCodes).toHaveLength(MFA_CHALLENGE_DEFAULTS.backupCodes)
    expect(activation.backupCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    expect(await auth.getMfaStatus(user.id)).toEqual({ enrolled: true, active: true })

    expect(emitted.some((e) => e.name === 'auth:mfa-enrollment-started')).toBe(true)
    expect(emitted.some((e) => e.name === 'auth:mfa-activated')).toBe(true)
  })

  it('confirmMfa sin enrolamiento y enrollMfa con MFA activo: errores tipados', async () => {
    const { user } = await mfaUser()
    await expect(auth.confirmMfa(user.id, '123456')).rejects.toThrow(MfaNotEnrolledError)
    await expect(auth.enrollMfa(user.id)).rejects.toThrow(MfaAlreadyActiveError)
  })

  it('login con MFA activo NO emite sesión: lanza MfaRequiredError con challenge', async () => {
    const { user } = await mfaUser()

    const error = await auth.login('mfauser', PASSWORD, { fingerprint: 'dev-mfa' })
      .then(() => null)
      .catch((e: unknown) => e as MfaRequiredError)

    expect(error).toBeInstanceOf(MfaRequiredError)
    expect(error!.mfaToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(emitted.some((e) => e.name === 'auth:login-mfa-required')).toBe(true)
    // No se emitió sesión
    expect(emitted.some((e) => e.name === 'auth:session-issued')).toBe(false)
    expect(await auth.listSessions(user.id)).toHaveLength(0)
  })

  it('completeMfaLogin con TOTP válido emite el par sesión+refresh con el fingerprint del challenge', async () => {
    const { user, enrollment } = await mfaUser()

    const challenge = await auth.login('mfauser', PASSWORD, { fingerprint: 'dev-mfa' })
      .catch((e: MfaRequiredError) => e)
    const code = await totp.generateCode(enrollment.secret)
    // El reloj es fijo: confirmMfa ya consumió el step actual → usamos el siguiente
    const nextCode = await new TotpService({ now: () => FIXED_NOW + 30_000 }).generateCode(enrollment.secret)
    void code

    const result = await auth.completeMfaLogin((challenge as MfaRequiredError).mfaToken, nextCode)

    expect(result.userId).toBe(user.id)
    expect(result.session.deviceFingerprint).toBe('dev-mfa') // heredado del challenge
    expect(result.refreshToken).toBeTruthy()
    expect(await auth.validateSession(result.session.token)).not.toBeNull()
    expect(emitted.some((e) => e.name === 'auth:login-succeeded')).toBe(true)
  })

  it('anti-replay: el mismo código TOTP no sirve dos veces', async () => {
    const { enrollment } = await mfaUser()

    const first = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    const code = await totp.generateCode(enrollment.secret)
    // confirmMfa consumió el step de FIXED_NOW; el siguiente step es válido una vez
    const nextCode = await new TotpService({ now: () => FIXED_NOW + 30_000 }).generateCode(enrollment.secret)
    void first; void code
    await auth.completeMfaLogin((first as MfaRequiredError).mfaToken, nextCode)

    // Segundo login, mismo código (reloj fijo ⇒ mismo step) ⇒ replay rechazado
    const second = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    await expect(
      auth.completeMfaLogin((second as MfaRequiredError).mfaToken, nextCode)
    ).rejects.toThrow(InvalidMfaCodeError)
  })

  it('backup code: funciona una vez y se consume', async () => {
    const { activation } = await mfaUser()
    const backup = activation.backupCodes[0]!

    const challenge = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    const result = await auth.completeMfaLogin((challenge as MfaRequiredError).mfaToken, backup)
    expect(result.session).toBeTruthy()

    // Mismo backup code en un nuevo challenge ⇒ rechazado (consumido)
    const second = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    await expect(
      auth.completeMfaLogin((second as MfaRequiredError).mfaToken, backup)
    ).rejects.toThrow(InvalidMfaCodeError)
  })

  it('intentos agotados: el challenge muere tras maxAttempts códigos inválidos', async () => {
    const shortAuth = makeAuth({ maxAttempts: 2 })
    await shortAuth.init(context)
    const { enrollment } = await mfaUser()

    const challenge = await shortAuth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    const mfaToken = (challenge as MfaRequiredError).mfaToken

    await expect(shortAuth.completeMfaLogin(mfaToken, '000000')).rejects.toThrow(InvalidMfaCodeError)
    await expect(shortAuth.completeMfaLogin(mfaToken, '000001')).rejects.toThrow(InvalidMfaCodeError)

    // Challenge agotado: ni con el código correcto
    const goodCode = await new TotpService({ now: () => FIXED_NOW + 60_000 }).generateCode(enrollment.secret)
    await expect(shortAuth.completeMfaLogin(mfaToken, goodCode)).rejects.toThrow(InvalidMfaChallengeError)

    const failed = emitted.filter((e) => e.name === 'auth:login-failed' &&
      (e.payload as { reason?: string }).reason === 'invalid-mfa-code')
    expect(failed.length).toBeGreaterThanOrEqual(2)
  })

  it('challenge single-use y con TTL (expira)', async () => {
    const { enrollment } = await mfaUser()

    // Single-use
    const challenge = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    const mfaToken = (challenge as MfaRequiredError).mfaToken
    const nextCode = await new TotpService({ now: () => FIXED_NOW + 30_000 }).generateCode(enrollment.secret)
    await auth.completeMfaLogin(mfaToken, nextCode)
    await expect(auth.completeMfaLogin(mfaToken, nextCode)).rejects.toThrow(InvalidMfaChallengeError)

    // TTL
    const shortAuth = makeAuth({ challengeTtlMs: 30 })
    await shortAuth.init(context)
    const expiring = await shortAuth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const freshCode = await new TotpService({ now: () => FIXED_NOW + 60_000 }).generateCode(enrollment.secret)
    await expect(
      shortAuth.completeMfaLogin((expiring as MfaRequiredError).mfaToken, freshCode)
    ).rejects.toThrow(InvalidMfaChallengeError)
  })

  it('challenge desconocido: InvalidMfaChallengeError', async () => {
    await expect(auth.completeMfaLogin('challenge-fantasma', '123456')).rejects.toThrow(
      InvalidMfaChallengeError
    )
  })

  it('disableMfa exige factor válido; tras desactivar, el login vuelve a ser de un paso', async () => {
    const { user, enrollment } = await mfaUser()

    await expect(auth.disableMfa(user.id, '000000')).rejects.toThrow(InvalidMfaCodeError)

    const code = await new TotpService({ now: () => FIXED_NOW + 30_000 }).generateCode(enrollment.secret)
    await auth.disableMfa(user.id, code)

    expect(await auth.getMfaStatus(user.id)).toEqual({ enrolled: false, active: false })
    expect(emitted.some((e) => e.name === 'auth:mfa-disabled')).toBe(true)

    // Login directo otra vez
    const result = await auth.login('mfauser', PASSWORD)
    expect(result.session).toBeTruthy()
  })

  it('refresh sigue funcionando para usuarios con MFA (el RT ya es prueba de autenticación)', async () => {
    const { enrollment } = await mfaUser()
    const challenge = await auth.login('mfauser', PASSWORD).catch((e: MfaRequiredError) => e)
    const nextCode = await new TotpService({ now: () => FIXED_NOW + 30_000 }).generateCode(enrollment.secret)
    const result = await auth.completeMfaLogin((challenge as MfaRequiredError).mfaToken, nextCode)

    const refreshed = await auth.refresh(result.refreshToken)
    expect(refreshed.session.token).not.toBe(result.session.token)
  })

  it('los secrets/backup codes se guardan en auth:mfa y los challenges hasheados', async () => {
    const { user, activation } = await mfaUser()

    const mfaRecords = await persistence
      .repository<{ id: string; status: string; backupCodeHashes?: string[] }>('auth:mfa')
      .list()
    expect(mfaRecords).toHaveLength(1)
    expect(mfaRecords[0]!.id).toBe(user.id)
    expect(mfaRecords[0]!.status).toBe('active')
    // Backup codes persistidos SOLO como hash (nunca en claro)
    expect(mfaRecords[0]!.backupCodeHashes).toHaveLength(activation.backupCodes.length)
    const serialized = JSON.stringify(mfaRecords[0])
    for (const code of activation.backupCodes) {
      expect(serialized).not.toContain(code)
    }
  })

  it('defaults del challenge MFA: 5 min, 5 intentos, 10 backup codes', () => {
    expect(MFA_CHALLENGE_DEFAULTS).toEqual({
      challengeTtlMs: 300_000,
      maxAttempts: 5,
      backupCodes: 10,
    })
  })
})
