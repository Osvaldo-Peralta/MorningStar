import { describe, it, expect, vi } from 'vitest'
import { InMemoryEmailDelivery } from './InMemoryEmailDelivery.js'

describe('InMemoryEmailDelivery', () => {
  it('send acumula en el outbox con metadata de entrega', async () => {
    const delivery = new InMemoryEmailDelivery()

    const result = await delivery.send({ to: 'a@b.c', subject: 'Hola', body: 'Mensaje' })

    expect(result.messageId).toBeTruthy()
    expect(delivery.outbox).toHaveLength(1)
    expect(delivery.outbox[0]).toMatchObject({ to: 'a@b.c', subject: 'Hola', body: 'Mensaje' })
  })

  it('subscribe notifica en cada envío y la desuscripción detiene las notificaciones', async () => {
    const delivery = new InMemoryEmailDelivery()
    const listener = vi.fn()

    const unsubscribe = delivery.subscribe(listener)
    await delivery.send({ to: 'a@b.c', subject: 's1', body: 'b1' })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    await delivery.send({ to: 'a@b.c', subject: 's2', body: 'b2' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(delivery.outbox).toHaveLength(2)
  })

  it('clear vacía el outbox y notifica', async () => {
    const delivery = new InMemoryEmailDelivery()
    const listener = vi.fn()
    delivery.subscribe(listener)
    await delivery.send({ to: 'a@b.c', subject: 's', body: 'b' })

    delivery.clear()

    expect(delivery.outbox).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(2) // send + clear
  })
})
