import { useEffect, useRef } from 'react';
import { getHotkeyHandler, useHotkeys } from '@mantine/hooks';
import type { EditorInstance, EditorSelectionSnapshot, EditorState } from '../core.js';
import type { NormalizedUiOptions } from './ui-options.js';
import { projectSelection, selectionEdit, setModel } from './selection-model.js';
import { selectionSubjects } from './ui-model.js';

interface HotkeyContext {
  editor: EditorInstance; container: HTMLElement; ui: NormalizedUiOptions;
  state(): EditorState; selection(): EditorSelectionSnapshot | null;
  run(action: () => Promise<unknown>, key?: string): Promise<boolean>;
  report(reason: unknown): void;
}

/** Mantine owns key matching. Native methods receive only semantic intent;
 * canvas scope and held-input cleanup stay in the shared browser document. */
export function useEditorHotkeys(context: HotkeyContext) {
  const current = useRef(context); current.current = context;
  const held = useRef(new Set<string>()), pointerButtons = useRef(0);
  const pan = useRef<{ release: boolean; started: Promise<boolean> } | null>(null);
  const modifiers = useRef({ alt: false, shift: false });
  const keyId = (event: KeyboardEvent) => event.code || event.key;
  const nativeHost = () => context.container.querySelector('.drawmotive-canvas-host');
  const canvasTarget = (event: Event) => event.target === nativeHost()?.querySelector('canvas');
  const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 || ['Process', 'Dead', 'Unidentified'].includes(event.key);
  const editable = () => { const state = context.state(); return context.editor.lifecycle === 'ready' && state.editingEnabled && state.health === 'healthy'; };

  function invoke(event: KeyboardEvent, action: () => Promise<unknown>, { busy = false, pointer = false, available = true, key = 'document' } = {}) {
    if (!canvasTarget(event) || composing(event) || !editable()) return;
    // An accepted hold owns browser defaults even while its native command is
    // busy or no longer available (notably Space after acquiring temporary pan).
    if (held.current.has(keyId(event))) { event.preventDefault(); return; }
    if (!available || (!busy && context.state().busy) || (!pointer && pointerButtons.current !== 0)) return;
    if (event.repeat) { event.preventDefault(); return; }
    held.current.add(keyId(event)); event.preventDefault();
    void context.run(action, key);
  }
  function format(event: KeyboardEvent, property: 'bold' | 'italic') {
    const snapshot = context.selection(), selection = snapshot && projectSelection(snapshot);
    const subjects = selection && selectionSubjects(selection.items);
    invoke(event, () => {
      const value = selection!.properties[property], enabled = value.state === 'Uniform' && value.value === true;
      return context.editor.editScene(selectionEdit(selection!, 'Toggle ' + property, item => [
        setModel(item, ['fontStyle', property === 'bold' ? 'weight' : 'slant'], property === 'bold' ? (enabled ? 400 : 700) : (enabled ? 'Upright' : 'Italic')),
      ]));
    }, { available: !!subjects?.length && subjects.every(item => item.capabilities.text) });
  }
  const hotkeys: Parameters<typeof useHotkeys>[0] = [
    ...Object.entries({ a: 'arrow', r: 'rectangle', o: 'ellipse', d: 'diamond', t: 'text' } as const).map(([key, tool]) =>
      [key, (event: KeyboardEvent) => invoke(event, () => context.editor.setTool(tool), { available: context.ui.buttons[tool] })] as Parameters<typeof useHotkeys>[0][number]),
    ['s', event => invoke(event, () => context.editor.setSketchyMode(!context.state().sketchyMode), { available: context.ui.buttons.sketchyMode })],
    ['mod+z', event => invoke(event, () => context.editor.undo(), { available: context.state().canUndo })],
    ['mod+shift+z', event => invoke(event, () => context.editor.redo(), { available: context.state().canRedo })],
    ['mod+y', event => invoke(event, () => context.editor.redo(), { available: context.state().canRedo })],
    ['delete', event => invoke(event, () => context.editor.deleteSelection(context.selection()!.token), { available: !!context.selection()?.items.length })],
    ['mod+c', event => invoke(event, () => context.editor.copyToClipboard(context.selection()!.token), { available: !!context.selection()?.items.length })],
    ['mod+v', event => invoke(event, () => context.editor.pasteFromClipboard())],
    ['mod+b', event => format(event, 'bold')],
    ['mod+i', event => format(event, 'italic')],
    ['enter', event => {
      const snapshot = context.selection(), subject = snapshot && selectionSubjects(snapshot.items)[0];
      invoke(event, () => context.editor.beginTextEditing(subject!.id), { available: context.ui.textEditing !== 'disabled' && !!subject?.capabilities.editText });
    }],
    ['escape', event => {
      const inline = event.target instanceof context.container.ownerDocument.defaultView!.HTMLElement
        && nativeHost()?.contains(event.target) && event.target.matches('[data-testid="d-canvas-content-editable"]');
      if (inline && !composing(event) && editable()) {
        event.preventDefault(); void context.run(() => context.editor.cancelInteraction(), 'interaction');
      } else invoke(event, () => context.editor.cancelInteraction(), { busy: true, pointer: true, key: 'interaction' });
    }],
    ['space', event => invoke(event, () => {
      const session = { release: false, started: context.editor.beginPan() }; pan.current = session;
      return session.started;
    }, { available: !pan.current && context.state().tool === 'select', key: 'pan' })],
  ];
  // Browser defaults are suppressed only after our scope/state guards accept.
  useHotkeys(hotkeys.map(([key, handler]) => [key, handler, { preventDefault: false, usePhysicalKeys: true }]), [], true);

  useEffect(() => {
    const { container } = context, document = container.ownerDocument, window = document.defaultView!;
    function releasePan() {
      const session = pan.current; if (!session || session.release) return;
      session.release = true;
      // Releases must drain even during React cleanup. A UI pending-click guard
      // must not discard the release behind the corresponding acquire request.
      void (async () => {
        try { if (await session.started && current.current.editor.lifecycle === 'ready') await current.current.editor.endPan(); }
        finally { if (pan.current === session) pan.current = null; }
      })().catch(reason => current.current.report(reason));
    }
    function updateModifiers(alt: boolean, shift: boolean) {
      if (modifiers.current.alt === alt && modifiers.current.shift === shift) return;
      modifiers.current = { alt, shift };
      const state = current.current.state();
      if (current.current.editor.lifecycle === 'ready' && state.editingEnabled && state.health === 'healthy')
        void current.current.editor.updateInteractionModifiers({ alt, shift }).catch(reason => current.current.report(reason));
    }
    function reset() {
      const dragging = pointerButtons.current !== 0;
      held.current.clear(); pointerButtons.current = 0; releasePan();
      const state = current.current.state();
      // Browser cancellation has no compatible mouseup. Drain native ownership
      // directly so the next document command cannot inherit a pending gesture.
      if (dragging && current.current.editor.lifecycle === 'ready' && state.editingEnabled && state.health === 'healthy')
        void current.current.editor.cancelInteraction().catch(reason => current.current.report(reason));
      updateModifiers(false, false);
    }
    function pointer(event: PointerEvent) {
      if (canvasTarget(event)) {
        if (['pointercancel', 'lostpointercapture'].includes(event.type)) {
          // Normal pointerup releases capture too; a held Space still owns pan.
          if (event.type === 'pointercancel' || pointerButtons.current !== 0) reset();
          return;
        }
        // Native pointer input already consumed these modifiers. Remember that
        // authority so a later key release can refresh a stationary preview.
        modifiers.current = { alt: event.altKey, shift: event.shiftKey };
        pointerButtons.current = event.buttons;
      } else if (['pointerup', 'pointercancel'].includes(event.type)) pointerButtons.current = event.buttons;
    }
    function modifierKey(event: KeyboardEvent) {
      if (!['Alt', 'Shift'].includes(event.key) || composing(event)) return;
      if (canvasTarget(event) || modifiers.current.alt || modifiers.current.shift) updateModifiers(event.altKey, event.shiftKey);
    }
    const spaceRelease = getHotkeyHandler([['space', releasePan, { preventDefault: false, usePhysicalKeys: true }]]);
    function keyup(event: KeyboardEvent) {
      held.current.delete(keyId(event)); modifierKey(event);
      // An acquired pan must release even after focus or modifiers changed.
      if (pan.current && (event.code === 'Space' || event.key === ' ')) releasePan();
      else spaceRelease(event);
    }
    function focus(event: FocusEvent) { if (!canvasTarget(event)) reset(); }
    function visibility() { if (document.visibilityState === 'hidden') reset(); }
    const pointerEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
    for (const name of pointerEvents) document.addEventListener(name, pointer as EventListener, true);
    document.addEventListener('keydown', modifierKey, true); document.addEventListener('keyup', keyup, true);
    document.addEventListener('focusin', focus, true); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', reset);
    return () => {
      reset();
      for (const name of pointerEvents) document.removeEventListener(name, pointer as EventListener, true);
      document.removeEventListener('keydown', modifierKey, true); document.removeEventListener('keyup', keyup, true);
      document.removeEventListener('focusin', focus, true); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', reset);
    };
  }, [context.editor, context.container]);
}
