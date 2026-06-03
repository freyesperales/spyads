import type { ProgressEvent } from "./types";

/**
 * In-memory per-scan event bus.
 *
 * Stores the full history of progress events plus a list of live SSE
 * listeners. New connections get a replay of the history before live
 * events. When the scan finishes we push a sentinel "done" event and
 * close all listeners.
 */

export type BusEvent =
  | { kind: "progress"; data: ProgressEvent }
  | { kind: "done"; data: { resultCount: number } }
  | { kind: "error"; data: { message: string } };

type Listener = (ev: BusEvent) => void;

interface Channel {
  history: BusEvent[];
  listeners: Set<Listener>;
  closed: boolean;
}

const channels = new Map<string, Channel>();

function ensure(scanId: string): Channel {
  let c = channels.get(scanId);
  if (!c) {
    c = { history: [], listeners: new Set(), closed: false };
    channels.set(scanId, c);
  }
  return c;
}

export function emit(scanId: string, ev: BusEvent): void {
  const c = ensure(scanId);
  c.history.push(ev);
  for (const l of c.listeners) {
    try {
      l(ev);
    } catch {
      /* ignore listener errors */
    }
  }
  if (ev.kind === "done" || ev.kind === "error") {
    c.closed = true;
  }
}

export interface Subscription {
  unsubscribe(): void;
}

export function subscribe(
  scanId: string,
  listener: Listener,
  opts: { replay?: boolean } = {},
): Subscription {
  const c = ensure(scanId);
  if (opts.replay !== false) {
    for (const h of c.history) listener(h);
  }
  if (c.closed) {
    return { unsubscribe(): void {} };
  }
  c.listeners.add(listener);
  return {
    unsubscribe(): void {
      c.listeners.delete(listener);
    },
  };
}

export function isClosed(scanId: string): boolean {
  return channels.get(scanId)?.closed ?? false;
}

/** Test helper. */
export function resetBus(): void {
  channels.clear();
}
