import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { Floor } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';
import { exportAppData, importAppData } from '../lib/dataIO';

const NAV_ITEMS = [
  { id: 'staff', label: 'スタッフ管理', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'settings', label: 'シフト設定', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  { id: 'pairs', label: '相性設定', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' },
  { id: 'shift', label: 'シフト表', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
];

const PAGE_TITLES: Record<string, string> = {
  staff: 'スタッフ管理',
  settings: 'シフト設定',
  pairs: '相性設定',
  shift: 'シフト表',
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  currentPage: string;
  onPageChange: (page: string) => void;
  currentFloor: Floor;
  onFloorChange: (f: Floor) => void;
  currentYear: number;
  currentMonth: number;
  onMonthChange: (y: number, m: number) => void;
  children: ReactNode;
}

export default function Layout({ currentPage, onPageChange, currentFloor, onFloorChange, currentYear, currentMonth, onMonthChange, children }: Props) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    exportAppData(state);
    toast.show('データを保存しました');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importAppData(file);
      if (!confirm('現在のデータは上書きされます。よろしいですか？')) return;
      dispatch({ type: 'RESTORE_ALL', payload: data });
      toast.show('データを読み込みました');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '読み込みに失敗しました', 'error');
    }
    e.target.value = '';
  };

  const prevMonth = () => {
    if (currentMonth === 1) onMonthChange(currentYear - 1, 12);
    else onMonthChange(currentYear, currentMonth - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 12) onMonthChange(currentYear + 1, 1);
    else onMonthChange(currentYear, currentMonth + 1);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <div className="w-56 shrink-0 flex flex-col text-white" style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' }}>
        <div className="px-4 py-5 border-b border-white/10">
          <h1 className="text-base font-bold tracking-wide">シフト管理</h1>
          <p className="text-xs text-slate-400 mt-1">介護施設シフト自動作成</p>
        </div>
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-sm border-l-[3px] transition-colors ${currentPage === item.id
                  ? 'bg-blue-500/10 text-white border-blue-400 font-semibold'
                  : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-slate-200'
                }`}
            >
              <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-white/10 space-y-1.5">
          <button
            onClick={handleExport}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            データ保存（書き出し）
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            データ読み込み
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <p className="text-[10px] text-slate-600 text-center pt-1">v1.1</p>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white px-7 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold">{PAGE_TITLES[currentPage]}</h2>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold">
              <button onClick={prevMonth} className="text-blue-500 hover:text-blue-700 px-1">&larr;</button>
              <span>{currentYear}年 {currentMonth}月</span>
              <button onClick={nextMonth} className="text-blue-500 hover:text-blue-700 px-1">&rarr;</button>
            </div>
          </div>
        </div>

        {/* Floor Tabs */}
        <div className="bg-white px-7 border-b border-slate-200 flex shrink-0">
          {(['1F', '2F', '非常勤'] as Floor[]).map(f => {
            const isActive = currentFloor === f;
            // タブの色: 1F=青, 2F=紫, 非常勤=緑
            const activeColor = f === '非常勤'
              ? 'text-emerald-600 border-emerald-500'
              : f === '2F'
                ? 'text-violet-600 border-violet-500'
                : 'text-blue-500 border-blue-500';
            return (
              <button
                key={f}
                onClick={() => onFloorChange(f)}
                className={`px-6 py-2.5 text-sm font-semibold border-b-[2.5px] transition-colors ${isActive
                    ? activeColor
                    : 'text-slate-500 border-transparent hover:text-slate-800'
                  }`}
              >
                {f}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
