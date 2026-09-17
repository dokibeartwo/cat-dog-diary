const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../src/shared/controls');
test('calendar validates leap years and impossible dates',()=>{
  assert.ok(c.parseDate('2024-02-29'));assert.equal(c.parseDate('2026-02-29'),null);
  assert.equal(c.parseDate('2026-13-01'),null);assert.equal(c.parseDate('0000-01-01'),null);
  assert.ok(c.parseDate('0099-01-01'));
});
test('calendar has Monday-first 42 cells and honors inclusive range',()=>{
  const cells=c.calendarDays(2026,9,'2026-09-09','2026-09-08','2026-09-10');
  assert.equal(cells.length,42);assert.equal(cells[0].value,'2026-08-31');
  assert.equal(cells.filter(x=>!x.disabled).length,3);
  assert.equal(cells.find(x=>x.selected).value,'2026-09-09');
});
test('calendar crosses year without date or timezone drift',()=>{
  const cells=c.calendarDays(2026,12);
  assert.equal(cells[0].value,'2026-11-30');assert.equal(cells.at(-1).value,'2027-01-10');
  assert.ok(c.allowedDate('2026-09-09','',''));assert.equal(c.allowedDate('2026-09-08','2026-09-09',''),false);
});
test('24h time accepts minute precision and rejects invalid values',()=>{
  assert.equal(c.parseTime('00:00'),0);assert.equal(c.parseTime('23:59'),1439);
  assert.equal(c.parseTime('24:00'),null);assert.equal(c.parseTime('09:60'),null);assert.equal(c.parseTime(''),null);
});
test('time limits include endpoints and support a midnight-spanning range',()=>{
  assert.ok(c.allowedTime('09:00','09:00','18:00'));assert.equal(c.allowedTime('08:59','09:00','18:00'),false);
  assert.ok(c.allowedTime('23:30','22:00','06:00'));assert.ok(c.allowedTime('01:00','22:00','06:00'));
  assert.equal(c.allowedTime('12:00','22:00','06:00'),false);
});
test('numeric stepping respects boundaries and decimal precision',()=>{
  assert.equal(c.stepValue('180',1,'1','180'),'180');assert.equal(c.stepValue('1',-1,'1','180'),'1');
  assert.equal(c.stepValue('0.2',1,'0','1','0.1'),'0.3');assert.equal(c.stepValue('',1,'5','100'),'6');
});
