import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: '万能导入 V2 - 智能多格式批量下单系统',
  description: '智能多格式批量下单系统 V2',
};

function DbStatusIndicator() {
  const dbUrl = process.env.DATABASE_URL || '';
  const isConfigured = dbUrl && !dbUrl.includes('your-') && dbUrl.length > 20;

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
      ⚠️ 数据库未配置（使用内存存储，数据不会持久化）。请在 .env.local 中设置 DATABASE_URL。
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
      <body className="font-sans antialiased">
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
