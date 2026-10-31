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
const coreBoundary = {name:'core-boundary',setup(builder){
  builder.onResolve({filter:/[/]core[.]js$/},args=>path.resolve(args.importer)===path.join(root,'src','react','index.tsx')?{path:'../src/core.js',external:true}:undefined);
}};
// The imperative entry is self-contained; React hosts share their React runtime.
for (const [name,external] of [['editor-ui',[]],['react',['react','react-dom','react-dom/client','react/jsx-runtime']]]) {
  await build({absWorkingDir:root,entryPoints:['src/react/index.tsx'],outfile:path.join(root,'dist',name+'.js'),
    bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,legalComments:'eof',plugins:[coreBoundary],external});
}
