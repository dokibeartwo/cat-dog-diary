import { supabase } from './supabase';

export type AuthState = { email: string; signedIn: boolean; configured: boolean; userId?: string };

export async function requestEmailCode(email: string): Promise<void> {
  if (!email.trim()) throw new Error('请输入邮箱');
  if (!supabase) throw new Error('尚未配置同步服务，请在 .env.local 填入 Supabase URL 和 publishable key。');
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  if (!email.trim() || !token.trim()) throw new Error('请输入邮箱和验证码');
  if (!supabase) throw new Error('尚未配置同步服务，请在 .env.local 填入 Supabase URL 和 publishable key。');
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  if (error) throw error;
}

export async function signOut(): Promise<void> { if (supabase) await supabase.auth.signOut(); }

export async function getAuthState(): Promise<AuthState> {
  if (!supabase) return { email: '', signedIn: false, configured: false };
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  return { email: session?.user.email ?? '', signedIn: !!session, configured: true, userId: session?.user.id };
}
