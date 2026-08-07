// @gosleep/core — per-endpoint mutex for POST /actions/* (GSL-268).
//
// Target-architecture rev-2 section 6.2 says every write endpoint runs at concurrency=1 — a
// second POST to the SAME endpoint arriving before the first finishes must serialize behind it,
// never interleave. This matters because:
//
//   - lab-emit.sh takes a mkdir lock on docs/lab/questions/queue.jsonl; two concurrent
//     lab-emit spawns would still serialize inside the lock, but the second call would waste
//     a bash process spin-up.
//   - The direct UPDATE questions on `answer` reads status='open' then writes 'answered'. Two
//     concurrent calls could both read 'open' and both write 'answered' — the second one
//     silently overwriting the first. A per-endpoint mutex closes that race.
//
// The mutex is per-endpoint, NOT global — an answer POST does not block a tick POST. Bun's
// event loop is single-threaded so the mutex is a simple promise chain: enqueue behind the
// previous chain, resolve when done.
//
// The mutex only serializes WITHIN THIS PROCESS. There is exactly one core process (launchd's
// `com.gosleep.core.plist`, single-instance) so process-wide serialization is enough.

type Endpoint = string;

const chain: Map<Endpoint, Promise<void>> = new Map();

/**
 * Serialize `fn` behind any prior call for the same `endpoint`. Returns whatever fn returns.
 * If fn throws, the mutex still releases (the chain is guarded so one failure does not deadlock
 * the endpoint for the rest of the process life).
 */
export async function serialize<T>(endpoint: Endpoint, fn: () => Promise<T>): Promise<T> {
  const prev = chain.get(endpoint) ?? Promise.resolve();
  let releaseNext: () => void = () => undefined;
  const next = new Promise<void>((r) => {
    releaseNext = r;
  });
  chain.set(endpoint, next);
  try {
    await prev;
    return await fn();
  } finally {
    releaseNext();
    // Best-effort cleanup: if this call was the last in the chain, drop the entry so the map
    // does not grow indefinitely with dead promises. A newer serialize() overwrote us? Leave
    // it alone.
    if (chain.get(endpoint) === next) chain.delete(endpoint);
  }
}
