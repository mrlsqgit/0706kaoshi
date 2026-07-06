import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import NavBar from '@/components/NavBar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '万能导入 V2 - 智能多格式批量下单系统',
  description: '智能多格式批量下单系统 V2',
};

function DbStatusIndicator() {
  // 服务端渲染时检查 Supabase 配置
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const isConfigured = supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id');

  if (isConfigured) return null;

  return (
    <div style={{
      background: '#fff7e8',
      borderBottom: '1px solid #ffe4ba',
      padding: '6px 16px',
      textAlign: 'center',
      fontSize: 13,
      color: '#d97b00',
    }}>
      ⚠️ 数据库未配置（使用内存存储，数据不会持久化）。请配置 .env.local 中的 Supabase 连接信息。
    </div>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <DbStatusIndicator />
        <NavBar />
        <main className="min-h-screen bg-[#f7f8fa] py-6 px-4">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
