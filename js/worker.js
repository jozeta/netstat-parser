// Module Web Worker: unpacks archives and parses netstat files off the main thread.
import { handleUpload } from "./worker-core.js";

self.onmessage = async (ev) => {
  const { id, files } = ev.data ?? {};
  try {
    const { parsed, notes } = await handleUpload((files ?? []).map((f) => ({ name: String(f.name), bytes: new Uint8Array(f.buffer), tooLarge: f.tooLarge === true })),
      (done, total) => self.postMessage({ id, type: "progress", done, total }));
    self.postMessage({ id, type: "done", parsed, notes });
  } catch (e) {
    self.postMessage({ id, type: "error", message: String(e?.message ?? e) });
  }
};
