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
function pngBytes(value) {
  if (typeof value !== 'string' || !value.length) throw new EditorError('ClipboardImageUnavailable', 'The engine did not provide a PNG selection image.');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (![137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte)) throw new EditorError('ClipboardImageUnavailable', 'The selection image is not PNG.');
  return bytes;
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
      const imageSupported = options.system !== false && clipboard?.write && ClipboardItem && Blob;
      const captured = Promise.resolve(editor.copySelection(token, {png:!!imageSupported})).then(value => {
        active(); const stable = selection(value); if(generation === copyGeneration)internal = stable;
        return {payload:stable,png:value.png};
      });
      // Promise-backed ClipboardItem starts the privileged operation during the
      // original user gesture, before awaiting the asynchronous C# transfer.
      let system;
      if (imageSupported) {
        const data = captured.then(value => { active(); return new Blob([encodeSelection(value.payload)],{type:'text/plain'}); });
        const image = captured.then(value => { active(); return new Blob([pngBytes(value.png)],{type:'image/png'}); });
        // Browsers may reject construction before consuming either provider.
        void data.catch(() => {}); void image.catch(() => {});
        try { system = Promise.resolve(clipboard.write([new ClipboardItem({'text/plain':data,'image/png':image})])).then(()=>'written',()=>'denied'); }
        catch { system = Promise.resolve('denied'); }
      }
      const {payload:value} = await captured;
      active(); // Disposal may occur between payload validation and this continuation.
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
      // A later copy must not change the fallback for this paste gesture.
      const fallback = internal;
      let reading;
      if (source !== 'internal') {
        if (clipboard?.readText) {
          const denied = () => { if(source === 'system') throw new EditorError('ClipboardPermissionDenied','System clipboard permission was denied.'); };
          try { reading = Promise.resolve(clipboard.readText()).then(text => ({text}), denied); }
          catch { reading = Promise.resolve().then(denied); }
        } else if(source === 'system') throw new EditorError('ClipboardUnavailable','The system clipboard is unavailable.');
      }
      // Start privileged access first, then capture model placement immediately.
      // Consume early placement failure even if reading or decoding fails first.
      const placement = new Promise(resolve => resolve(target ?? getPastePosition()));
      void placement.catch(() => {});
      const result = await reading;
      active();
      // A successful read of unrelated text must never resurrect an old copy.
      const payload = result ? decodeSelection(result.text) : fallback;
      if (!payload) throw new EditorError('ClipboardEmpty','Copy a selection first.');
      const resolved = await placement;
      active();return editor.pasteSelection(payload,resolved);
    },
    dispose() { disposed = true; internal = undefined; },
  });
}
