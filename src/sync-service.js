'use strict';

// Optional, local-first Supabase bridge for the Windows client.  The diary
// JSON remains the source of truth for the UI; this file only stores account
// metadata, session tokens and an outbox in userData/sync-state.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharedCore = require('../packages/core/src');

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
  constructor(filePath, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.filePath = filePath;
    this.fetchImpl = fetchImpl;
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
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1) return fallback;
      parsed.accounts ||= {};
      parsed.config ||= { url: '', publishableKey: '' };
      parsed.deviceId ||= fallback.deviceId;
      parsed.lastAccountId ||= null;
      parsed.lastError ||= null;
      return parsed;
    } catch { return fallback; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.meta, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  configured() { return Boolean(this.meta.config.url && this.meta.config.publishableKey); }
  account() {
    const id = this.meta.currentAccountId;
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
      needsMerge: Boolean(account && account.migrated === false), error: this.meta.lastError || null };
  }

  configure({ url, publishableKey } = {}) {
    const normalized = String(url || '').trim().replace(/\/$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+\.supabase\.co$/.test(normalized) && !/^https?:\/\//.test(normalized)) throw new Error('Supabase 地址无效');
    if (!publishableKey || String(publishableKey).length < 10) throw new Error('请填写 Supabase publishable key');
    this.meta.config = { url: normalized, publishableKey: String(publishableKey).trim() }; this.save(); return this.status();
  }

  headers(accessToken = '') { return { apikey: this.meta.config.publishableKey, Authorization: `Bearer ${accessToken || this.meta.config.publishableKey}`, 'Content-Type': 'application/json' }; }
  async request(pathname, { method = 'GET', body, accessToken = '' } = {}) {
    if (!this.configured()) throw new Error('请先配置 Supabase URL 和 publishable key');
    if (typeof this.fetchImpl !== 'function') throw new Error('当前运行环境不支持网络同步');
    const response = await this.fetchImpl(`${this.meta.config.url}${pathname}`, { method, headers: this.headers(accessToken), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); const data = safeJson(text, text);
    if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || `同步请求失败（${response.status}）`);
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
    this.meta.session = { accessToken: data.access_token, refreshToken: data.refresh_token || null, email: data.user.email || email, expiresAt: data.expires_at || null };
    this.meta.currentAccountId = data.user.id;
    this.account(); this.save();
    return this.status();
  }

  async refreshSession() {
    const token = this.meta.session?.refreshToken;
    if (!token) return false;
    try {
      const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: token } });
      if (data?.access_token) { this.meta.session.accessToken = data.access_token; this.meta.session.refreshToken = data.refresh_token || token; this.meta.session.expiresAt = data.expires_at || null; this.save(); return true; }
    } catch { /* caller reports the next real request error */ }
    return false;
  }

  logout() { this.meta.lastAccountId = this.meta.currentAccountId || this.meta.lastAccountId || null; this.meta.session = null; this.meta.currentAccountId = null; this.save(); return this.status(); }

  saveLocalSnapshot(state) { const account = this.account(); if (account) { account.localSnapshot = clone(state); this.save(); } }
  localSnapshot() { return clone(this.account()?.localSnapshot || null); }

  capture(previousState, nextState) {
    const account = this.account(); if (!account) return;
    const before = projectState(previousState); const after = projectState(nextState); const now = iso();
    for (const [key, item] of after) {
      const old = before.get(key); if (old && JSON.stringify(old.payload) === JSON.stringify(item.payload)) continue;
      const known = account.entities[key];
      const pending = account.outbox.find(mutation => mutation.entityType === item.entityType && mutation.entityId === item.entityId);
      if (pending) {
        // Coalesce rapid offline edits into one mutation. This avoids a
        // same-device edit racing its own base revision on the server.
        pending.operation = 'upsert'; pending.patch = item.payload; pending.createdAt = now;
      } else account.outbox.push({ mutationId: `${this.meta.deviceId}:${crypto.randomUUID()}`, entityType: item.entityType, entityId: item.entityId,
        operation: 'upsert', patch: item.payload, basePayload: old?.payload || {}, baseRevision: Number(known?.revision || 0), deviceId: this.meta.deviceId, createdAt: now });
      account.entities[key] = { ...(known || {}), ...item, revision: Number(known?.revision || 0), updatedAt: now, deletedAt: null, deviceId: this.meta.deviceId };
    }
    for (const [key, old] of before) if (!after.has(key)) {
      const known = account.entities[key];
      const pending = account.outbox.find(mutation => mutation.entityType === old.entityType && mutation.entityId === old.entityId);
      if (pending) { pending.operation = 'delete'; pending.patch = {}; pending.createdAt = now; }
      else account.outbox.push({ mutationId: `${this.meta.deviceId}:${crypto.randomUUID()}`, entityType: old.entityType, entityId: old.entityId,
        operation: 'delete', patch: {}, basePayload: old.payload || {}, baseRevision: Number(known?.revision || 0), deviceId: this.meta.deviceId, createdAt: now });
      account.entities[key] = { ...(known || old), deletedAt: now, updatedAt: now, deviceId: this.meta.deviceId };
    }
    account.localSnapshot = clone(nextState);
    this.save();
  }

  async sync() {
    const account = this.account(); if (!account || !this.meta.session) throw new Error('请先登录同步账号');
    let access = this.meta.session.accessToken;
    const call = async (pathname, options) => { try { return await this.request(pathname, { ...options, accessToken: access }); } catch (error) { if (await this.refreshSession()) { access = this.meta.session.accessToken; return this.request(pathname, { ...options, accessToken: access }); } throw error; } };
    const outgoing = account.outbox.slice(0, 100);
    const pushed = outgoing.length ? await call('/rest/v1/rpc/push_mutations', { method: 'POST', body: outgoing }) : [];
    const accepted = new Set();
    for (const result of pushed || []) {
      if (['applied', 'duplicate'].includes(result.status)) accepted.add(result.mutationId);
      if (result.status === 'conflict') {
        account.conflicts.push({ ...result, createdAt: iso(), mutationId: result.mutationId });
        accepted.add(result.mutationId);
      }
      const mutation = outgoing.find(item => item.mutationId === result.mutationId);
      if (mutation && result.status === 'applied') { const key = `${mutation.entityType}|${mutation.entityId}`; account.entities[key] = { ...(account.entities[key] || {}), revision: Number(result.revision || 0), deviceId: this.meta.deviceId, updatedAt: mutation.createdAt, deletedAt: mutation.operation === 'delete' ? mutation.createdAt : null }; }
    }
    account.outbox = account.outbox.filter(item => !accepted.has(item.mutationId));
    let cursor = account.cursor ? new Date(account.cursor) : null; let cursorEntity = account.cursorEntity || '';
    const items = []; let hasMore = true; let pages = 0;
    while (hasMore && pages++ < 20) {
      const pulled = await call('/rest/v1/rpc/pull_changes', { method: 'POST', body: { p_cursor: cursor ? cursor.toISOString() : null, p_cursor_entity: cursorEntity, p_limit: 500 } });
      const page = pulled?.items || []; items.push(...page);
      if (!pulled?.nextCursor || !pulled?.hasMore) { hasMore = false; if (pulled?.nextCursor) { cursor = new Date(pulled.nextCursor.updatedAt); cursorEntity = pulled.nextCursor.entity || ''; } }
      else { cursor = new Date(pulled.nextCursor.updatedAt); cursorEntity = pulled.nextCursor.entity || ''; }
    }
    for (const entity of items) {
      const key = `${entity.entityType}|${entity.entityId}`;
      account.entities[key] = entity;
    }
    if (cursor) { account.cursor = cursor.toISOString(); account.cursorEntity = cursorEntity; }
    account.lastSyncedAt = iso(); this.save();
    return { pushed: accepted.size, pulled: items, conflicts: account.conflicts.length, cursor: account.cursor };
  }

  // Read the complete cloud snapshot without changing the device cursor or
  // local state.  The first-login screen uses this to show a safe merge
  // preview before anything is uploaded or replaced.
  async previewCloud() {
    const account = this.account(); if (!account || !this.meta.session) throw new Error('请先登录同步账号');
    let access = this.meta.session.accessToken;
    const call = async (pathname, options) => {
      try { return await this.request(pathname, { ...options, accessToken: access }); }
      catch (error) {
        if (await this.refreshSession()) { access = this.meta.session.accessToken; return this.request(pathname, { ...options, accessToken: access }); }
        throw error;
      }
    };
    const entities = [];
    let cursor = null; let cursorEntity = ''; let hasMore = true; let pages = 0;
    while (hasMore && pages++ < 20) {
      const page = await call('/rest/v1/rpc/pull_changes', {
        method: 'POST', body: { p_cursor: cursor, p_cursor_entity: cursorEntity, p_limit: 500 }
      });
      entities.push(...(Array.isArray(page?.items) ? page.items : []));
      hasMore = Boolean(page?.hasMore && page?.nextCursor);
      if (page?.nextCursor) { cursor = page.nextCursor.updatedAt; cursorEntity = page.nextCursor.entity || ''; }
    }
    return { entities, accountId: this.meta.currentAccountId, generatedAt: iso() };
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
    try { await this.request('/rest/v1/rpc/delete_account', { method: 'POST', body: {}, accessToken: this.meta.session.accessToken }); }
    catch (error) { if (!(await this.refreshSession())) throw error; await this.request('/rest/v1/rpc/delete_account', { method: 'POST', body: {}, accessToken: this.meta.session.accessToken }); }
    const localSnapshot = this.account()?.localSnapshot || null;
    if (localSnapshot) this.meta.pendingLocalSnapshot = clone(localSnapshot);
    this.meta.session = null; this.meta.currentAccountId = null; this.meta.accounts = {}; this.save(); return this.status();
  }

  async listConflicts() {
    if (!this.meta.session) return [];
    const query = '/rest/v1/sync_conflicts?status=eq.open&order=created_at.desc&limit=50';
    const request = () => this.request(query, { accessToken: this.meta.session.accessToken });
    try {
      const rows = await request();
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (!(await this.refreshSession())) throw error;
      const rows = await this.request(query, { accessToken: this.meta.session.accessToken });
      return Array.isArray(rows) ? rows : [];
    }
  }

  async resolveConflict(conflictId, resolution) {
    if (!this.meta.session) throw new Error('请先登录同步账号');
    const id = String(conflictId || '').trim();
    if (!id || !resolution || typeof resolution !== 'object' || Array.isArray(resolution)) throw new Error('冲突解决参数无效');
    const existing = (await this.listConflicts()).find(item => String(item.conflict_id || item.conflictId) === id);
    const body = { p_conflict_id: id, p_resolution: resolution };
    const call = async () => this.request('/rest/v1/rpc/resolve_conflict', { method: 'POST', body, accessToken: this.meta.session.accessToken });
    let result;
    try { result = await call(); }
    catch (error) {
      if (!(await this.refreshSession())) throw error;
      result = await call();
    }
    const account = this.account();
    if (account) account.conflicts = (account.conflicts || []).filter(item => item.conflictId !== id && item.conflict_id !== id && (!existing?.mutation_id || item.mutationId !== existing.mutation_id));
    this.save();
    return result;
  }

  async acquireFocusLease(sessionId, leaseSeconds = 90) {
    if (!this.meta.session) return true;
    const data = await this.request('/rest/v1/rpc/acquire_focus_lease', { method: 'POST', body: { p_device_id: this.meta.deviceId, p_session_id: sessionId, p_lease_seconds: leaseSeconds }, accessToken: this.meta.session.accessToken });
    if (!data?.ok) return false;
    return true;
  }

  async releaseFocusLease(sessionId = null) {
    if (!this.meta.session) return false;
    return Boolean(await this.request('/rest/v1/rpc/release_focus_lease', { method: 'POST', body: { p_device_id: this.meta.deviceId, p_session_id: sessionId }, accessToken: this.meta.session.accessToken }));
  }
}

module.exports = { SyncService, projectState, applyEntities, DURABLE_TYPES };
