import assert from 'node:assert/strict';
import test from 'node:test';

const options = await import('../src/react/ui-options-runtime.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
function normalize(value) {
  assert.equal(typeof options.normalizeUiOptions, 'function', 'The shared UI option normalizer must be available');
  return options.normalizeUiOptions(value);
}

test('the full UI defaults preserve each region, toolbar and independent inline text editing', () => {
  const { ui, handlers } = normalize();
  assert.equal(ui.enabled, true);
  assert.deepEqual(Object.keys(ui.regions), ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
  for (const region of Object.values(ui.regions)) assert.equal(region.visible, true);
  assert.equal(ui.drawingToolbar.visible, true);
  assert.equal(ui.contextToolbar.visible, true);
  assert.equal(ui.textEditing, 'inline');
  assert.equal(ui.buttons.help, false);
  assert.equal(ui.buttons.rectangle, true);
  assert.deepEqual([...handlers], []);
  assert.ok(Object.isFrozen(ui));
  assert.ok(Object.isFrozen(ui.regions.topLeft.items));
  assert.deepEqual(ui.drawingToolbar.tools,['arrow','rectangle','ellipse','diamond','text']);
  assert.deepEqual(ui.regions.bottomRight.items,['sketchyMode','zoomOut','resetZoom','zoomIn','settings']);
});

test('each corner and toolbar has independent visibility and text editing stays inline', () => {
  const { ui } = normalize({ regions: { topLeft: false, bottomRight: { visible: false } }, drawingToolbar: false, contextToolbar: false });
  assert.equal(ui.regions.topLeft.visible, false);
  assert.equal(ui.regions.topRight.visible, true);
  assert.equal(ui.regions.bottomLeft.visible, true);
  assert.equal(ui.regions.bottomRight.visible, false);
  assert.equal(ui.drawingToolbar.visible, false);
  assert.equal(ui.contextToolbar.visible, false);
  assert.equal(ui.textEditing, 'inline');
});

test('the no-UI configuration keeps text editing independently configurable', () => {
  const { ui } = normalize(false);
  assert.equal(ui.enabled, false);
  assert.equal(ui.textEditing, 'inline');
  for (const region of Object.values(ui.regions)) assert.equal(region.visible, false);
  assert.equal(ui.drawingToolbar.visible, false);
  assert.equal(ui.contextToolbar.visible, false);
  for (const textEditing of ['inline', 'external', 'disabled']) {
    const normalized = normalize({ enabled: false, textEditing }).ui;
    assert.equal(normalized.textEditing, textEditing);
    assert.equal(normalized.drawingToolbar.visible, false);
  }
});

test('host actions retain their stable IDs and handlers never enter the transferable UI descriptor', () => {
  const handler = () => {};
  const input = {
    buttons: { redo: false },
    actions: [{ id: 'host.save', label: 'Save', onInvoke: handler }],
    regions: { topRight: { items: ['host.save', 'settings', 'slot.account'] } },
    drawingToolbar: { position: 'bottom', tools: ['text', 'rectangle'] },
    contextToolbar: { objectTypes: ['text'], tools: ['fontFamily', 'fill'], panels: ['fill'] },
  };
  const { ui, handlers } = normalize(input);
  assert.equal(handlers.get('host.save'), handler);
  assert.deepEqual(ui.actions, [{ id: 'host.save', label: 'Save', enabled: true, visible: true }]);
  assert.deepEqual(ui.regions.topRight.items, ['host.save', 'settings', 'slot.account']);
  assert.deepEqual(ui.drawingToolbar.tools, ['text', 'rectangle']);
  assert.equal(ui.drawingToolbar.position, 'bottom');
  assert.deepEqual(ui.contextToolbar.objectTypes, ['text']);
  assert.equal(ui.buttons.redo, false);
  assert.deepEqual(structuredClone(ui), ui);
  input.regions.topRight.items.push('undo');
  assert.deepEqual(ui.regions.topRight.items, ['host.save', 'settings', 'slot.account']);
});

test('hidden buttons do not disable inline editing or remove semantic capabilities', () => {
  const { ui } = normalize({ buttons: { text: false }, drawingToolbar: { visible: false }, textEditing: 'inline' });
  assert.equal(ui.buttons.text, false);
  assert.equal(ui.textEditing, 'inline');
  assert.equal('editingEnabled' in ui, false);
  assert.equal('capabilities' in ui, false);
});

test('unknown, ambiguous and non-transferable UI options are rejected at the public boundary', () => {
  for (const invalid of [
    { toolbar: false }, { regions: { center: false } }, { regions: { topLeft: { enabled: false } } },
    { regions: { topLeft: { items: ['unknown'] } } }, { regions: { topRight: { items: ['host.unknown'] } } },
    { regions: { topLeft: { items: ['undo', 'undo'] } } }, { regions: { topLeft: { items: [() => {}] } } },
    { drawingToolbar: { tools: ['save'] } }, { drawingToolbar: { position: 'floating' } },
    { contextToolbar: { tools: ['fill', 'fill'] } }, { textEditing: 'none' },
    { buttons: { save: true } }, { buttons: { undo: 'yes' } },
    { actions: [{ id: 'save', label: 'Save', onInvoke() {} }] },
    { actions: [{ id: 'host.save', label: 'Save' }] },
    { actions: [{ id: 'host.save', label: 'A', onInvoke() {} }, { id: 'host.save', label: 'B', onInvoke() {} }] },
    { enabled: 0 }, null, [],
  ]) assert.throws(() => normalize(invalid), TypeError);
});

test('host actions and React slots require a literal namespace separator', () => {
  assert.throws(() => normalize({ actions: [{ id: 'hostXsave', label: 'Save', onInvoke() {} }] }), TypeError);
  assert.throws(() => normalize({ regions: { topLeft: { items: ['slotXaccount'] } } }), TypeError);
});
test('tooltip visibility, direction and delay are validated independently of text editing', () => {
  assert.deepEqual(normalize({tooltip:false}).ui.tooltip, {visible:false,position:'top',delay:250});
  assert.deepEqual(normalize({tooltip:{position:'right',delay:0}}).ui.tooltip, {visible:true,position:'right',delay:0});
  for (const tooltip of [{delay:-1}, {delay:NaN}, {position:'diagonal'}, {visible:'no'}])
    assert.throws(() => normalize({tooltip}), TypeError);
  assert.equal(normalize(false).ui.textEditing, 'inline');
});
