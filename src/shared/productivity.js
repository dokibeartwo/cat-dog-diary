(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Productivity = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const validTime = (value) => typeof value === 'string' && Number.isFinite(new Date(value).getTime());

  function normalizeSteps(steps) {
    if (!Array.isArray(steps)) return [];
    const seen = new Set();
    return steps.slice(0, 100).flatMap((step, index) => {
      const title = String(step?.title || '').trim().slice(0, 120);
      const id = typeof step?.id === 'string' && step.id.length <= 100 ? step.id : `step-${index}`;
      if (!title || seen.has(id)) return [];
      seen.add(id);
      return [{ id, title, completed: step.completed === true }];
    });
  }

  function normalizeTracking(timer) {
    const segments = Array.isArray(timer.segments) ? timer.segments : [];
    return {
      taskId: typeof timer.taskId === 'string' ? timer.taskId : null,
      taskTitle: String(timer.taskTitle || '').slice(0, 120),
      startedAt: validTime(timer.startedAt) ? timer.startedAt : null,
      activeStartedAt: timer.status === 'running' && validTime(timer.activeStartedAt) ? timer.activeStartedAt : null,
      segments: segments.filter((item) => validTime(item?.start) && validTime(item?.end) && new Date(item.end) >= new Date(item.start))
        .map((item) => ({ start: item.start, end: item.end }))
    };
  }

  function beginTracking(timer, task, now = Date.now(), fresh = false) {
    if (timer.mode !== 'focus') return;
    if (fresh) {
      timer.taskId = task?.id || null;
      timer.taskTitle = task?.title || '';
      timer.startedAt = new Date(now).toISOString();
      timer.segments = [];
    }
    if (!timer.startedAt) timer.startedAt = new Date(now).toISOString();
    if (!timer.activeStartedAt) timer.activeStartedAt = new Date(now).toISOString();
    if (!Array.isArray(timer.segments)) timer.segments = [];
  }

  function segmentNow(timer, now = Date.now()) {
    if (timer.mode !== 'focus' || timer.status !== 'running' || !validTime(timer.activeStartedAt)) return null;
    const start = new Date(timer.activeStartedAt).getTime();
    const cap = validTime(timer.endsAt) ? new Date(timer.endsAt).getTime() : now;
    const end = Math.max(start, Math.min(now, cap));
    return end > start ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() } : null;
  }

  function closeSegment(timer, now = Date.now()) {
    const segment = segmentNow(timer, now);
    if (segment) (timer.segments ||= []).push(segment);
    timer.activeStartedAt = null;
  }

  function recordSession(state, outcome, now = Date.now()) {
    const timer = state.focusTimer;
    if (timer.mode !== 'focus' || !timer.sessionId || !timer.startedAt) return false;
    closeSegment(timer, now);
    state.focusHistory ||= [];
    if (state.focusHistory.some((record) => record.id === timer.sessionId)) return false;
    const seconds = Math.floor((timer.segments || []).reduce((sum, item) => sum + new Date(item.end).getTime() - new Date(item.start).getTime(), 0) / 1000);
    if (seconds <= 0) return false;
    state.focusHistory.push({ id: timer.sessionId, taskId: timer.taskId || null,
      taskTitle: timer.taskTitle || '自由专注', startedAt: timer.startedAt,
      endedAt: outcome === 'completed' && validTime(timer.endsAt) ? timer.endsAt : new Date(now).toISOString(),
      outcome, durationSeconds: seconds, segments: structuredClone(timer.segments) });
    return true;
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    const seen = new Set();
    return history.filter((item) => {
      if (!item || typeof item.id !== 'string' || seen.has(item.id) || !validTime(item.startedAt) || !validTime(item.endedAt)) return false;
      seen.add(item.id); return true;
    }).map((item) => {
      const tracking = normalizeTracking(item);
      const durationSeconds = Math.floor(tracking.segments.reduce((sum, part) => sum + new Date(part.end).getTime() - new Date(part.start).getTime(), 0) / 1000);
      return { id: item.id, taskId: tracking.taskId, taskTitle: tracking.taskTitle || '自由专注',
        startedAt: item.startedAt, endedAt: item.endedAt, segments: tracking.segments,
        outcome: item.outcome === 'completed' ? 'completed' : 'interrupted', durationSeconds };
    });
  }

  function summarize(history = [], timer, start, end, now = Date.now(), taskId) {
    const low = new Date(start).getTime(), high = new Date(end).getTime();
    const relevant = (record) => taskId === undefined || record.taskId === taskId;
    const within = (segment) => Math.max(0, Math.min(new Date(segment.end).getTime(), high) - Math.max(new Date(segment.start).getTime(), low));
    let milliseconds = 0, rounds = 0;
    for (const record of history.filter(relevant)) {
      milliseconds += (record.segments || []).reduce((sum, segment) => sum + within(segment), 0);
      const ended = new Date(record.endedAt).getTime();
      if (record.outcome === 'completed' && ended >= low && ended < high) rounds++;
    }
    if (timer?.mode === 'focus' && timer.status !== 'idle' && relevant(timer)
      && !history.some((record) => record.id === timer.sessionId)) {
      milliseconds += (timer.segments || []).reduce((sum, segment) => sum + within(segment), 0);
      const ongoing = segmentNow(timer, now);
      if (ongoing) milliseconds += within(ongoing);
    }
    return { seconds: Math.floor(milliseconds / 1000), rounds };
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
  }

  function matchesSearch(task, value) {
    const query = String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
    if (!query) return true;
    const haystack = [task.title, task.notes, ...(task.steps || []).map((step) => step.title)].join(' ').normalize('NFKC').toLocaleLowerCase();
    return query.split(/\s+/).every((part) => haystack.includes(part));
  }
  return { normalizeSteps, normalizeTracking, beginTracking, closeSegment, recordSession, normalizeHistory, summarize, formatDuration, matchesSearch };
});
