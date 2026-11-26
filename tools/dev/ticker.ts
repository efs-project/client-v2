// The dev chain mines on a timer as well as per transaction. Anvil's automine makes a block only
// when a transaction arrives, so on a quiet chain nothing judged at the latest block moves: the
// SDK's finality (the endpoint's `finalized` block, 64 behind latest on anvil) and a held save's
// deadline (the latest block's timestamp) would wait for someone else's transaction. One empty
// block a second makes 64 blocks about a minute. `pnpm dev` and `pnpm demo` only: the tests'
// recorded and replayed chains never tick, so their transcripts stay deterministic.

/** Seconds between the dev chain's timed blocks. */
export const DEV_BLOCK_SECONDS = 1;

/** Something that sends one JSON-RPC request (the chain's own `fetch` in production). */
export type PostRpc = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Mines an empty block on `rpcUrl` every `seconds`, keeping automine on; returns the stop. A tick
 * is skipped while the last one is unanswered, and a failed one (the chain stopping) is ignored.
 */
export function startBlockTicker(
  rpcUrl: string,
  { seconds = DEV_BLOCK_SECONDS, post = fetch as PostRpc } = {},
): () => void {
  let pending = false;
  let id = 0;
  const timer = setInterval(() => {
    if (pending) return;
    pending = true;
    post(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'evm_mine', params: [] }),
    })
      .catch(() => undefined)
      .finally(() => {
        pending = false;
      });
  }, seconds * 1000);
  // Never what keeps the process alive: shutdown decides that.
  timer.unref();
  return () => clearInterval(timer);
}
