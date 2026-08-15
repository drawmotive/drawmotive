globalThis.eval = () => { throw new Error('CSP blocked eval'); };
globalThis.Function = function blockedFunction() { throw new Error('CSP blocked Function'); };
globalThis.document = { createElement: () => { throw new Error('CSP blocked script injection'); } };

const api = await import('../../src/platform/browser.js');
const instance = await api.initializeEditor({
  initializeTextGraph: async () => ({ dispose: async () => undefined }),
  loadRuntime: async () => ({ abiVersion: '1.0.0' }),
});
process.stdout.write(`${api.platform}:${instance.state}`);
