export const CONTEXT_TOOL_IDS = Object.freeze(['strokeFillColor','strokeColor','strokeStyle','cornerRadius','editText',
  'textSizeSmall','textSizeMedium','textSizeLarge','bold','italic','textAlign','lineStartStyle','lineEndStyle',
  'swapLineEndpoints','lineRouting','lineAttachment','groupTheme','groupTitleStyle','moreOptions']);
export const CONTEXT_PANEL_IDS = Object.freeze(['strokeFillColor','strokeColor','strokeStyle','textAlign',
  'lineStartStyle','lineEndStyle','lineRouting','lineAttachment','groupTitleStyle','moreOptions']);
export function selectionSubjects(items) {
  const focused = items.length === 2 && items.find(item => item.kind === 'BoundText' && items.some(owner => owner.id === item.bindingItemId));
  return focused ? [focused] : items;
}

/** Use only immutable capability summaries. Mixed selections must support every action. */
export function contextTools(items, options) {
  items = selectionSubjects(items);
  if (!options.visible || !items.length || items.some(item => options.objectTypes && !options.objectTypes.includes(item.kind))) return [];
  const all = capability => items.every(item => item.capabilities[capability]);
  const tools = [];
  if (all('text')) {
    tools.push('strokeColor','textSizeSmall','textSizeMedium','textSizeLarge','bold','italic','textAlign');
  } else {
    if (all('line')) tools.push('lineStartStyle','swapLineEndpoints','lineEndStyle','lineRouting','lineAttachment');
    if (all('group')) {
      tools.push('groupTheme');
      if (items.length === 1 && all('groupTitle')) tools.push('groupTitleStyle');
    }
    if (all('stroke')) tools.push(all('fill') ? 'strokeFillColor' : 'strokeColor');
    if (all('stroke')) tools.push('strokeStyle');
    if (all('cornerRadius')) tools.push('cornerRadius');
  }
  if (all('editText') && items.length === 1) tools.push('editText');
  // Multi-selection text editing has no unambiguous single inline target.
  tools.push('moreOptions');
  return tools.filter(id => (!options.tools || options.tools.includes(id)) &&
    (!CONTEXT_PANEL_IDS.includes(id) || !options.panels || options.panels.includes(id)));
}

/** Above the selection when space permits, otherwise below; never outside the host. */
export function placeFloating(anchor, size, viewport) {
  const clamp = (value, limit, extent) => Math.max(4, Math.min(value, limit - extent - 4));
  return {
    left: clamp(anchor.left, viewport.width, size.width),
    top: clamp(anchor.top - size.height - 10 >= 4 ? anchor.top - size.height - 10 : anchor.bottom + 10, viewport.height, size.height),
  };
}

/** Convert canvas CSS pixels through both DOM transforms into overlay CSS pixels. */
export function mapCanvasBounds(bounds, canvas, canvasSize, host, hostSize) {
  const x = value => ((canvas.left - host.left) + value * canvas.width / (canvasSize.width || 1)) * (hostSize.width || 1) / (host.width || 1);
  const y = value => ((canvas.top - host.top) + value * canvas.height / (canvasSize.height || 1)) * (hostSize.height || 1) / (host.height || 1);
  return { left: x(bounds.left), top: y(bounds.top), right: x(bounds.right), bottom: y(bounds.bottom) };
}
