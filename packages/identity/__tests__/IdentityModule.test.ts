import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IdentityModule } from '../IdentityModule.js'
import { AccountType } from '../domain/AccountType.js'
import {
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import {
  UsernameAlreadyTakenError,
  UserNotFoundError,
  InvalidStatusTransitionError,
  InvalidAccountTypeConversionError,
  InvalidUsernameError,
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

  it("init falla con error explícito si falta context.persistence", async () => {
    const module = new IdentityModule()
    const { persistence: _drop, ...withoutPersistence } = context
    await expect(module.init(withoutPersistence as CoreContext<CoreEventMap>)).rejects.toThrow(/persistence/)
  })

  it('registerUser crea la cuenta en PENDING_VERIFICATION y emite identity:registered', async () => {
    const snapshot = await identity.registerUser({
      username: '  OsvaldoDev ',
      displayName: 'Osvaldo Peralta ✨',
    })

    expect(snapshot.username).toBe('osvaldodev') // normalizado
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
    const snapshot = await identity.registerUser({
      username: 'creador1',
      displayName: 'Creador',
      accountType: AccountType.Creator,
    })
    expect(snapshot.accountType).toBe('CREATOR')
  })

  it('username duplicado (case-insensitive) es rechazado', async () => {
    await identity.registerUser({ username: 'uniqueuser', displayName: 'A' })

    await expect(
      identity.registerUser({ username: 'UNIQUEUSER', displayName: 'B' })
    ).rejects.toThrow(UsernameAlreadyTakenError)

    // Y no persiste nada a medias
    expect(await identity.listUsers()).toHaveLength(1)
  })

  it('username inválido es rechazado sin efectos colaterales', async () => {
    await expect(
      identity.registerUser({ username: 'con_guion', displayName: 'A' })
    ).rejects.toThrow(InvalidUsernameError)
    expect(await identity.listUsers()).toHaveLength(0)
  })

  it('changeStatus transiciona según política, persiste y emite evento con from/to/reason', async () => {
    const user = await identity.registerUser({ username: 'user01', displayName: 'User' })

    const updated = await identity.changeStatus(user.id, 'ACTIVE', 'email confirmado (demo)')
    expect(updated.accountStatus).toBe('ACTIVE')

    const event = emitted.find((e) => e.name === 'identity:status-changed')
    expect(event?.payload).toMatchObject({
      userId: user.id,
      from: 'PENDING_VERIFICATION',
      to: 'ACTIVE',
      reason: 'email confirmado (demo)',
    })

    // Persistido: una "nueva sesión" ve el mismo estado
    const reloaded = await identity.getUser(user.id)
    expect(reloaded?.accountStatus).toBe('ACTIVE')
  })

  it('changeStatus rechaza transiciones inválidas y no muta el estado', async () => {
    const user = await identity.registerUser({ username: 'user02', displayName: 'User' })
    await identity.changeStatus(user.id, 'BANNED')

    await expect(identity.changeStatus(user.id, 'ACTIVE')).rejects.toThrow(InvalidStatusTransitionError)

    const reloaded = await identity.getUser(user.id)
    expect(reloaded?.accountStatus).toBe('BANNED')
  })

  it('changeStatus sobre usuario inexistente lanza UserNotFoundError', async () => {
    await expect(identity.changeStatus('ghost', 'ACTIVE')).rejects.toThrow(UserNotFoundError)
  })

  it('updateDisplayName persiste y emite identity:profile-updated', async () => {
    const user = await identity.registerUser({ username: 'user03', displayName: 'Antes' })

    const updated = await identity.updateDisplayName(user.id, '  Después  ')
    expect(updated.displayName).toBe('Después')

    const event = emitted.find((e) => e.name === 'identity:profile-updated')
    expect(event?.payload).toMatchObject({ userId: user.id, displayName: 'Después' })
  })

  it('changeAccountType aplica la política de conversión y emite identity:type-changed', async () => {
    const user = await identity.registerUser({ username: 'user04', displayName: 'User' })

    const updated = await identity.changeAccountType(user.id, AccountType.Creator)
    expect(updated.accountType).toBe('CREATOR')

    const event = emitted.find((e) => e.name === 'identity:type-changed')
    expect(event?.payload).toMatchObject({ userId: user.id, from: 'PERSONAL', to: 'CREATOR' })

    await expect(identity.changeAccountType(user.id, AccountType.Government)).rejects.toThrow(
      InvalidAccountTypeConversionError
    )
  })

  it('getByUsername resuelve case-insensitive vía índice', async () => {
    await identity.registerUser({ username: 'finder', displayName: 'Findable' })

    expect((await identity.getByUsername('FINDER'))?.username).toBe('finder')
    expect(await identity.getByUsername('noexiste')).toBeNull()
  })

  it('getUser devuelve null para id desconocido; listUsers devuelve todos', async () => {
    expect(await identity.getUser('ghost')).toBeNull()

    await identity.registerUser({ username: 'uno001', displayName: 'Uno' })
    await identity.registerUser({ username: 'dos002', displayName: 'Dos' })

    const all = await identity.listUsers()
    expect(all).toHaveLength(2)
    expect(all.map((u) => u.username).sort()).toEqual(['dos002', 'uno001'])
  })

  it('el snapshot no expone el agregado (datos planos de solo lectura)', async () => {
    const snapshot = await identity.registerUser({ username: 'plainobj', displayName: 'Plain' })

    expect(Object.isFrozen(snapshot)).toBe(false) // plain object
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('los datos sobreviven a una reinicialización (identidad estable)', async () => {
    const user = await identity.registerUser({ username: 'durable1', displayName: 'Durable' })
    await identity.changeStatus(user.id, 'ACTIVE')
    await identity.dispose()

    const second = new IdentityModule()
    await second.init(context)

    const reloaded = await second.getByUsername('durable1')
    expect(reloaded?.id).toBe(user.id)
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.createdAt).toBe(user.createdAt)
  })
})
