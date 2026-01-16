/**
 * BunSSEBroadcaster: SSE client management for Bun
 *
 * Uses ReadableStream instead of Express Response for SSE streaming
 */

import { logger } from '../../utils/logger.js';
import type { SSEEvent } from '../worker-types.js';

interface SSEClient {
  controller: ReadableStreamDefaultController;
  closed: boolean;
}

export class BunSSEBroadcaster {
  private sseClients: Set<SSEClient> = new Set();

  /**
   * Create a new SSE stream
   */
  createStream(): ReadableStream {
    let client: SSEClient | null = null;

    const stream = new ReadableStream({
      start: (controller) => {
        client = {
          controller,
          closed: false
        };

        this.sseClients.add(client);
        logger.debug('WORKER', 'Client connected', { total: this.sseClients.size });

        // Send initial event
        const initialEvent = { type: 'connected', timestamp: Date.now() };
        const data = `data: ${JSON.stringify(initialEvent)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      },

      cancel: () => {
        if (client) {
          client.closed = true;
          this.sseClients.delete(client);
          logger.debug('WORKER', 'Client disconnected', { total: this.sseClients.size });
        }
      }
    });

    return stream;
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: SSEEvent): void {
    if (this.sseClients.size === 0) {
      logger.debug('WORKER', 'SSE broadcast skipped (no clients)', { eventType: event.type });
      return;
    }

    const eventWithTimestamp = { ...event, timestamp: Date.now() };
    const data = `data: ${JSON.stringify(eventWithTimestamp)}\n\n`;
    const encoded = new TextEncoder().encode(data);

    logger.debug('WORKER', 'SSE broadcast sent', { eventType: event.type, clients: this.sseClients.size });

    // Broadcast to all clients, removing closed ones
    for (const client of this.sseClients) {
      if (client.closed) {
        this.sseClients.delete(client);
        continue;
      }

      try {
        client.controller.enqueue(encoded);
      } catch (error) {
        // Client likely disconnected
        client.closed = true;
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.sseClients.size;
  }
}
