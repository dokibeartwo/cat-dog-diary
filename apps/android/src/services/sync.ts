import type { SyncAdapter, SyncCursor, SyncEntity, SyncMutation } from '../core/sync/types';
import { supabase } from './supabase';
import { activeDataset, readReplica, writeReplica, commitFirstMerge, getDeviceId, newId, localStore, accountDeleted, getMeta } from './local-db';
const journal = require('../../../../packages/core/src/replica');
const { validateEntity } = require('../../../../packages/core/src/projection');
export type MergePreview = { token: string; localEntities: number; cloudEntities: number; local: Record<string,number>; cloud: Record<string,number> };

export class SyncService {
  private running: Promise<{uploaded:number;downloaded:number;conflicts:number}> | null=null;
  private previewData: {token:string;dataset:string;account:string;fingerprint:string;cloud:SyncEntity[];local:SyncEntity[];at:number} | null=null;
  constructor(_store: typeof localStore,private readonly adapter: SyncAdapter) {}
  private async context() {
    const dataset=activeDataset(), account=await this.adapter.identity();
    if (!account) throw Error('请先登录');
    const check=async () => { if (activeDataset()!==dataset || await this.adapter.identity()!==account) throw Error('同步账号已变化，请重试'); };
    return {dataset,account,check};
  }
  private async pullAll(cursor: SyncCursor,check:()=>Promise<void>) {
    const entities: SyncEntity[]=[];
    for (let i=0;i<1000;i++) {
      await check(); const page=await this.adapter.pull(cursor); await check();
      for (const e of page.entities) validateEntity(e);
      entities.push(...page.entities);
      if (page.hasMore && (!page.cursor || journal.equal(page.cursor,cursor))) throw Error('云端游标未前进');
      cursor=page.cursor || cursor;
      if (!page.hasMore) return {entities,cursor};
    }
    throw Error('同步数据过多，未改变本机数据，请联系维护者');
  }
  async preview(): Promise<MergePreview> {
    const ctx=await this.context(),local=journal.materialize(readReplica(ctx.dataset)) as SyncEntity[];
    const page=await this.pullAll(null,ctx.check), token=newId('preview');
    const stats=journal.mergePreview(local,page.entities);
    this.previewData={token,dataset:ctx.dataset,account:ctx.account,fingerprint:stats.fingerprint,cloud:page.entities,local,at:Date.now()};
    return {token,localEntities:stats.localEntities,cloudEntities:stats.cloudEntities,local:stats.local,cloud:stats.cloud};
  }
  async merge(token: string): Promise<void> {
    const ctx=await this.context(),p=this.previewData;
    if (!p || p.token!==token || p.dataset!==ctx.dataset || p.account!==ctx.account || Date.now()-p.at>600000) throw Error('同步预览已过期，请重新预览');
    if (p.fingerprint!==journal.fingerprint(journal.materialize(readReplica(ctx.dataset)))) throw Error('预览后本机数据已修改，请重新预览');
    const merged=journal.prepareMerge(p.local,p.cloud,()=>newId(getDeviceId()),getDeviceId());
    commitFirstMerge(merged,ctx.dataset); this.previewData=null;
  }
  async run(): Promise<{uploaded:number;downloaded:number;conflicts:number}> {
    if (this.running) return this.running;
    this.running=this.exchange();
    try { return await this.running; } finally { this.running=null; }
  }
  private async exchange() {
    const ctx=await this.context(),r=readReplica(ctx.dataset);
    if (!r.migrated) throw Error('请先预览并确认首次同步');
    if (getMeta('sync.paused',false)) throw Error('同步已暂停');
    const outgoing=r.outbox.slice(); outgoing.forEach(m=>{m.attempted=true;}); writeReplica(r,ctx.dataset);
    const results: any[]=[];
    for (let i=0;i<outgoing.length;i+=100) {
      await ctx.check(); const rows=await this.adapter.push(outgoing.slice(i,i+100).map(journal.transportMutation)); await ctx.check();
      if (!Array.isArray(rows) || rows.some(row=>!['applied','duplicate','conflict'].includes(row.status))) throw Error('云端拒绝了操作，修改仍在本机保留');
      results.push(...rows);
    }
    const page=await this.pullAll(r.cursor,ctx.check); await ctx.check();
    // Read AGAIN after network awaits: edits made while syncing are included.
    const current=readReplica(ctx.dataset);
    journal.commitExchange(current,results,page.entities,page.cursor); current.lastSyncedAt=new Date().toISOString();
    writeReplica(current,ctx.dataset);
    return {uploaded:results.filter(row=>row.status!=='conflict').length,downloaded:page.entities.length,conflicts:current.conflicts.length};
  }
}
export function createSupabaseAdapter(): SyncAdapter | null {
  const client=supabase; if (!client) return null;
  return {
    async identity() { const {data,error}=await client.auth.getSession(); if(error) throw error; return data.session?.user.id || ''; },
    async push(mutations: SyncMutation[]) { const {data,error}=await client.rpc('push_mutations',{p_mutations:mutations}); if(error) throw error; return data; },
    async pull(cursor: SyncCursor) {
      const {data,error}=await client.rpc('pull_changes',{p_cursor:cursor?.updatedAt ?? null,p_cursor_entity:cursor?.entityId ?? '',p_limit:500});
      if(error) throw error;
      if (!Array.isArray(data?.items)) throw Error('同步响应无效');
      return {entities:data.items,cursor:data.nextCursor ? {updatedAt:data.nextCursor.updatedAt,entityId:data.nextCursor.entity} : cursor,hasMore:data.hasMore===true};
    }
  };
}
export async function acquireFocusLease(deviceId:string,sessionId:string,seconds=90):Promise<boolean> {
  if(!supabase) return true;
  const {data:session}=await supabase.auth.getSession(); if(!session.session) return true;
  const {data,error}=await supabase.rpc('acquire_focus_lease',{p_device_id:deviceId,p_session_id:sessionId,p_lease_seconds:seconds});
  if(error) throw error; return data?.ok===true;
}
export async function releaseFocusLease(deviceId:string,sessionId?:string):Promise<void> {
  if(!supabase) return;
  const {data:session}=await supabase.auth.getSession(); if(!session.session) return;
  const {error}=await supabase.rpc('release_focus_lease',{p_device_id:deviceId,p_session_id:sessionId ?? null}); if(error) throw error;
}
export async function deleteCloudAccount():Promise<void> {
  if(!supabase) throw Error('尚未配置同步服务');
  const {error}=await supabase.rpc('delete_account'); if(error) throw error;
  await supabase.auth.signOut({scope:'local'}); accountDeleted();
}
export async function listConflicts(): Promise<any[]> {
  if(!supabase) return [];
  const {data,error}=await supabase.from('sync_conflicts').select('*').eq('status','open').order('created_at').limit(100);
  if(error) throw error; return data || [];
}
export async function resolveConflict(conflict:any,resolution:Record<string,unknown>):Promise<void> {
  if(!supabase) throw Error('尚未配置同步服务');
  const {data,error}=await supabase.rpc('resolve_conflict',{p_conflict_id:conflict.conflict_id,p_resolution:{...resolution,expectedRevision:conflict.remote_revision}});
  if(error) throw error; if(!data?.resolved) throw Error('云端在选择期间又发生变化，请重新读取冲突');
  const r=readReplica(); r.conflicts=r.conflicts.filter(c=>c.mutationId!==conflict.mutation_id); writeReplica(r);
}
