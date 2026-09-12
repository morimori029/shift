'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Floor } from '@/types';
import { useToast } from '@/components/Toast';
import { getBackupStatus, runBackupNow } from '@/server/actions/backupStatus';

const NAV_ITEMS = [
  { href: '/staff', label: 'スタッフ管理', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { href: '/settings', label: 'シフト設定', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  { href: '/pairs', label: '相性設定', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' },
  { href: '/shift', label: 'シフト表', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
  { href: '/daily', label: '日別カレンダー', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
];

const PAGE_TITLES: Record<string, string> = {
  '/staff': 'スタッフ管理',
  '/settings': 'シフト設定',
  '/pairs': '相性設定',
  '/shift': 'シフト表',
  '/daily': '日別カレンダー',
};

const FLOORS: Floor[] = ['1F', '2F', '非常勤'];
const FLOOR_TAB_COLOR: Record<Floor, string> = {
  '1F': 'text-blue-500 border-blue-500',
  '2F': 'text-violet-600 border-violet-500',
  '非常勤': 'text-emerald-600 border-emerald-500',
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const currentFloor = (searchParams.get('floor') as Floor | null) ?? '1F';
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  const withFloor = (href: string, floor: Floor) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('floor', floor);
    return `${href}?${params.toString()}`;
  };

  useEffect(() => {
    getBackupStatus().then(res => setLastBackupAt(res.latest?.createdAt ?? null)).catch(() => {});
  }, []);

  const handleBackupNow = async () => {
    setBackingUp(true);
    try {
      const result = await runBackupNow();
      setLastBackupAt(result.createdAt);
      toast.show('サーバーにバックアップを保存しました');
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="w-56 shrink-0 flex flex-col text-white" style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' }}>
        <div className="px-4 py-5 border-b border-white/10">
          <h1 className="text-base font-bold tracking-wide">シフト管理</h1>
          <p className="text-xs text-slate-400 mt-1">介護施設シフト自動作成</p>
        </div>
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={withFloor(item.href, currentFloor)}
                className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-sm border-l-[3px] transition-colors ${
                  isActive
                    ? 'bg-blue-500/10 text-white border-blue-400 font-semibold'
                    : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-white/10 space-y-1.5">
          <button
            onClick={() => void handleBackupNow()}
            disabled={backingUp}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {backingUp ? 'バックアップ中...' : '今すぐバックアップ'}
          </button>
          <a
            href="/api/backup"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            バックアップをダウンロード
          </a>
          <p className="text-[10px] text-slate-600 text-center pt-1">
            v2.0（Next.js版）
            {lastBackupAt && ` | 最終: ${new Date(lastBackupAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white px-7 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">{PAGE_TITLES[pathname] ?? ''}</h2>
        </div>

        <div className="bg-white px-7 border-b border-slate-200 flex shrink-0">
          {FLOORS.map(f => {
            const isActive = currentFloor === f;
            return (
              <Link
                key={f}
                href={withFloor(pathname, f)}
                className={`px-6 py-2.5 text-sm font-semibold border-b-[2.5px] transition-colors ${
                  isActive ? FLOOR_TAB_COLOR[f] : 'text-slate-500 border-transparent hover:text-slate-800'
                }`}
              >
                {f}
              </Link>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto p-6">{children}</div>
      </div>
    </div>
  );
}
