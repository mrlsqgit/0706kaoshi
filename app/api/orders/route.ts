import { NextResponse } from 'next/server';
import { getOrders, createOrders, checkDuplicateExternalCodes } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const externalCode = searchParams.get('externalCode') || undefined;
    const receiverName = searchParams.get('receiverName') || undefined;
    const createdAtStart = searchParams.get('createdAtStart') || undefined;
    const createdAtEnd = searchParams.get('createdAtEnd') || undefined;

    const result = await getOrders(page, pageSize, {
      externalCode,
      receiverName,
      createdAtStart,
      createdAtEnd,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `获取运单列表失败: ${err}` }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { orders } = body as { orders: Record<string, unknown>[] };

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: '运单数据不能为空' }, { status: 400 });
    }

    // 检查外部编码重复
    const codes = orders
      .map((o) => String(o.externalCode || ''))
      .filter((c) => c);
    const duplicates = await checkDuplicateExternalCodes(codes);

    if (duplicates.length > 0) {
      const dupSet = new Set(duplicates);
      // 过滤掉重复的，只提交不重复的
      const validOrders = orders.filter(
        (o) => !dupSet.has(String(o.externalCode || ''))
      );

      if (validOrders.length === 0) {
        return NextResponse.json(
          { error: '所有运单编码均已存在', duplicates, canForceSubmit: true, totalCount: orders.length, successCount: 0 },
          { status: 409 }
        );
      }

      const created = await createOrders(validOrders as any);
      return NextResponse.json({
        success: created.length > 0,
        totalCount: orders.length,
        successCount: created.length,
        failCount: orders.length - created.length,
        duplicates,
      }, { status: 409 });
    }

    const created = await createOrders(orders as unknown[]);
    return NextResponse.json({
      success: true,
      totalCount: orders.length,
      successCount: created.length,
      failCount: 0,
    });
  } catch (err) {
    return NextResponse.json({ error: `提交运单失败: ${err}` }, { status: 500 });
  }
}
