export const EDITOR_BUTTON_IDS = Object.freeze(['undo', 'redo', 'arrow', 'rectangle', 'ellipse', 'diamond', 'text', 'sketchyMode', 'zoomIn', 'zoomOut', 'resetZoom', 'settings', 'help']);
export const EDITOR_REGION_IDS = Object.freeze(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
export const DRAWING_TOOL_IDS = Object.freeze(['arrow', 'rectangle', 'ellipse', 'diamond', 'text', 'sketchyMode']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hostId = value => typeof value === 'string' && /^host[.][A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const slotId = value => typeof value === 'string' && /^slot[.][A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);

function keys(value, allowed, name) {
  if (!record(value)) throw new TypeError(name + ' must be an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError('Unknown ' + name + ' option: ' + key);
}
function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(name + ' must be a boolean');
  return value;
}
function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a nonempty string');
  return value;
}
function distinctIds(value, name, valid = id => typeof id === 'string' && !!id.trim()) {
  if (!Array.isArray(value) || value.some(id => !valid(id)) || new Set(value).size !== value.length) throw new TypeError(name + ' must contain distinct valid IDs');
  return Object.freeze([...value]);
}
function visibleOptions(value, allowed, name) {
  if (value === undefined) return {};
  if (typeof value === 'boolean') return { visible: value };
  keys(value, ['visible', ...allowed], name);
  if (value.visible !== undefined) boolean(value.visible, name + '.visible');
  return value;
}

/** All UI entry points share descriptors; callbacks remain in the owning host.
 * Visibility configures chrome only. Text input and editing permissions are separate. */
export function normalizeUiOptions(options = {}) {
  if (options === false) options = { enabled: false };
  keys(options, ['enabled', 'buttons', 'actions', 'regions', 'drawingToolbar', 'contextToolbar', 'textEditing', 'tooltip'], 'ui');
  const enabled = options.enabled === undefined ? true : boolean(options.enabled, 'ui.enabled');
  const textEditing = options.textEditing ?? 'inline';
  if (!['inline', 'external', 'disabled'].includes(textEditing)) throw new TypeError('ui.textEditing must be inline, external or disabled');
  const overrides = options.buttons ?? {};
  keys(overrides, EDITOR_BUTTON_IDS, 'ui.buttons');
  const buttons = Object.fromEntries(EDITOR_BUTTON_IDS.map(id => [id, id !== 'help']));
  for (const [id, value] of Object.entries(overrides)) buttons[id] = boolean(value, 'ui.buttons.' + id);
  const handlers = new Map();
  if (options.actions !== undefined && !Array.isArray(options.actions)) throw new TypeError('ui.actions must be an array');
  const actions = (options.actions ?? []).map(action => {
    keys(action, ['id', 'label', 'icon', 'visible', 'enabled', 'onInvoke'], 'action');
    if (!hostId(action.id)) throw new TypeError('Action id must use the host. namespace');
    if (handlers.has(action.id)) throw new TypeError('Duplicate action id: ' + action.id);
    if (typeof action.onInvoke !== 'function') throw new TypeError('Action ' + action.id + ' requires an onInvoke handler');
    const descriptor = {
      id: action.id, label: text(action.label, 'Action label'),
      enabled: action.enabled === undefined ? true : boolean(action.enabled, 'Action enabled'),
      visible: action.visible === undefined ? true : boolean(action.visible, 'Action visible'),
    };
    if (action.icon !== undefined) descriptor.icon = text(action.icon, 'Action icon');
    handlers.set(action.id, action.onInvoke);
    return Object.freeze(descriptor);
  });
  const regionOptions = options.regions ?? {};
  keys(regionOptions, EDITOR_REGION_IDS, 'ui.regions');
  const assignedActions = new Set(Object.values(regionOptions).flatMap(region => record(region) && Array.isArray(region.items) ? region.items.filter(hostId) : []));
  const defaults = {
    topLeft: ['undo', 'redo'],
    topRight: ['help', ...actions.filter(action => !assignedActions.has(action.id)).map(action => action.id)],
    bottomLeft: [],
    bottomRight: ['sketchyMode', 'zoomOut', 'resetZoom', 'zoomIn', 'settings'],
  };
  const regions = Object.fromEntries(EDITOR_REGION_IDS.map(id => {
    const region = visibleOptions(regionOptions[id], ['items'], 'ui.regions.' + id);
    return [id, Object.freeze({
      visible: enabled && (region.visible ?? true),
      items: distinctIds(region.items ?? defaults[id], 'ui.regions.' + id + '.items', item => EDITOR_BUTTON_IDS.includes(item) || handlers.has(item) || slotId(item)),
    })];
  }));
  const drawingOptions = visibleOptions(options.drawingToolbar, ['position', 'tools'], 'ui.drawingToolbar');
  const position = drawingOptions.position ?? 'left';
  if (!['left', 'right', 'top', 'bottom'].includes(position)) throw new TypeError('ui.drawingToolbar.position must be left, right, top or bottom');
  const drawingToolbar = Object.freeze({
    visible: enabled && (drawingOptions.visible ?? true), position,
    tools: distinctIds(drawingOptions.tools ?? DRAWING_TOOL_IDS.filter(id=>id!=='sketchyMode'), 'ui.drawingToolbar.tools', id => DRAWING_TOOL_IDS.includes(id)),
  });
  const contextOptions = visibleOptions(options.contextToolbar, ['objectTypes', 'tools', 'panels'], 'ui.contextToolbar');
  const contextToolbar = { visible: enabled && (contextOptions.visible ?? true) };
  for (const key of ['objectTypes', 'tools', 'panels']) if (contextOptions[key] !== undefined) contextToolbar[key] = distinctIds(contextOptions[key], 'ui.contextToolbar.' + key);
  const tooltipOptions = visibleOptions(options.tooltip, ['position', 'delay'], 'ui.tooltip');
  const tooltipPosition = tooltipOptions.position ?? 'top', tooltipDelay = tooltipOptions.delay ?? 250;
  if (!['top','bottom','left','right'].includes(tooltipPosition)) throw new TypeError('ui.tooltip.position must be top, bottom, left or right');
  if (!Number.isFinite(tooltipDelay) || tooltipDelay < 0) throw new TypeError('ui.tooltip.delay must be nonnegative');
  const tooltip = Object.freeze({ visible: tooltipOptions.visible ?? true, position: tooltipPosition, delay: tooltipDelay });
  return Object.freeze({
    ui: Object.freeze({
      enabled, buttons: Object.freeze(buttons), actions: Object.freeze(actions), regions: Object.freeze(regions),
      drawingToolbar, contextToolbar: Object.freeze(contextToolbar), textEditing, tooltip,
    }),
    handlers,
  });
}
