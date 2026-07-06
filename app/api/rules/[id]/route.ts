import { NextResponse } from 'next/server';
import { getRule, updateRule, deleteRule } from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const rule = await getRule(params.id);
    if (!rule) return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: '获取规则失败' }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const rule = await updateRule(params.id, body);
    if (!rule) return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: '更新规则失败' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = await deleteRule(params.id);
    if (!deleted) return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '删除规则失败' }, { status: 500 });
  }
}
