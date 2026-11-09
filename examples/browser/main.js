import { createEditor } from '@drawmotive/editor';

const source = document.querySelector('#source');
const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
const file = document.querySelector('#file');
let editor, currentState, working = false;
function refreshControls() {
  buttons.forEach(button => { button.disabled = !editor || leaving || working; });
  for (const action of ['undo','redo']) document.querySelector('#'+action).disabled ||= !currentState?.[action === 'undo' ? 'canUndo' : 'canRedo'];
}
for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => void run(() => editor.setTool(button.dataset.tool), 'Ready to edit'));
for (const action of ['undo','redo']) document.querySelector('#'+action).addEventListener('click', () => void run(() => editor[action](), 'Ready to edit'));
document.querySelector('#editor').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
  if (!(event.target instanceof HTMLElement) || !event.target.closest('.dm-canvas-root')
      || !(event.target.matches('canvas') || event.target.closest('[contenteditable]'))) return;
  void editor?.cancelInteraction().catch(error => { status.textContent = error.message; });
});
let leaving = false;
const startup = new AbortController();

async function run(operation, message) {
  working = true; refreshControls();
  status.textContent = 'Working…';
  try {
    await operation();
    status.textContent = message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    working = false; refreshControls();
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pngBlob(base64) {
  return new Blob([Uint8Array.from(atob(base64), byte => byte.charCodeAt(0))], { type: 'image/png' });
}

document.querySelector('#generate').addEventListener('click', () => {
  void run(async () => { await editor.replaceTextGraph(source.value); await editor.fitViewport(); }, 'Ready to edit');
});
document.querySelector('#download').addEventListener('click', () => {
  void run(async () => download(pngBlob((await editor.exportSnapshot({ formats: ['png'] })).png.base64), 'diagram.png'), 'PNG downloaded');
});
document.querySelector('#save').addEventListener('click', () => {
  void run(async () => download(new Blob([(await editor.exportSnapshot({ formats: ['raw'] })).raw], { type: 'text/plain' }), 'diagram.drawmotive'), 'Document saved');
});
document.querySelector('#open').addEventListener('click', () => file.click());
file.addEventListener('change', () => {
  const selected = file.files[0];
  file.value = '';
  if (selected) void run(async () => { await editor.replaceDocument(await selected.text()); await editor.fitViewport(); }, 'Document opened');
});
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  leaving = true;
  startup.abort();
  void editor?.dispose().catch(error => { status.textContent = error.message; });
});

await run(async () => {
  editor = await createEditor({
    container: document.querySelector('#editor'),
    // With an unbundled module, package-owned assets resolve relative to it.
    assetBaseUrl: new URL('../../generated/editor/', import.meta.url),
    // Optional official branding removal: licenseKey: deploymentLicenseKey,
    signal: startup.signal,
  });
  editor.onStateChanged(state => { currentState = state; refreshControls(); });
  await editor.replaceTextGraph(source.value);
  await editor.fitViewport();
}, 'Ready to edit');
