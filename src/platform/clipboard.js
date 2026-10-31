import { EditorError } from '../errors.js';
const prefix = 'drawmotive/selection:1\n';
const invalid = () => new EditorError('ClipboardFormatUnsupported', 'The clipboard does not contain a DrawMotive selection.');
function selection(value) {
  if (!value || value.version !== 1 || typeof value.data !== 'string' || !value.data.length || value.data.length > 32 * 1024 * 1024
      || /[^A-Za-z0-9+/=]/.test(value.data) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) throw invalid();
  return Object.freeze({version:1,data:value.data});
}
export const encodeSelection = payload => prefix + selection(payload).data;
export function decodeSelection(text) {
  if (typeof text !== 'string' || !text.startsWith(prefix)) throw invalid();
  return selection({version:1,data:text.slice(prefix.length)});
}

/** Host JS owns both system access and the instance-local copy. Engine bytes stay opaque. */
export function createEditorClipboard(editor, { clipboard, ClipboardItem, Blob = globalThis.Blob, getPastePosition } = {}) {
  let internal, disposed = false, copyGeneration = 0;
  const active = () => { if (disposed) throw new EditorError('EditorDisposed', 'Editor has been disposed'); };
  return Object.freeze({
    async copy(token, options = {}) {
      active();
      if (options.system !== undefined && typeof options.system !== 'boolean') throw new TypeError('system must be a boolean');
      const generation = ++copyGeneration;
      const payload = Promise.resolve(editor.copySelection(token)).then(value => { active(); const stable = selection(value); if(generation === copyGeneration)internal = stable; return stable; });
      // Promise-backed ClipboardItem starts the privileged operation during the
      // original user gesture, before awaiting the asynchronous C# transfer.
      let system;
      if (options.system !== false && clipboard?.write && ClipboardItem && Blob) {
        const data = payload.then(value => new Blob([encodeSelection(value)],{type:'text/plain'}));
        void data.catch(() => {}); // The browser may reject the constructor before consuming the provider.
        try { system = Promise.resolve(clipboard.write([new ClipboardItem({'text/plain':data})])).then(()=>'written',()=>'denied'); }
        catch { system = Promise.resolve('denied'); }
      }
      const value = await payload;
      if (!system) {
        if (options.system === false) system = Promise.resolve('skipped');
        else if (clipboard?.writeText) {
          try { system = Promise.resolve(clipboard.writeText(encodeSelection(value))).then(()=>'written',()=>'denied'); }
          catch { system = Promise.resolve('denied'); }
        } else system = Promise.resolve('unavailable');
      }
      const outcome = await system; active();
      return Object.freeze({internal:true,system:outcome});
    },
    async paste(position, {source = 'auto'} = {}) {
      active();
      if (position === undefined && !getPastePosition || position !== undefined && (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y))) throw new TypeError('A finite drawing position is required');
      // Capture explicit intent before system access yields to the browser.
      const target = position === undefined ? undefined : {x:position.x,y:position.y};
      if (!['auto','internal','system'].includes(source)) throw new TypeError('source must be auto, internal or system');
      let payload;
      if (source !== 'internal') {
        let text, readable = false;
        if (clipboard?.readText) {
          try { text = await clipboard.readText(); readable = true; }
          catch { if(source === 'system') throw new EditorError('ClipboardPermissionDenied','System clipboard permission was denied.'); }
        } else if(source === 'system') throw new EditorError('ClipboardUnavailable','The system clipboard is unavailable.');
        active();
        // A successful read of unrelated text must never resurrect an old copy.
        if(readable) payload = decodeSelection(text);
      }
      payload ??= internal;
      if (!payload) throw new EditorError('ClipboardEmpty','Copy a selection first.');
      // Default placement is native model space, read only after privileged
      // clipboard access has started during the original browser gesture.
      const resolved = target ?? await getPastePosition();
      active();return editor.pasteSelection(payload,resolved);
    },
    dispose() { disposed = true; internal = undefined; },
  });
}
