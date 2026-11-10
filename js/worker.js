// Module Web Worker: parses netstat files off the main thread.
import { handleBatch } from "./worker-core.js";

self.onmessage = (ev) => {
  const { id, files } = ev.data ?? {};
  try {
    const parsed = handleBatch((files ?? []).map((f) => ({ name: String(f.name), bytes: new Uint8Array(f.buffer), tooLarge: f.tooLarge === true })),
      (done, total) => self.postMessage({ id, type: "progress", done, total }));
    self.postMessage({ id, type: "done", parsed });
  } catch (e) {
    self.postMessage({ id, type: "error", message: String(e?.message ?? e) });
  }
};
