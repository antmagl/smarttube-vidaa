import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,cp,rm} from 'node:fs/promises';

// VIDAA 2024+ ships Chromium 111 ("odin"); older sets have Chromium 77.
// Transpile syntax for 77 so the same bundle runs on both families.
const TARGET = ['chrome77'];

await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});

await build({
  entryPoints:['src/app.mjs'],
  outfile:'dist/app.js',
  bundle:true,
  format:'iife',
  platform:'browser',
  target:TARGET,
  minify:true,
  legalComments:'eof',
  define:{'__SMARTTUBE_PROXY__':JSON.stringify(process.env.SMARTTUBE_PROXY || ''),
    '__SMARTTUBE_BUILD__':JSON.stringify(process.env.SMARTTUBE_BUILD || 'dev')}
});
await build({
  entryPoints:['src/tv-decipher-worker.mjs'],
  outfile:'dist/tv-decipher-worker.js',
  bundle:true,
  format:'iife',
  platform:'browser',
  target:TARGET,
  loader:{'.txt':'text'},
  minify:true,
  legalComments:'eof'
});

for (const name of ['index.html','style.css','icon.png','THIRD_PARTY_NOTICES.md','LICENSE']) {
  await copyFile(name,'dist/'+name);
}
// Legacy cached loaders referenced app.html; serve the same direct page there too.
await copyFile('index.html','dist/app.html');
await cp('fonts','dist/fonts',{recursive:true});
await cp('licenses','dist/licenses',{recursive:true});

const pkg = JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/build.json',JSON.stringify({
  name:pkg.name,
  version:pkg.version,
  target:TARGET[0],
  proxy:process.env.SMARTTUBE_PROXY || '',
  dependencies:pkg.dependencies,
  builtAt:new Date().toISOString()
},null,2));

console.log('Built standalone VIDAA assets in dist/ (target '+TARGET[0]+').');
