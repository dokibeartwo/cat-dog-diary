import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Android modal explicitly avoids the keyboard instead of relying on activity resize',()=>{
  const ui=readFileSync(new URL('../src/ui.tsx',import.meta.url),'utf8');
  assert.match(ui,/KeyboardAvoidingView behavior=\{Platform\.OS==='ios'\?'padding':'height'\}/);
  assert.match(ui,/ScrollView style=\{\{flexShrink:1\}\}/);
});
test('light pages and dark reminder overlays set readable status-bar text',()=>{
  const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  assert.match(app,/<StatusBar barStyle=\{alert\?'light-content':'dark-content'\}/);
});
