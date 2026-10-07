// Copy only approved artwork and pure rules; never copy application data.
const fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'../../..'), target=path.resolve(__dirname,'../public');
function copy(from,to){const dest=path.join(target,to);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,from),dest);}
for(let i=1;i<=6;i++)copy(`apps/android/assets/themes/bg${i}-main.jpg`,`assets/themes/bg${i}.jpg`);
for(let i=1;i<=4;i++)copy(`apps/android/assets/screens/screen${i}.jpg`,`assets/screens/screen${i}.jpg`);
copy('src/renderer/assets/bear-authenticity.png','assets/bear.png');
copy('apps/android/assets/icon.png','assets/icon.png');
for(const name of ['domain','diary-v1','productivity'])copy(`src/shared/${name}.js`,`shared/${name}.js`);
require('esbuild').buildSync({entryPoints:[path.join(root,'src/shared/runtime.js')],outfile:path.join(target,'shared/runtime.js'),bundle:true,format:'iife',globalName:'PreviewRuntime',platform:'browser',alias:{'node:crypto':path.join(__dirname,'browser-crypto.cjs')}});
console.log('Approved assets and shared rules prepared. No private data copied.');
