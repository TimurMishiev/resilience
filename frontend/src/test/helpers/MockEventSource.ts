/**
 * Simulates a real EventSource with controllable lifecycle for SSE hook tests.
 * Shared across useEventSource, useSignalStream, and useTelemetryStream tests.
 */
export class MockEventSource {
  static instances: MockEventSource[] = []

  public readonly url: string
  public readonly listeners = new Map<string, EventListener[]>()
  public onerror: ((this: EventSource, ev: Event) => unknown) | null = null
  public closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  close() {
    this.closed = true
  }

  // Test helpers
  emit(type: string, data?: unknown) {
    const event =
      data !== undefined
        ? ({ data: JSON.stringify(data) } as MessageEvent)
        : ({} as Event)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  triggerError() {
    this.onerror?.call(this as unknown as EventSource, new Event('error'))
  }
}
