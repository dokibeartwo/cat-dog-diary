import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(`catdog:${key}`),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(`catdog:${key}`, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(`catdog:${key}`)
};

/** Returns null until the developer configures .env.local. Never silently mocks a login. */
export const supabase: SupabaseClient | null = url && publishableKey ? createClient(url, publishableKey, {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;

export function isCloudConfigured(): boolean { return supabase !== null; }
