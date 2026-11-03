import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Every Worker is one file: webview Blob workers cannot resolve package imports.
await build({
  absWorkingDir: root,
  entryPoints: {
    'resource.worker': 'src/resources/worker/resource.worker.ts',
    'document.worker': 'src/storage/worker/document.worker.ts',
  },
  outdir: path.join(root, 'dist/workers'),
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  legalComments: 'eof', sourcemap: false,
});

// Remove outputs produced by the retired public web chrome build.
for (const name of ['editor-ui.js','editor-ui.css','react.js','react.css']) await rm(path.join(root,'dist',name),{force:true});
