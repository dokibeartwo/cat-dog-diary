(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ControlRules = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  function dateValue(date = new Date()) { return `${pad(date.getFullYear(),4)}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && date.getFullYear() >= 1 && dateValue(date) === value ? date : null;
  }
  function allowedDate(value, min = '', max = '') {
    return Boolean(parseDate(value) && (!parseDate(min) || value >= min) && (!parseDate(max) || value <= max));
  }
  function calendarDays(year, month, selected = '', min = '', max = '') {
    const date = new Date(0); date.setHours(12,0,0,0); date.setFullYear(year, month-1, 1);
    date.setDate(1 - ((date.getDay()+6)%7));
    return Array.from({length:42}, () => {
      const value = dateValue(date);
      const item = {value, day:date.getDate(), outside:date.getMonth() !== month-1, selected:value===selected, disabled:!allowedDate(value,min,max)};
      date.setDate(date.getDate()+1); return item;
    });
  }
  function parseTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return Number(match[1])*60 + Number(match[2]);
  }
  function allowedTime(value, min = '', max = '') {
    const time = parseTime(value), low = parseTime(min), high = parseTime(max);
    if (time === null) return false;
    if (low !== null && high !== null && low > high) return time >= low || time <= high;
    return (low === null || time >= low) && (high === null || time <= high);
  }
  function stepValue(value, direction, min = '', max = '', step = '1') {
    const low = min === '' ? -Infinity : Number(min), high = max === '' ? Infinity : Number(max);
    const amount = step === 'any' ? 1 : Math.max(Number.EPSILON, Number(step) || 1);
    const base = value === '' || !Number.isFinite(Number(value)) ? (Number.isFinite(low) ? low : 0) : Number(value);
    return String(Number(Math.min(high, Math.max(low, base + direction*amount)).toFixed(10)));
  }
  return {pad,dateValue,parseDate,allowedDate,calendarDays,parseTime,allowedTime,stepValue};
});
