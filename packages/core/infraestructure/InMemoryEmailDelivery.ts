import type {
  DeliveryResult,
  EmailDelivery,
  EmailMessage,
} from "../context/EmailDelivery.js";

/** Email enviado + metadata de entrega (entrada del outbox). */
export interface SentEmail extends EmailMessage {
  readonly messageId: string;
  readonly sentAt: number;
}

/**
 * Adaptador de EmailDelivery en memoria: acumula los mensajes en un `outbox`
 * inspeccionable. Para desarrollo, tests y bootstrap — nunca envía nada real.
 *
 * En tests/demo, el token de verificación se extrae del cuerpo del mensaje
 * (igual que un usuario real lo extraería de su bandeja).
 */
export class InMemoryEmailDelivery implements EmailDelivery {
  /** Bandeja de salida inspeccionable (dev/tests). */
  readonly outbox: SentEmail[] = [];

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const messageId = crypto.randomUUID();
    const sentAt = Date.now();
    this.outbox.push({ ...message, messageId, sentAt });
    return { messageId, deliveredAt: sentAt };
  }

  /** Vacía el outbox (entre tests o demos). */
  clear(): void {
    this.outbox.length = 0;
  }
}
