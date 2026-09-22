'use strict';

// Optional, local-first Supabase bridge for the Windows client.  The diary
// JSON remains the compatibility projection for the UI. The packaged app
// keeps account metadata and the durable outbox in sync-state.sqlite.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharedCore = require('../packages/core/src');
const journal = require('../packages/core/src/replica');

const DURABLE_TYPES = Object.freeze(['task', 'step', 'habit', 'habit_event', 'category', 'stage_plan', 'reminder_rule', 'focus_session', 'preference']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const iso = value => new Date(value || Date.now()).toISOString();

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function emptyMeta(deviceId) {
  return { version: 1, deviceId, currentAccountId: null, lastAccountId: null, lastError: null, session: null,
    config: { url: '', publishableKey: '' }, accounts: {} };
}

function makeDeviceId() { return `win-${crypto.randomUUID()}`; }

function entityId(type, item, index = 0) {
  if (type === 'stage_plan' || type === 'preference') return 'account';
  if (type === 'focus_session') return String(item?.id || item?.sessionId || `focus-${index + 1}`);
  return String(item?.id || `${type}-${index + 1}`);
}

const projectState = sharedCore.projectState;
const applyEntities = sharedCore.applyEntities;

class SyncService {
  constructor(filePath, { env = process.env, fetchImpl = globalThis.fetch, secureStorage = null, sqlite = false } = {}) {
    this.filePath = filePath;
    this.fetchImpl = fetchImpl;
    this.epoch = 0;
    this.running = null;
    this.secureStorage = secureStorage;
    this.storage = sqlite ? new (require('./sync-sqlite').SyncSqlite)(filePath.replace(/\.json$/, '.sqlite')) : null;
    this.meta = this.load();
    const envUrl = String(env.CAT_DOG_SUPABASE_URL || '').trim();
    const envKey = String(env.CAT_DOG_SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (envUrl && envKey && (!this.meta.config.url || !this.meta.config.publishableKey)) {
      this.meta.config = { url: envUrl.replace(/\/$/, ''), publishableKey: envKey };
      this.save();
    }
  }

  load() {
    const fallback = emptyMeta(makeDeviceId());
    try {
      const stored = this.storage?.load();
      const text = stored || (fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, 'utf8') : null);
      if (!text) return fallback;
      const parsed = JSON.parse(text);
      if (!parsed || parsed.version !== 1) throw new Error('同步记录格式无法识别');
      parsed.accounts ||= {};
      parsed.config ||= { url: '', publishableKey: '' };
      parsed.deviceId ||= fallback.deviceId;
      parsed.lastAccountId ||= null;
      parsed.lastError ||= null;
      if(parsed.encryptedSession) {
        try { parsed.session=JSON.parse(this.secureStorage.decryptString(Buffer.from(parsed.encryptedSession,'base64'))); }
        catch { parsed.lastAccountId=parsed.currentAccountId||parsed.lastAccountId;parsed.session=null;parsed.currentAccountId=null;parsed.lastError='登录凭据无法解密，请重新登录；本机数据和队列保留'; }
      }
      return parsed;
    } catch (error) { throw new Error(`无法读取本机同步记录；原文件未修改，请先备份后恢复：${error.message}`); }
  }

  save() {
    const data=clone(this.meta);
    if(this.secureStorage?.isEncryptionAvailable() && data.session) {
      data.encryptedSession=this.secureStorage.encryptString(JSON.stringify(data.session)).toString('base64');data.session=null;
    }else delete data.encryptedSession;
    if(this.storage){this.storage.save(data);return;}
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  configured() { return Boolean(this.meta.config.url && this.meta.config.publishableKey); }
  account(id = this.meta.currentAccountId) {
    if (!id) return null;
    this.meta.accounts[id] ||= { cursor: null, cursorEntity: '', entities: {}, outbox: [], conflicts: [], migrated: false, lastSyncedAt: null };
    const account = this.meta.accounts[id];
    if (typeof account.migrated !== 'boolean') account.migrated = false;
    account.entities ||= {}; account.outbox ||= []; account.conflicts ||= [];
    return account;
  }
  status() {
    const account = this.account();
    return { configured: this.configured(), signedIn: Boolean(this.meta.session && account), email: this.meta.session?.email || '',
      accountId: this.meta.currentAccountId, deviceId: this.meta.deviceId, lastSyncedAt: account?.lastSyncedAt || null,
      pending: account?.outbox?.length || 0, conflicts: account?.conflicts?.length || 0,
      paused: account?.paused === true, needsMerge: Boolean(account && account.migrated === false), error: this.meta.lastError || null };
  }

  configure({ url, publishableKey } = {}) {
    const normalized = String(url || '').trim().replace(/\/$/, '');
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('请使用 HTTPS Supabase 项目地址');
    if (!publishableKey || String(publishableKey).length < 10) throw new Error('请填写 Supabase publishable key');
    const jwt = String(publishableKey).split('.');
    const role = jwt.length === 3 ? safeJson(Buffer.from(jwt[1], 'base64url').toString(), {})?.role : null;
    if (String(publishableKey).startsWith('sb_secret_') || role === 'service_role') throw new Error('客户端不能使用 service role 或 secret key');
    if (this.meta.currentAccountId && (normalized !== this.meta.config.url || publishableKey !== this.meta.config.publishableKey)) throw new Error('请先退出账号再更换云端项目');
    this.meta.config = { url: normalized, publishableKey: String(publishableKey).trim() }; this.save(); return this.status();
  }

  headers(accessToken = '') { return { apikey: this.meta.config.publishableKey, Authorization: `Bearer ${accessToken || this.meta.config.publishableKey}`, 'Content-Type': 'application/json' }; }
  async request(pathname, { method = 'GET', body, accessToken = '' } = {}) {
    if (!this.configured()) throw new Error('请先配置 Supabase URL 和 publishable key');
    if (typeof this.fetchImpl !== 'function') throw new Error('当前运行环境不支持网络同步');
    const response = await this.fetchImpl(`${this.meta.config.url}${pathname}`, { method, headers: this.headers(accessToken), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const text = await response.text(); const data = safeJson(text, text);
    if (!response.ok) { const error = new Error(data?.msg || data?.message || data?.error_description || `同步请求失败（${response.status}）`); error.status = response.status; throw error; }
    return data;
  }

  async sendOtp(email) {
    if (!String(email || '').trim()) throw new Error('请输入邮箱');
    await this.request('/auth/v1/otp', { method: 'POST', body: { email: String(email).trim(), create_user: true } });
    return { sent: true };
  }

  async verifyOtp(email, token) {
    const data = await this.request('/auth/v1/verify', { method: 'POST', body: { email: String(email).trim(), token: String(token).trim(), type: 'email' } });
    if (!data?.access_token || !data?.user?.id) throw new Error('验证码验证成功但未返回账号信息');
    this.epoch += 1;
    this.meta.session = { accessToken: data.access_token, refreshToken: data.refresh_token || null, email: data.user.email || email, expiresAt: data.expires_at || null };
    this.meta.currentAccountId = data.user.id;
    this.account(); this.save();
    return this.status();
  }

  async refreshSession() {
    const epoch = this.epoch;
    const token = this.meta.session?.refreshToken;
    if (!token) return false;
    try {
      const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: token } });
      if (data?.access_token && epoch === this.epoch && this.meta.session) { this.meta.session.accessToken = data.access_token; this.meta.session.refreshToken = data.refresh_token || token; this.meta.session.expiresAt = data.expires_at || null; this.save(); return true; }
    } catch { /* caller reports the next real request error */ }
    return false;
  }

  logout() { this.epoch += 1; this.meta.lastAccountId = this.meta.currentAccountId || this.meta.lastAccountId || null; this.meta.session = null; this.meta.currentAccountId = null; this.save(); return this.status(); }

  saveLocalSnapshot(state) { const account = this.account(this.meta.currentAccountId || this.meta.lastAccountId); if (account) { account.localSnapshot = clone(state); this.save(); } }
  localSnapshot() { return clone(this.account()?.localSnapshot || null); }

  capture(previousState, nextState) {
    const account = this.account(this.meta.currentAccountId || this.meta.lastAccountId); if (!account) return;
    const before = projectState(previousState); const after = projectState(nextState);
    const replica = { remote: account.entities, outbox: account.outbox };
    for (const [key, item] of after) {
      const restored=item.entityType==='task'&&!before.has(key)&&previousState?.trash?.some(entry=>entry.task?.id===item.entityId);
      journal.enqueue(replica, before.get(key), item, { deviceId: this.meta.deviceId, mutationId: `${this.meta.deviceId}:${crypto.randomUUID()}`, ...(restored?{operation:'restore'}:{}) });
    }
    for (const [key, old] of before) if (!after.has(key)) {
      journal.enqueue(replica, old, null, { deviceId: this.meta.deviceId, mutationId: `${this.meta.deviceId}:${crypto.randomUUID()}` });
    }
    account.localSnapshot = clone(nextState);
    this.save();
  }

  authenticatedCall() {
    const epoch = this.epoch, accountId = this.meta.currentAccountId;
    const check = () => { if (epoch !== this.epoch || accountId !== this.meta.currentAccountId || !this.meta.session) throw new Error('同步账号已变化，请重试'); };
    return async (pathname, options = {}) => {
      check();
      try { const value = await this.request(pathname, { ...options, accessToken: this.meta.session.accessToken }); check(); return value; }
      catch (error) {
        check();
        if (error.status !== 401 || !(await this.refreshSession())) throw error;
        check(); const value = await this.request(pathname, { ...options, accessToken: this.meta.session.accessToken }); check(); return value;
      }
    };
  }

  async pullAll(call, cursor = null, cursorEntity = '') {
    const items = [];
    for (let pageNo = 0; pageNo < 1000; pageNo++) {
      const pulled = await call('/rest/v1/rpc/pull_changes', { method: 'POST', body: { p_cursor: cursor, p_cursor_entity: cursorEntity, p_limit: 500 } });
      if (!Array.isArray(pulled?.items)) throw new Error('云端返回了无效的同步数据');
      for (const item of pulled.items) sharedCore.validateEntity(item);
      items.push(...pulled.items);
      const next = pulled.nextCursor;
      if (pulled.hasMore && (!next || (next.updatedAt === cursor && next.entity === cursorEntity))) throw new Error('云端同步游标未前进');
      // Preserve PostgreSQL microseconds. Converting to JS Date loses data.
      if (next) { cursor = next.updatedAt; cursorEntity = next.entity || ''; }
      if (!pulled.hasMore) return { items, cursor, cursorEntity };
    }
    throw new Error('同步数据过多，请联系维护者；本机数据和游标未改变');
  }

  async sync() {
    if (this.running) return this.running;
    this.running = this.exchange();
    try { return await this.running; } finally { this.running = null; }
  }
  async exchange() {
    const account = this.account(); if (!account || !this.meta.session) throw new Error('请先登录同步账号');
    if (!account.migrated) throw new Error('请先预览并确认首次合并');
    if (account.paused) throw new Error('同步已暂停');
    const call = this.authenticatedCall();
    const outgoing = account.outbox.slice();
    outgoing.forEach(mutation => { mutation.attempted = true; }); this.save();
    const results = [];
    for (let i = 0; i < outgoing.length; i += 100) {
      const rows = await call('/rest/v1/rpc/push_mutations', { method: 'POST', body: { p_mutations: outgoing.slice(i, i + 100).map(journal.transportMutation) } });
      if (!Array.isArray(rows) || rows.some(r => !['applied', 'duplicate', 'conflict'].includes(r.status))) throw new Error('云端拒绝了同步操作，修改仍在本机保留');
      results.push(...rows);
    }
    const { items, cursor, cursorEntity } = await this.pullAll(call, account.cursor, account.cursorEntity);
    const replica = { remote: account.entities, outbox: account.outbox, conflicts: account.conflicts };
    const visible = journal.commitExchange(replica, results, items, { updatedAt: cursor, entity: cursorEntity });
    account.entities = replica.remote; account.outbox = replica.outbox; account.conflicts = replica.conflicts;
    account.cursor = cursor; account.cursorEntity = cursorEntity;
    account.projectionPending = true;
    account.lastSyncedAt = iso(); this.save();
    return { pushed: results.filter(r => r.status !== 'conflict').length, pulled: visible, downloaded: items.length, conflicts: account.conflicts.length, cursor: account.cursor };
  }

  // Read the complete cloud snapshot without changing the device cursor or
  // local state.  The first-login screen uses this to show a safe merge
  // preview before anything is uploaded or replaced.
  async previewCloud() {
    const account = this.account(); if (!account || !this.meta.session) throw new Error('请先登录同步账号');
    const page = await this.pullAll(this.authenticatedCall());
    return { entities: page.items, accountId: this.meta.currentAccountId, epoch: this.epoch, generatedAt: iso() };
  }

  seedPreviewEntities(entities) {
    const account = this.account(); if (!account) throw new Error('请先登录同步账号');
    account.entities = {};
    for (const item of Array.isArray(entities) ? entities : []) {
      if (item?.entityType && item?.entityId) account.entities[`${item.entityType}|${item.entityId}`] = clone(item);
    }
    this.save();
  }

  async deleteAccount() {
    if (!this.meta.session) throw new Error('请先登录同步账号');
    await this.authenticatedCall()('/rest/v1/rpc/delete_account', { method: 'POST', body: {} });
    const localSnapshot = this.account()?.localSnapshot || null;
    if (localSnapshot) this.meta.pendingLocalSnapshot = clone(localSnapshot);
    delete this.meta.accounts[this.meta.currentAccountId];
    this.epoch += 1; this.meta.lastAccountId = null; this.meta.session = null; this.meta.currentAccountId = null; this.save(); return this.status();
  }

  async listConflicts() {
    if (!this.meta.session) return [];
    const query = '/rest/v1/sync_conflicts?status=eq.open&order=created_at.desc&limit=50';
    const rows = await this.authenticatedCall()(query);
    return Array.isArray(rows) ? rows : [];
  }

  async resolveConflict(conflictId, resolution) {
    if (!this.meta.session) throw new Error('请先登录同步账号');
    const id = String(conflictId || '').trim();
    if (!id || !resolution || typeof resolution !== 'object' || Array.isArray(resolution)) throw new Error('冲突解决参数无效');
    const existing = (await this.listConflicts()).find(item => String(item.conflict_id || item.conflictId) === id);
    const body = { p_conflict_id: id, p_resolution: resolution };
    const result = await this.authenticatedCall()('/rest/v1/rpc/resolve_conflict', { method: 'POST', body });
    if (!result?.resolved) throw new Error('云端在选择期间发生变化，请重新读取冲突');
    const account = this.account();
    if (account) account.conflicts = (account.conflicts || []).filter(item => item.conflictId !== id && item.conflict_id !== id && (!existing?.mutation_id || item.mutationId !== existing.mutation_id));
    this.save();
    return result;
  }

  async acquireFocusLease(sessionId, leaseSeconds = 90) {
    if (!this.meta.session) return true;
    const data = await this.authenticatedCall()('/rest/v1/rpc/acquire_focus_lease', { method: 'POST', body: { p_device_id: this.meta.deviceId, p_session_id: sessionId, p_lease_seconds: leaseSeconds } });
    if (!data?.ok) return false;
    return true;
  }

  async releaseFocusLease(sessionId = null) {
    if (!this.meta.session) return false;
    return Boolean(await this.authenticatedCall()('/rest/v1/rpc/release_focus_lease', { method: 'POST', body: { p_device_id: this.meta.deviceId, p_session_id: sessionId } }));
  }
}

module.exports = { SyncService, projectState, applyEntities, DURABLE_TYPES };
