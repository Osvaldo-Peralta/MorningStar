import { describe, it, expect, beforeEach } from 'vitest'
import { IdentityModule } from '../IdentityModule.js'
import { AccountType } from '../domain/AccountType.js'
import {
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import {
  UsernameAlreadyTakenError,
  EmailAlreadyRegisteredError,
  UserNotFoundError,
  InvalidStatusTransitionError,
  InvalidAccountTypeConversionError,
  InvalidUsernameError,
  InvalidEmailError,
} from '../errors.js'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

describe('IdentityModule', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let emitted: DomainEvent<unknown>[]
  let identity: IdentityModule
  let context: CoreContext<CoreEventMap>

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    emitted = []
    bus.on('*', (event) => emitted.push(event))

    context = {
      events: bus,
      storage: nullStorage,
      persistence,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    }

    identity = new IdentityModule()
    await identity.init(context)
  })

  /** Helper: registro con email derivado del username salvo override. */
  const register = (username: string, extra?: { displayName?: string; email?: string; accountType?: AccountType }) =>
    identity.registerUser({
      username,
      displayName: extra?.displayName ?? 'User',
      email: extra?.email ?? `${username}@test.dev`,
      accountType: extra?.accountType,
    })

  it("init falla con error explícito si falta context.persistence", async () => {
    const module = new IdentityModule()
    const { persistence: _drop, ...withoutPersistence } = context
    await expect(module.init(withoutPersistence as CoreContext<CoreEventMap>)).rejects.toThrow(/persistence/)
  })

  it('registerUser crea la cuenta en PENDING_VERIFICATION y emite identity:registered', async () => {
    const snapshot = await register('osvaldodev', {
      displayName: 'Osvaldo Peralta ✨',
      email: '  Osvaldo@Test.Dev ',
    })

    expect(snapshot.username).toBe('osvaldodev') // normalizado
    expect(snapshot.email).toBe('osvaldo@test.dev') // normalizado
    expect(snapshot.accountStatus).toBe('PENDING_VERIFICATION')
    expect(snapshot.accountType).toBe('PERSONAL')
    expect(snapshot.verificationFlags).toEqual({ emailVerified: false })

    const event = emitted.find((e) => e.name === 'identity:registered')
    expect(event?.payload).toMatchObject({
      userId: snapshot.id,
      username: 'osvaldodev',
      accountStatus: 'PENDING_VERIFICATION',
    })
  })

  it('registerUser acepta accountType inicial válido', async () => {
    const snapshot = await register('creador1', { accountType: AccountType.Creator })
    expect(snapshot.accountType).toBe('CREATOR')
  })

  it('username duplicado (case-insensitive) es rechazado', async () => {
    await register('uniqueuser')

    await expect(register('UNIQUEUSER', { email: 'otro@test.dev' })).rejects.toThrow(
      UsernameAlreadyTakenError
    )
    expect(await identity.listUsers()).toHaveLength(1)
  })

  it('email duplicado (case-insensitive) es rechazado', async () => {
    await register('user0001', { email: 'shared@test.dev' })

    await expect(register('user0002', { email: '  SHARED@TEST.DEV ' })).rejects.toThrow(
      EmailAlreadyRegisteredError
    )
    expect(await identity.listUsers()).toHaveLength(1)
  })

  it('email inválido es rechazado sin efectos colaterales', async () => {
    await expect(register('user0003', { email: 'no-es-un-email' })).rejects.toThrow(InvalidEmailError)
    await expect(register('user0004', { email: 'sin@dominio' })).rejects.toThrow(InvalidEmailError)
    expect(await identity.listUsers()).toHaveLength(0)
  })

  it('username inválido es rechazado sin efectos colaterales', async () => {
    await expect(register('con_guion')).rejects.toThrow(InvalidUsernameError)
    expect(await identity.listUsers()).toHaveLength(0)
  })

  it('changeStatus transiciona según política, persiste y emite evento con from/to/reason', async () => {
    const user = await register('user01')

    const updated = await identity.changeStatus(user.id, 'ACTIVE', 'decisión de sistema (demo)')
    expect(updated.accountStatus).toBe('ACTIVE')

    const event = emitted.find((e) => e.name === 'identity:status-changed')
    expect(event?.payload).toMatchObject({
      userId: user.id,
      from: 'PENDING_VERIFICATION',
      to: 'ACTIVE',
      reason: 'decisión de sistema (demo)',
    })

    const reloaded = await identity.getUser(user.id)
    expect(reloaded?.accountStatus).toBe('ACTIVE')
  })

  it('changeStatus rechaza transiciones inválidas y no muta el estado', async () => {
    const user = await register('user02')
    await identity.changeStatus(user.id, 'BANNED')

    await expect(identity.changeStatus(user.id, 'ACTIVE')).rejects.toThrow(InvalidStatusTransitionError)

    const reloaded = await identity.getUser(user.id)
    expect(reloaded?.accountStatus).toBe('BANNED')
  })

  it('changeStatus sobre usuario inexistente lanza UserNotFoundError', async () => {
    await expect(identity.changeStatus('ghost', 'ACTIVE')).rejects.toThrow(UserNotFoundError)
  })

  it('updateDisplayName persiste y emite identity:profile-updated', async () => {
    const user = await register('user03', { displayName: 'Antes' })

    const updated = await identity.updateDisplayName(user.id, '  Después  ')
    expect(updated.displayName).toBe('Después')

    const event = emitted.find((e) => e.name === 'identity:profile-updated')
    expect(event?.payload).toMatchObject({ userId: user.id, displayName: 'Después' })
  })

  it('changeAccountType aplica la política de conversión y emite identity:type-changed', async () => {
    const user = await register('user04')

    const updated = await identity.changeAccountType(user.id, AccountType.Creator)
    expect(updated.accountType).toBe('CREATOR')

    const event = emitted.find((e) => e.name === 'identity:type-changed')
    expect(event?.payload).toMatchObject({ userId: user.id, from: 'PERSONAL', to: 'CREATOR' })

    await expect(identity.changeAccountType(user.id, AccountType.Government)).rejects.toThrow(
      InvalidAccountTypeConversionError
    )
  })

  it('getByUsername resuelve case-insensitive vía índice', async () => {
    await register('finder', { displayName: 'Findable' })

    expect((await identity.getByUsername('FINDER'))?.username).toBe('finder')
    expect(await identity.getByUsername('noexiste')).toBeNull()
  })

  it('getUser devuelve null para id desconocido; listUsers devuelve todos', async () => {
    expect(await identity.getUser('ghost')).toBeNull()

    await register('uno001', { displayName: 'Uno' })
    await register('dos002', { displayName: 'Dos' })

    const all = await identity.listUsers()
    expect(all).toHaveLength(2)
    expect(all.map((u) => u.username).sort()).toEqual(['dos002', 'uno001'])
  })

  it('el snapshot es un objeto plano serializable (no expone el agregado)', async () => {
    const snapshot = await register('plainobj')

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(snapshot.email).toBe('plainobj@test.dev')
  })

  it('los datos sobreviven a una reinicialización (identidad estable)', async () => {
    const user = await register('durable1', { displayName: 'Durable' })
    await identity.changeStatus(user.id, 'ACTIVE')
    await identity.dispose()

    const second = new IdentityModule()
    await second.init(context)

    const reloaded = await second.getByUsername('durable1')
    expect(reloaded?.id).toBe(user.id)
    expect(reloaded?.email).toBe(user.email)
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.createdAt).toBe(user.createdAt)
  })
})
