import { NextResponse } from 'next/server';
import { getRules, createRule } from '@/lib/db';

// GET /api/rules — 获取所有解析规则
export async function GET() {
  try {
    const rules = await getRules();
    return NextResponse.json({ rules });
  } catch (err) {
    console.error('[API/rules] GET error:', err);
    return NextResponse.json({ error: '获取规则列表失败' }, { status: 500 });
  }
}

// POST /api/rules — 创建新解析规则
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rule = await createRule(body);
    return NextResponse.json({ rule });
  } catch (err) {
    console.error('[API/rules] POST error:', err);
    return NextResponse.json({ error: `创建规则失败: ${err instanceof Error ? err.message : '未知错误'}` }, { status: 500 });
  }
}
