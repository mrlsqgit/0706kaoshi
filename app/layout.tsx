import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import Link from 'next/link';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: '智能多格式批量下单系统 V2',
  description: '万能导入 - AI 驱动的智能批量下单系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f7f8fa]">
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: '8px',
              padding: '12px 16px',
              fontSize: '14px',
            },
          }}
        />
        <header className="bg-white border-b border-[#e5e6eb] sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 no-underline">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: 'linear-gradient(135deg, #0fc6c2, #4fc4c4)' }}>
                S
              </div>
              <span className="text-lg font-bold text-[#1d2129]">
                万能导入 <span className="text-[#0fc6c2] font-normal">V2</span>
              </span>
            </Link>
            <NavBar />
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
