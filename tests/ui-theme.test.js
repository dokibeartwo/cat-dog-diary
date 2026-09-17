'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = path.join(__dirname, '../src/renderer');

test('every page with select controls includes the same themed popup and palette', () => {
  for (const name of fs.readdirSync(renderer).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(renderer, name), 'utf8');
    if (!html.includes('<select')) continue;
    assert.ok(html.includes('src="select-pop.js"'), name);
    assert.ok(html.includes('href="select-pop.css"'), name);
    assert.ok(html.includes('href="theme-previews.css"'), name);
  }
});

test('snooze options preserve the existing values and use a non-tiling arrow', () => {
  const html = fs.readFileSync(path.join(renderer, 'reminder.html'), 'utf8');
  const select = html.match(/<select id="snoozeMinutes"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/value="(\d+)"/g)].map(match => Number(match[1])), [5, 10, 15, 30, 60]);
  const css = fs.readFileSync(path.join(renderer, 'select-pop.css'), 'utf8');
  assert.match(css, /background-repeat:no-repeat/);
  assert.match(css, /background:var\(--paper/);
  assert.match(css, /background:var\(--violet/);
});

test('reused reminder windows can pre-render while hidden', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const start = main.indexOf('function createReminderWindow(');
  const block = main.slice(start, main.indexOf('function nextScreenId(', start));
  assert.ok(start >= 0);
  assert.match(block, /backgroundThrottling:\s*false/);
  assert.match(block, /show:\s*false/);
});
