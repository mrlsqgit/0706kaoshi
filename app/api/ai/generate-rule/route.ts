import { NextResponse } from 'next/server';
import { generateRuleFromAI } from '@/lib/ai';
import { FileType } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { filePreview, fileName, fileType } = body as {
      filePreview: unknown;
      fileName: string;
      fileType: FileType;
    };

    if (!filePreview || !fileName || !fileType) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const result = await generateRuleFromAI(filePreview, fileName, fileType);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      rule: result.rule,
      analysis: result.analysis,
      confidence: result.confidence,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI 规则生成失败: ${err}` },
      { status: 500 }
    );
  }
}
