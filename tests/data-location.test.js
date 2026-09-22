'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {customDataDirectory}=require('../src/data-location');
const executable=path.resolve('release/app/diary.exe');
const config=value=>({existsSync:()=>true,readFileSync:()=>typeof value==='string'?value:JSON.stringify(value)});
test('stable and development launches retain the existing data directory',()=>{
  assert.equal(customDataDirectory({executable}),null);
  assert.equal(customDataDirectory({executable,packaged:true},{existsSync:()=>false}),null);
  assert.equal(customDataDirectory({executable},config({version:1,directory:'../data'})),null);
});
test('portable beta and explicit directory resolve next to the EXE, not current working directory',()=>{
  const expected=path.resolve(path.dirname(executable),'../本地数据');
  assert.equal(customDataDirectory({executable,packaged:true},config({version:1,directory:'../本地数据'})),expected);
  assert.equal(customDataDirectory({executable,argv:['--data-dir',expected]}),expected);
});
test('QA ignores even invalid directory overrides; malformed real configuration fails closed',()=>{
  assert.equal(customDataDirectory({executable,packaged:true,isolated:true,argv:['--data-dir']},config('bad')),null);
  assert.throws(()=>customDataDirectory({executable,packaged:true},config('bad')),/无法读取/);
  assert.throws(()=>customDataDirectory({executable,argv:['--data-dir']}),/需要/);
  assert.throws(()=>customDataDirectory({executable,argv:['--data-dir',path.parse(executable).root]}),/根目录/);
  assert.throws(()=>customDataDirectory({executable,argv:['--data-dir','.']}),/分开/);
});
