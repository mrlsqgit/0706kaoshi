// Neon PostgreSQL 数据库客户端（Serverless）
// 替换了原有的 Supabase 连接

import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
let _configured: boolean | null = null;

function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL 未配置，请在环境变量中设置 Neon 数据库连接串');
  }
  _sql = neon(url);
  return _sql;
}

export function isDbConfigured(): boolean {
  if (_configured !== null) return _configured;
  const url = process.env.DATABASE_URL;
  // 检测占位符
  const isPlaceholder = !url
    || url.includes('your-')
    || url.includes('localhost')
    || url.includes('placeholder')
    || url.length < 20;
  _configured = !isPlaceholder;
  return _configured;
}

export { getSql };
