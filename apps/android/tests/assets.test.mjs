import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function images(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(directory,entry.name);
    return entry.isDirectory()?images(file):/\.(png|jpe?g)$/i.test(file)?[file]:[];
  });
}
test('Android image extensions match their encoded format for AAPT compilation',()=>{
  const files=images(path.join(root,'assets'));
  assert.equal(files.length,11,'six themes, four screens and original bear icon');
  for(const file of files){
    const bytes=fs.readFileSync(file);
    const actual=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'jpg':'unknown';
    assert.equal(path.extname(file).slice(1).replace('jpeg','jpg'),actual,path.relative(root,file));
  }
});
test('all statically required Android image files exist',()=>{
  for(const source of ['App.tsx','src/reminder-screen.tsx']){
    const filename=path.join(root,source),code=fs.readFileSync(filename,'utf8');
    const references=[...code.matchAll(/require\(['"]([^'"]+\.(?:png|jpe?g))['"]\)/g)];
    assert.ok(references.length);
    for(const [,image] of references)assert.ok(fs.existsSync(path.resolve(path.dirname(filename),image)),image);
  }
});
