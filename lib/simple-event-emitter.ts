type Listener<T> = (payload: T) => void;

export class SimpleEventEmitter<TEvents extends Record<string, unknown>> {
  private listeners = new Map<keyof TEvents, Set<Listener<any>>>();

  on<TKey extends keyof TEvents>(event: TKey, listener: Listener<TEvents[TKey]>) {
    const current = this.listeners.get(event) ?? new Set();
    current.add(listener);
    this.listeners.set(event, current);
  }

  off<TKey extends keyof TEvents>(event: TKey, listener: Listener<TEvents[TKey]>) {
    this.listeners.get(event)?.delete(listener);
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]) {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }

  removeAllListeners() {
    this.listeners.clear();
  }
}
