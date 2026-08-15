import { dotnet } from './dotnet.js';

const runtime = await dotnet.create();
const exports = await runtime.getAssemblyExports('DrawMotive.Editor.Bridge.dll');
globalThis.drawmotiveEditorBridge = exports.DrawMotive.Editor.Bridge.Program;
