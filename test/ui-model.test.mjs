import test from 'node:test';
import assert from 'node:assert/strict';
import { contextTools, placeFloating, mapCanvasBounds } from '../src/react/ui-model.js';
import { normalizeUiOptions } from '../src/react/ui-options-runtime.js';

const caps = { stroke: true, fill: true, cornerRadius: true, editText: true, text: false, line: false, group: false, groupTitle: false, verticalTextAlignment: false, connectorRouting: false };
const item = (capabilities, kind = 'Shape') => ({ id: kind, kind, capabilities: { ...caps, ...capabilities } });
const config = options => normalizeUiOptions(options).ui.contextToolbar;

test('context tools preserve shape, line, text and group capabilities', () => {
  assert.deepEqual(contextTools([item({})], config()), ['strokeFillColor','strokeStyle','cornerRadius','editText','moreOptions']);
  const line = contextTools([item({ fill: false, cornerRadius: false, line: true }, 'Line')], config());
  assert.deepEqual(line, ['lineStartStyle','swapLineEndpoints','lineEndStyle','lineRouting','lineAttachment','strokeColor','strokeStyle','editText','moreOptions']);
  const text = contextTools([item({ fill: false, cornerRadius: false, text: true }, 'IndependentText')], config());
  assert.deepEqual(text, ['strokeColor','textSizeSmall','textSizeMedium','textSizeLarge','bold','italic','textAlign','editText','moreOptions']);
  const group = contextTools([item({ group: true, groupTitle: true }, 'Group')], config());
  assert.deepEqual(group.slice(0, 2), ['groupTheme','groupTitleStyle']);
});

test('mixed selections expose only common capabilities and explicit filters are respected', () => {
  assert.deepEqual(contextTools([item({}), item({ fill: false, cornerRadius: false, line: true }, 'Line')], config()), ['strokeColor','strokeStyle','moreOptions']);
  assert.deepEqual(contextTools([item({})], config({contextToolbar:false})), []);
  assert.deepEqual(contextTools([item({})], config({contextToolbar:{objectTypes:['Line']}})), []);
  assert.deepEqual(contextTools([item({})], config({contextToolbar:{tools:['strokeFillColor','editText'],panels:[]}})), ['editText']);
  assert.deepEqual(contextTools([], config()), []);
});

test('floating chrome clamps to small viewports and moves below the item when needed', () => {
  assert.deepEqual(placeFloating({left:290,top:10,right:310,bottom:40},{width:120,height:32},{width:320,height:200}), {left:196,top:50});
  assert.deepEqual(placeFloating({left:-20,top:100,right:30,bottom:120},{width:400,height:300},{width:320,height:200}), {left:4,top:4});
});

test('anchor mapping accounts for iframe offset and CSS scaling of the editor container', () => {
  assert.deepEqual(mapCanvasBounds({left:10,top:20,right:30,bottom:40}, {left:140,top:260,width:400,height:200}, {width:200,height:100}, {left:100,top:200,width:800,height:600}, {width:400,height:300}), {left:30,top:50,right:50,bottom:70});
});
test('owner plus its selected bound label keeps the text focus toolbar', () => {
  const owner=item({});
  const label={...item({text:true,stroke:false,fill:false,cornerRadius:false},'BoundText'),bindingItemId:owner.id};
  assert.deepEqual(contextTools([owner,label], config()), contextTools([label], config()));
});
