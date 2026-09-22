import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const secureStorage = {
  // SecureStore permits only [A-Za-z0-9._-] in keys. Colons previously made
  // every persisted login fail. Each chunk also stays below the 2 KB limit.
  async getItem(key: string) {
    const prefix=`catdog.${key.replace(/[^A-Za-z0-9._-]/g,'_')}`;
    const header=await SecureStore.getItemAsync(prefix);
    if(!header) return null;
    const {generation,count}=JSON.parse(header);
    const chunks=await Promise.all(Array.from({length:count},(_,i)=>SecureStore.getItemAsync(`${prefix}.${generation}.${i}`)));
    if(chunks.some(c=>c===null)) return null;
    return chunks.join('');
  },
  async setItem(key:string,value:string) {
    const prefix=`catdog.${key.replace(/[^A-Za-z0-9._-]/g,'_')}`, generation=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const old=await SecureStore.getItemAsync(prefix), chunks=value.match(/[\s\S]{1,400}/g) || [''];
    await Promise.all(chunks.map((chunk,i)=>SecureStore.setItemAsync(`${prefix}.${generation}.${i}`,chunk)));
    await SecureStore.setItemAsync(prefix,JSON.stringify({generation,count:chunks.length}));
    if(old) { const meta=JSON.parse(old); await Promise.all(Array.from({length:meta.count},(_,i)=>SecureStore.deleteItemAsync(`${prefix}.${meta.generation}.${i}`))); }
  },
  async removeItem(key:string) {
    const prefix=`catdog.${key.replace(/[^A-Za-z0-9._-]/g,'_')}`,old=await SecureStore.getItemAsync(prefix);
    await SecureStore.deleteItemAsync(prefix);
    if(old) {const meta=JSON.parse(old); await Promise.all(Array.from({length:meta.count},(_,i)=>SecureStore.deleteItemAsync(`${prefix}.${meta.generation}.${i}`)));}
  }
};

/** Returns null until the developer configures .env.local. Never silently mocks a login. */
export const supabase: SupabaseClient | null = url && publishableKey ? createClient(url, publishableKey, {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;

export function isCloudConfigured(): boolean { return supabase !== null; }
