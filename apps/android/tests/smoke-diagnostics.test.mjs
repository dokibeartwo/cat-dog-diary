import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {captureFile,recordFailure}=createRequire(import.meta.url)('../scripts/smoke-diagnostics.cjs');

test('screenshot capture preserves binary output larger than the default pipe buffer',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'catdog-capture-'));
  try{
    const file=path.join(folder,'screen.bin'),size=2*1024*1024+37;
    captureFile(file,process.execPath,['-e',`process.stdout.write(Buffer.alloc(${size},0xa5))`]);
    const bytes=fs.readFileSync(file);
    assert.equal(bytes.length,size);
    assert.equal(bytes.every(byte=>byte===0xa5),true);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('capture errors retain the original failed assertion and still collect remaining evidence',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'catdog-diagnostics-'));
  try{
    let continued=false;
    await recordFailure(folder,{error:Error('Reminder was replaced'),checks:['app-start'],warnings:[]},{
      screenshot(){
        assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'result.json'))).error,'Reminder was replaced');
        throw Error('Device capture unavailable');
      },
      async hierarchy(){continued=true;}
    });
    const report=JSON.parse(fs.readFileSync(path.join(folder,'result.json')));
    assert.equal(report.passed,false);
    assert.equal(report.error,'Reminder was replaced');
    assert.deepEqual(report.diagnosticErrors,[{name:'screenshot',error:'Device capture unavailable'}]);
    assert.equal(continued,true);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
