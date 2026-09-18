import { closeDatabase } from "../_content/Blazor.IndexedDB/Blazor.IndexedDB.js";

// The parent origin and unguessable channel bind this one runtime to its embedding window.
const parameters = new URLSearchParams(location.hash.slice(1));
const channel = parameters.get("channel");
const parentOrigin = parameters.get("parentOrigin");
const origin = new URL(parentOrigin ?? "invalid:");
if (parent === window || !/^https?:$/.test(origin.protocol) || origin.origin !== parentOrigin
    || !channel || !/^[a-zA-Z0-9-]{16,128}$/.test(channel)) {
  throw new Error("A valid DrawMotive editor embedding context is required.");
}
const drawingId = `drawmotive-embed-${crypto.randomUUID()}`;
let reference;
let tail = Promise.resolve();
let disposed = false;
const send = (message) => parent.postMessage({ ...message, channel }, parentOrigin);

globalThis.drawmotiveEmbed = Object.freeze({
  getDrawingId: () => drawingId,
  failed: (error) => send({ type: "error", error }),
  ready: (dotnetReference) => {
    reference = dotnetReference;
    send({ type: "ready", protocolVersion: 1 });
  },
});

addEventListener("message", (event) => {
  const request = event.data;
  if (event.source !== parent || event.origin !== parentOrigin || request?.channel !== channel
      || request.type !== "request" || typeof request.id !== "string") return;
  // Imports and exports share a queue so exported data always reflects the preceding completed import.
  tail = tail.then(async () => {
    try {
      if (!reference || disposed) throw new Error("Editor is not ready.");
      if (!["export", "importDocument", "importTextGraph", "dispose"].includes(request.method))
        throw new Error("Unsupported editor operation.");
      if (request.method.startsWith("import") && typeof request.payload !== "string")
        throw new TypeError("Import payload must be a string.");
      document.getElementById("app").inert = true;
      const result = await reference.invokeMethodAsync("ExecuteEmbeddedAsync", request.method, request.payload ?? null);
      if (request.method === "dispose") {
        disposed = true;
        closeDatabase(drawingId);
        indexedDB.deleteDatabase(drawingId);
      }
      send({ type: "response", id: request.id, result: result == null ? null : JSON.parse(result) });
    } catch (error) {
      send({ type: "response", id: request.id, error: error.message ?? String(error) });
    } finally {
      document.getElementById("app").inert = disposed;
    }
  });
});

// Closing the handle synchronously lets native deletion finish even when the iframe is removed.
addEventListener("pagehide", () => {
  try { closeDatabase(drawingId); } catch { /* Startup may fail before storage opens. */ }
  indexedDB.deleteDatabase(drawingId);
});

try {
  await Blazor.start();
} catch (error) {
  send({ type: "error", error: error.message ?? String(error) });
  document.getElementById("app").textContent = "The editor could not start.";
}
