import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const {occurrenceId,nextForegroundReminder}=createRequire(import.meta.url)('../src/services/reminder-presentation.js');
const at=Date.parse('2026-09-22T10:30:00Z');
const row={key:'habit:h1',rule:'{"minutes":1}',at:new Date(at).toISOString(),handledAt:null,deferred:false};

test('closing a displayed reminder cannot reopen it from an old React state snapshot',()=>{
  const pending=nextForegroundReminder([row],at,'');
  assert.equal(pending,row);
  const displayed=occurrenceId(pending);
  assert.equal(nextForegroundReminder([row],at+75000,displayed),undefined);
  const next={...row,at:new Date(at+135000).toISOString()};
  assert.equal(nextForegroundReminder([next],at+80000,displayed),undefined);
  assert.equal(nextForegroundReminder([next],at+135000,displayed),next);
});

test('a different source or changed rule remains eligible while handled and deferred alerts do not',()=>{
  const displayed=occurrenceId(row),other={...row,key:'habit:h2'},changed={...row,rule:'{"minutes":2}'};
  assert.equal(nextForegroundReminder([row,other],at,displayed),other);
  assert.equal(nextForegroundReminder([changed],at,displayed),changed);
  assert.equal(nextForegroundReminder([{...other,handledAt:new Date(at).toISOString()}],at,displayed),undefined);
  assert.equal(nextForegroundReminder([{...other,deferred:true}],at,displayed),undefined);
});

test('UI dismissal refreshes rows before closing and retains occurrence identity through notification callbacks',()=>{
  const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  const handler=app.slice(app.indexOf('const handleAlert='),app.indexOf('const detail='));
  assert.match(handler,/fullScreenKey\.current=occurrenceId\(alert\)/);
  assert.ok(handler.indexOf('await changed();')<handler.indexOf('setAlert(null);'));
  assert.doesNotMatch(app,/fullScreenKey\.current=''/);
  assert.match(app,/nextForegroundReminder\(reminders,clock,fullScreenKey\.current\)/);
});
