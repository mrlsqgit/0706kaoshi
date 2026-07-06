import { NextResponse } from 'next/server';
import { getRules, createRule, updateRule, deleteRule } from '@/lib/db';

export async function GET() {
  try {
    const rules = await getRules();
    return NextResponse.json({ rules });
  } catch (err) {
    console.error('[API/rules] GET error:', err);
    return NextResponse.json({ error: '获取规则列表失败' }, { status: 500 });
  }
}

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

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: '缺少规则 ID' }, { status: 400 });
    }
    const rule = await updateRule(id, updates);
    if (!rule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    return NextResponse.json({ rule });
  } catch (err) {
    console.error('[API/rules] PUT error:', err);
    return NextResponse.json({ error: `更新规则失败: ${err instanceof Error ? err.message : '未知错误'}` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '缺少规则 ID' }, { status: 400 });
    }
    const ok = await deleteRule(id);
    if (!ok) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/rules] DELETE error:', err);
    return NextResponse.json({ error: `删除规则失败: ${err instanceof Error ? err.message : '未知错误'}` }, { status: 500 });
  }
}
