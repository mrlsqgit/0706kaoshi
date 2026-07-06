import { NextResponse } from 'next/server';
import { getRules, createRule } from '@/lib/db';

export async function GET() {
  try {
    const rules = await getRules();
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ error: '获取规则列表失败' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rule = await createRule(body);
    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: '创建规则失败' }, { status: 500 });
  }
}
