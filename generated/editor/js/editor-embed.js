import { closeDatabase } from "../_content/Blazor.IndexedDB/Blazor.IndexedDB.js";

// A one-time parent/nonce handshake gives each isolated runtime its own port.
const nonce = new URLSearchParams(location.hash.slice(1)).get("nonce");
if (parent === window || !nonce || !/^[a-zA-Z0-9-]{16,128}$/.test(nonce))
  throw new Error("A valid DrawMotive embedding context is required.");
const drawingId = "drawmotive-embed-" + crypto.randomUUID();
let port;
let options;
let reference;
let ready = false;
let disposed = false;
let tail = Promise.resolve();
let actionSequence = 0;
const actions = new Map();
const methods = new Set(["replaceDocument", "replacePngDocument", "replaceTextGraph", "clearDocument",
  "exportSnapshot", "fitViewport", "setEditingEnabled", "undo", "redo", "getState", "setActionState", "dispose"]);
const send = message => { if (port && !disposed) port.postMessage(message); };
const failure = error => ({ code: error.code ?? "OperationFailed", message: error.message ?? String(error) });
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

globalThis.drawmotiveEmbed = Object.freeze({
  getDrawingId: () => drawingId,
  getOptions: () => JSON.stringify(options),
  failed: error => send({ type: "error", error: typeof error === "string" ? { code: "StartupFailed", message: error } : failure(error) }),
  ready: (dotnetReference, stateJson) => {
    reference = dotnetReference;
    ready = true;
    send({ type: "ready", protocolVersion: 2, state: JSON.parse(stateJson) });
  },
  stateChanged: stateJson => send({ type: "state", state: JSON.parse(stateJson) }),
  // Reverse calls never occupy the document queue: a host handler may call export or dispose.
  invokeAction: actionId => {
    if (!ready || disposed) return Promise.reject(new Error("Editor is not ready."));
    const id = "action-" + ++actionSequence;
    return new Promise((resolve, reject) => {
      actions.set(id, { resolve, reject });
      send({ type: "action", id, actionId });
    });
  },
});

async function execute(request) {
  try {
    if (!reference || disposed) throw new Error("Editor is not ready.");
    if (!methods.has(request.method)) throw new TypeError("Unsupported editor operation.");
    const response = JSON.parse(await reference.invokeMethodAsync("ExecuteEmbeddedAsync", request.method, JSON.stringify(request.args ?? {})));
    send({ type: "response", id: request.id, ...response });
    if (request.method === "dispose" && !response.error) {
      disposed = true;
      ready = false;
      for (const pending of actions.values()) pending.reject(new Error("Editor was disposed."));
      actions.clear();
      port.close();
    }
  } catch (error) {
    send({ type: "response", id: request.id, error: failure(error) });
  }
}

function onPortMessage(event) {
  const message = event.data;
  if (!message || typeof message.id !== "string") return;
  if (message.type === "actionResult") {
    const pending = actions.get(message.id);
    if (!pending) return;
    actions.delete(message.id);
    if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else pending.resolve();
    return;
  }
  if (message.type !== "request") return;
  tail = tail.then(() => execute(message));
}

async function connect(event) {
  const message = event.data;
  if (port || event.source !== parent || message?.type !== "drawmotive:connect"
      || message.nonce !== nonce || message.protocolVersion !== 2 || event.ports.length !== 1) return;
  port = event.ports[0];
  removeEventListener("message", connect);
  port.onmessage = onPortMessage;
  port.start();
  try {
    if (!message.options || typeof message.options !== "object") throw new TypeError("Missing creation options.");
    options = freeze(message.options);
    await Blazor.start();
  } catch (error) {
    globalThis.drawmotiveEmbed.failed(error);
    document.getElementById("app").textContent = "The editor could not start.";
  }
}
addEventListener("message", connect);
parent.postMessage({ type: "drawmotive:hello", protocolVersion: 2 }, "*");

// Teardown closes the native handle synchronously; database deletion is best effort after page exit.
addEventListener("pagehide", () => {
  disposed = true;
  ready = false;
  for (const pending of actions.values()) pending.reject(new Error("Editor was closed."));
  actions.clear();
  port?.close();
  try { closeDatabase(drawingId); } catch { /* Storage may never have opened. */ }
  indexedDB.deleteDatabase(drawingId);
});
