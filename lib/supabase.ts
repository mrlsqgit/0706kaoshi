// Supabase 客户端初始化

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** 占位符模式检测 */
const PLACEHOLDER_PATTERNS = [
  'your-project-id',
  'your-anon-key',
  'placeholder',
  '<your',
  'xxx',
  'TODO',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p)) || value.length < 10;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function isSupabaseConfigured(): boolean {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseAnonKey)) return false;
  return true;
}
