import type { StreamEvent } from "../contract/schema.js";

export type BusListener = (event: StreamEvent) => void;

export type Bus = {
  publish(event: StreamEvent): void;
  subscribe(listener: BusListener): () => void;
};

export function createBus(): Bus {
  const listeners = new Set<BusListener>();
  return {
    publish(event): void {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
