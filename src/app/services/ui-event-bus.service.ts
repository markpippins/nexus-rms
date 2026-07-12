import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { environment } from '../../environments/environment';

const EVENT_BUS_URL = environment.uiEventBusUrl;

export interface UiEvent {
  sender: string;
  eventName: string;
  eventValue: unknown;
}

type EventCallback = (event: UiEvent) => void;

/**
 * Shared service for cross-application UI communication via the ui-event-bus.
 *
 * Each Angular app injects this service, providing its own `sender` name.
 * - `publish(eventName, eventValue)` POSTs an event to the bus.
 * - `subscribe(eventName, callback)` listens for SSE events, filtering out self-originated events.
 * - `onLocationChange(callback)` subscribes to location-change events from child apps.
 * - `publishLocationChange(value)` publishes a location-change event (for child apps).
 */
@Injectable({ providedIn: 'root' })
export class UiEventBusService implements OnDestroy {
  private eventSource: EventSource | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private wildcardListeners = new Set<EventCallback>();
  private sender: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private ngZone: NgZone) {
    // Default sender; overridden by connect()
    this.sender = 'unknown';
  }

  /**
   * Initialize the SSE connection for this app.
   * @param sender  Unique name for this app (e.g. 'nexus-console', 'conduit-ui').
   */
  connect(sender: string): void {
    this.sender = sender;
    this.connectSse();
  }

  /**
   * Publish an event to the bus.
   * The server will broadcast it to all SSE clients EXCEPT the sender.
   */
  publish(eventName: string, eventValue: unknown): void {
    const body = JSON.stringify({
      sender: this.sender,
      eventName,
      eventValue,
    });

    fetch(`${EVENT_BUS_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(err => {
      console.warn(`[UiEventBus] publish failed:`, err);
    });
  }

  /**
   * Subscribe to a specific event name. The callback will NOT fire for
   * events published by this app's own sender (server-side filtering).
   */
  subscribe(eventName: string, callback: EventCallback): () => void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(callback);

    return () => {
      this.listeners.get(eventName)?.delete(callback);
    };
  }

  /**
   * Subscribe to ALL events (wildcard). Useful for logging/debugging.
   * Still excludes self-originated events (server-side filtering).
   */
  onAny(callback: EventCallback): () => void {
    this.wildcardListeners.add(callback);
    return () => {
      this.wildcardListeners.delete(callback);
    };
  }

  /**
   * Convenience: subscribe to theme-change events.
   */
  onThemeChange(callback: (theme: string) => void): () => void {
    return this.subscribe('theme-change', (event) => {
      callback(event.eventValue as string);
    });
  }

  /**
   * Convenience: publish a theme-change event.
   */
  publishThemeChange(theme: string): void {
    this.publish('theme-change', theme);
  }

  /**
   * Convenience: subscribe to location-change events.
   */
  onLocationChange(callback: (location: string) => void): () => void {
    return this.subscribe('location-change', (event) => {
      callback(event.eventValue as string);
    });
  }

  /**
   * Convenience: publish a location-change event.
   */
  publishLocationChange(location: string): void {
    this.publish('location-change', location);
  }

  /**
   * Get the current SSE connection state.
   */
  get isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private connectSse(): void {
    if (this.destroyed) return;
    this.disconnect();

    const url = `${EVENT_BUS_URL}/api/events/stream?sender=${encodeURIComponent(this.sender)}`;

    this.ngZone.runOutsideAngular(() => {
      this.eventSource = new EventSource(url);

      this.eventSource.onmessage = (msg) => {
        try {
          const event: UiEvent = JSON.parse(msg.data);

          // Skip system messages (connection ack, etc.)
          if (event.sender === '_system') {
            console.log(`[UiEventBus] system: ${event.eventName}`, event.eventValue);
            return;
          }

          // Dispatch to specific listeners
          const callbacks = this.listeners.get(event.eventName);
          if (callbacks) {
            for (const cb of callbacks) {
              this.ngZone.run(() => cb(event));
            }
          }

          // Dispatch to wildcard listeners
          for (const cb of this.wildcardListeners) {
            this.ngZone.run(() => cb(event));
          }
        } catch (err) {
          console.warn(`[UiEventBus] failed to parse event:`, err);
        }
      };

      this.eventSource.onerror = () => {
        console.warn(`[UiEventBus] SSE connection lost, reconnecting in 3s...`);
        this.eventSource?.close();
        this.eventSource = null;
        if (!this.destroyed) {
          this.reconnectTimer = setTimeout(() => this.connectSse(), 3000);
        }
      };
    });
  }
}
