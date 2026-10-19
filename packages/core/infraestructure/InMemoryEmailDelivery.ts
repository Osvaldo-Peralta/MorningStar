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

  private readonly listeners = new Set<() => void>();

  async send(message: EmailMessage): Promise<DeliveryResult> {
    const messageId = crypto.randomUUID();
    const sentAt = Date.now();
    this.outbox.push({ ...message, messageId, sentAt });
    this.notify();
    return { messageId, deliveredAt: sentAt };
  }

  /** Vacía el outbox (entre tests o demos). */
  clear(): void {
    this.outbox.length = 0;
    this.notify();
  }

  /**
   * Suscripción reactiva al outbox (UIs dev como DevOutbox).
   * Devuelve la función de desuscripción.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
