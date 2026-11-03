import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public-demo');
fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'scripts/local-entry.tsx')],
  outfile: path.join(out, 'app.js'), bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
fs.copyFileSync(path.join(root, 'public/favicon.svg'), path.join(out, 'favicon.svg'));
fs.cpSync(path.join(root, 'public/vendor'), path.join(out, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProcureX · Public Demo</title><meta name="description" content="Compare quotations, review supplier evidence and practise an approval-led negotiation.">
<base href="/procurex/"><link rel="icon" href="./favicon.svg"><link rel="stylesheet" href="./app.css"></head>
<body><div id="root"></div><script>globalThis.__PROCUREX_PUBLIC_DEMO__=true;</script><script type="module" src="./app.js"></script></body></html>`);
console.log('Public demo built in public-demo/. No credentials or API server are included.');
