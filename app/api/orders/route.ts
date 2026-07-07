import { NextResponse } from 'next/server';
import { getOrders, createOrders, checkDuplicateExternalCodes } from '@/lib/db';
import { OrderRecord } from '@/lib/types';

/** 将请求体中的原始数据转换为 OrderRecord */
function toOrderRecords(orders: Record<string, unknown>[]): OrderRecord[] {
  return orders.map((o) => ({
    id: String(o.id || ''),
    externalCode: String(o.externalCode || ''),
    storeName: String(o.storeName || ''),
    receiverName: String(o.receiverName || ''),
    receiverPhone: String(o.receiverPhone || ''),
    receiverAddress: String(o.receiverAddress || ''),
    skuCode: String(o.skuCode || ''),
    skuName: String(o.skuName || ''),
    skuQuantity: Number(o.skuQuantity) || 0,
    skuSpec: String(o.skuSpec || ''),
    remark: String(o.remark || ''),
    batchId: o.batchId ? String(o.batchId) : undefined,
    createdAt: o.createdAt ? String(o.createdAt) : undefined,
  }));
}

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
    const { orders: rawOrders } = body as { orders: Record<string, unknown>[] };

    if (!rawOrders || !Array.isArray(rawOrders) || rawOrders.length === 0) {
      return NextResponse.json({ error: '运单数据不能为空' }, { status: 400 });
    }

    // 转换为类型安全的 OrderRecord
    const orders = toOrderRecords(rawOrders);

    // 检查外部编码重复
    const codes = orders
      .map((o) => o.externalCode)
      .filter((c) => c);
    const duplicates = await checkDuplicateExternalCodes(codes);

    if (duplicates.length > 0) {
      const dupSet = new Set(duplicates);
      const validOrders = orders.filter(
        (o) => !dupSet.has(o.externalCode)
      );

      if (validOrders.length === 0) {
        return NextResponse.json(
          { error: '所有运单编码均已存在', duplicates, canForceSubmit: true, totalCount: orders.length, successCount: 0 },
          { status: 409 }
        );
      }

      const created = await createOrders(validOrders);
      return NextResponse.json({
        success: created.length > 0,
        totalCount: orders.length,
        successCount: created.length,
        failCount: orders.length - created.length,
        duplicates,
      }, { status: 409 });
    }

    const created = await createOrders(orders);
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
