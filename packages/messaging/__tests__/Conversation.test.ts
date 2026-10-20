// Dominio Conversation: invariantes por kind, título, copia defensiva, records.
import { describe, it, expect } from 'vitest'
import { Conversation } from '../domain/Conversation.js'
import { MESSAGING_POLICY } from '../domain/messagingPolicy.js'
import {
  InvalidConversationTitleError,
  InvalidParticipantsError,
} from '../errors.js'

const create = (overrides: Partial<Parameters<typeof Conversation.create>[0]> = {}) =>
  Conversation.create(
    {
      id: 'conv-1',
      kind: 'direct',
      participantIds: ['user-a', 'user-b'],
      createdBy: 'user-a',
      ...overrides,
    },
    MESSAGING_POLICY
  )

describe('Conversation — invariants', () => {
  it('direct: exactamente 2 participantes distintos', () => {
    const c = create()
    expect(c.kind).toBe('direct')
    expect(c.participantIds).toEqual(['user-a', 'user-b'])
    expect(c.isParticipant('user-a')).toBe(true)
    expect(c.isParticipant('user-z')).toBe(false)

    expect(() => create({ participantIds: ['solo-uno'] })).toThrow(InvalidParticipantsError)
    expect(() =>
      create({ participantIds: ['user-a', 'user-b', 'user-c'] })
    ).toThrow(InvalidParticipantsError)
  })

  it('direct: sin título', () => {
    expect(() => create({ title: 'ilegal' })).toThrow(InvalidConversationTitleError)
  })

  it('group: mínimo 2 participantes únicos; creador debe participar', () => {
    const g = create({
      kind: 'group',
      participantIds: ['user-a', 'user-b', 'user-c'],
      title: '  Equipo Rojo  ',
    })
    expect(g.participantIds).toEqual(['user-a', 'user-b', 'user-c'])
    expect(g.title).toBe('Equipo Rojo') // trim

    expect(() => create({ kind: 'group', participantIds: ['user-a'] })).toThrow(
      InvalidParticipantsError
    )
    expect(() =>
      create({ kind: 'group', participantIds: ['user-a', 'user-b'], createdBy: 'fuera-del-grupo' })
    ).toThrow(InvalidParticipantsError)
  })

  it('participantes duplicados se deducen antes de validar mínimos', () => {
    // [a, a] dedupe ⇒ [a] ⇒ 1 participante ⇒ inválido incluso como group
    expect(() => create({ kind: 'group', participantIds: ['user-a', 'user-a'] })).toThrow(
      InvalidParticipantsError
    )
    const g = create({ kind: 'group', participantIds: ['user-a', 'user-b', 'user-b'] })
    expect(g.participantIds).toEqual(['user-a', 'user-b'])
  })

  it('ids de participantes deben ser strings no vacíos', () => {
    expect(() => create({ participantIds: ['user-a', '  '] })).toThrow(InvalidParticipantsError)
  })

  it('título de grupo: vacío o excedido ⇒ error; opcional válido', () => {
    expect(() =>
      create({ kind: 'group', participantIds: ['a', 'b'], createdBy: 'a', title: '   ' })
    ).toThrow(InvalidConversationTitleError)
    expect(() =>
      create({
        kind: 'group',
        participantIds: ['a', 'b'],
        createdBy: 'a',
        title: 'x'.repeat(MESSAGING_POLICY.maxTitleLength + 1),
      })
    ).toThrow(InvalidConversationTitleError)

    const sinTitulo = create({ kind: 'group', participantIds: ['a', 'b'], createdBy: 'a' })
    expect(sinTitulo.title).toBeUndefined()
  })

  it('participantIds expone copia defensiva', () => {
    const c = create()
    const copy = c.participantIds as string[]
    copy.push('intruso')
    expect(c.participantIds).toEqual(['user-a', 'user-b'])
  })

  it('touch actualiza lastMessageAt; arranca undefined', () => {
    const c = create()
    expect(c.lastMessageAt).toBeUndefined()
    c.touch(123)
    expect(c.lastMessageAt).toBe(123)
  })

  it('toRecord/fromRecord roundtrip preserva identidad y campos opcionales', () => {
    const g = create({ kind: 'group', participantIds: ['a', 'b'], createdBy: 'a', title: 'Grupo' })
    g.touch(999)
    const record = g.toRecord()
    expect(record).toMatchObject({
      id: 'conv-1',
      kind: 'group',
      participantIds: ['a', 'b'],
      title: 'Grupo',
      createdBy: 'a',
      lastMessageAt: 999,
    })

    const restored = Conversation.fromRecord(record)
    expect(restored.toRecord()).toEqual(record)
    expect(restored.createdAt).toBe(g.createdAt)
  })
})
