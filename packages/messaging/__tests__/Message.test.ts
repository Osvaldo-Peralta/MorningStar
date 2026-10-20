// Dominio Message: validación de cuerpo, edición, soft delete y records.
import { describe, it, expect } from 'vitest'
import { Message } from '../domain/Message.js'
import { MESSAGING_POLICY, resolveMessagingPolicy } from '../domain/messagingPolicy.js'
import { InvalidMessageBodyError, MessageAlreadyDeletedError, MessagingError } from '../errors.js'

const create = (body = 'hola mundo', overrides: Partial<Parameters<typeof Message.create>[0]> = {}) =>
  Message.create(
    { id: 'msg-1', conversationId: 'conv-1', authorId: 'user-a', seq: 1, body, ...overrides },
    MESSAGING_POLICY
  )

describe('Message — invariants', () => {
  it('create valida el cuerpo: string, no vacío, dentro de la política', () => {
    expect(() => create(123 as unknown as string)).toThrow(InvalidMessageBodyError)
    expect(() => create('')).toThrow(InvalidMessageBodyError)
    expect(() => create('   \n\t ')).toThrow(InvalidMessageBodyError)
    expect(() => create('x'.repeat(MESSAGING_POLICY.maxBodyLength + 1))).toThrow(
      InvalidMessageBodyError
    )

    const tiny = resolveMessagingPolicy({ maxBodyLength: 10 })
    expect(() =>
      Message.create(
        { id: 'm', conversationId: 'c', authorId: 'a', seq: 1, body: '12345678901' },
        tiny
      )
    ).toThrow(InvalidMessageBodyError)
  })

  it('el cuerpo se guarda con trim', () => {
    expect(create('  hola  ').body).toBe('hola')
  })

  it('create valida authorId y seq (invariantes internas)', () => {
    expect(() => create('ok', { authorId: ' ' })).toThrow(MessagingError)
    expect(() => create('ok', { seq: 0 })).toThrow(MessagingError)
    expect(() => create('ok', { seq: 1.5 })).toThrow(MessagingError)
  })

  it('edit: cuerpo idéntico ⇒ false (sin editedAt); distinto ⇒ true + editedAt', () => {
    const m = create('original')
    expect(m.edit('original', MESSAGING_POLICY)).toBe(false)
    expect(m.editedAt).toBeUndefined()

    expect(m.edit('  modificado  ', MESSAGING_POLICY)).toBe(true)
    expect(m.body).toBe('modificado')
    expect(typeof m.editedAt).toBe('number')
  })

  it('edit valida el nuevo cuerpo y no aplica cambios si es inválido', () => {
    const m = create('original')
    expect(() => m.edit('', MESSAGING_POLICY)).toThrow(InvalidMessageBodyError)
    expect(m.body).toBe('original')
    expect(m.editedAt).toBeUndefined()
  })

  it('delete: soft delete con cuerpo vaciado; doble delete ⇒ error', () => {
    const m = create('secreto')
    m.delete()
    expect(m.isDeleted).toBe(true)
    expect(m.body).toBe('') // privacidad: el texto no sobrevive al tombstone
    expect(typeof m.deletedAt).toBe('number')

    expect(() => m.delete()).toThrow(MessageAlreadyDeletedError)
    expect(() => m.edit('otro', MESSAGING_POLICY)).toThrow(MessageAlreadyDeletedError)
  })

  it('toRecord/fromRecord roundtrip preserva identidad y campos opcionales', () => {
    const m = create('v1')
    m.edit('v2', MESSAGING_POLICY)
    const record = m.toRecord()
    expect(record).toMatchObject({
      id: 'msg-1',
      conversationId: 'conv-1',
      authorId: 'user-a',
      seq: 1,
      body: 'v2',
    })
    expect(record.editedAt).toBeTypeOf('number')
    expect(record.deletedAt).toBeUndefined()

    const restored = Message.fromRecord(record)
    expect(restored.toRecord()).toEqual(record)

    m.delete()
    const deleted = Message.fromRecord(m.toRecord())
    expect(deleted.isDeleted).toBe(true)
    expect(deleted.body).toBe('')
  })
})
