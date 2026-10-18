// core/context/EmailDelivery.ts

/**
 * Puerto de entrega de emails (ADR-0006).
 *
 * Capacidad abstracta de infraestructura: el dominio compone mensajes y los
 * entrega por este puerto sin conocer el proveedor (InMemory para dev/tests;
 * SMTP/SES/etc. cuando exista backend). Lo consumen identity (verificación de
 * email) y, en Fase 4, authentication (reset de contraseña).
 */

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly body: string
}

export interface DeliveryResult {
  readonly messageId: string
  readonly deliveredAt: number
}

export interface EmailDelivery {
  send(message: EmailMessage): Promise<DeliveryResult>
}
