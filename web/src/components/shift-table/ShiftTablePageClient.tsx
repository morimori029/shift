'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { autoFillShift, regenerateShift, applyPattern, clearAssignments, setCarryoverAke, type SchedulePattern, type ShiftTableData } from '@/server/actions/schedule';
import { setAssignment, toggleLock, setAssignmentDuty } from '@/server/actions/assignments';
import type { Floor, DutyType } from '@/types';
import { ALL_DUTIES, DUTY_LABELS } from '@/types';
import { DENSITY_STYLE, DUTY_COLORS, DOW_LABELS, dateStr, type Density } from './constants';
import CoverageSummary from './CoverageSummary';
import FloorMiniTable from './FloorMiniTable';

interface Props {
  floor: Floor;
  year: number;
  month: number;
  data: ShiftTableData;
  compareData: { '1F': ShiftTableData; '2F': ShiftTableData };
}

export default function ShiftTablePageClient({ floor, year, month, data, compareData }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();

  const { staff, shiftTypes, config, holidays, daysInMonth, prevMonthCarryoverStaffIds } = data;

  const [generating, setGenerating] = useState(false);
  const [patterns, setPatterns] = useState<SchedulePattern[]>([]);
  const [currentPatternIdx, setCurrentPatternIdx] = useState(0);
  const [showPatternDetail, setShowPatternDetail] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarningDetail, setShowWarningDetail] = useState(false);
  const [density, setDensity] = useState<Density>('spacious');
  const [compareMode, setCompareMode] = useState(false);
  const [expandedFloors, setExpandedFloors] = useState<Set<Floor>>(new Set());
  const [activeCell, setActiveCell] = useState<{ staffId: string; date: string; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const assignments = patterns.length > 0 ? patterns[currentPatternIdx].assignments : data.assignments;
  const isPreview = patterns.length > 0;
  const D = DENSITY_STYLE[density];

  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypes.map(st => [st.id, st])), [shiftTypes]);
  const editableShiftTypes = shiftTypes.filter(st => !st.isAke).sort((a, b) => a.order - b.order);
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  const monthDays = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const date = dateStr(year, month, d);
      const dow = new Date(year, month - 1, d).getDay();
      return { d, date, dow, isHoliday: holidaySet.has(date) };
    }),
    [year, month, daysInMonth, holidaySet]
  );

  useEffect(() => {
    if (!activeCell) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setActiveCell(null);
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [activeCell]);

  const gotoMonth = (y: number, m: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', String(y));
    params.set('month', String(m));
    router.push(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (activeCell || isPreview) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        gotoMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        gotoMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, activeCell, isPreview]);

  const findAssignment = (staffId: string, date: string) => assignments.find(a => a.staffId === staffId && a.date === date);

  const calcStats = (staffId: string) => {
    const sa = assignments.filter(a => a.staffId === staffId);
    const PARTIAL = new Set(['half_am', 'half_pm', 'short']);
    const work = sa.filter(a => a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid' && !PARTIAL.has(a.shiftTypeId)).length;
    const night = sa.filter(a => shiftTypeMap[a.shiftTypeId]?.isNightShift).length;
    const off = sa.filter(a => a.shiftTypeId === 'off').length;
    const paid = sa.filter(a => a.shiftTypeId === 'paid').length;
    return { work, night, off, paid };
  };

  const handleAutoFill = async () => {
    if (staff.length === 0) { toast.show('スタッフが登録されていません', 'error'); return; }
    setGenerating(true);
    const res = await autoFillShift(floor, year, month);
    setGenerating(false);
    setWarnings(res.warnings);
    toast.show(res.warnings.length > 0 ? `自動生成完了（注意${res.warnings.length}件）` : '空欄を自動で埋めました', res.warnings.length > 0 ? 'error' : 'success');
    router.refresh();
  };

  const handleRegenerate = async () => {
    if (staff.length === 0) { toast.show('スタッフが登録されていません', 'error'); return; }
    if (!confirm('自動生成分をクリアして作り直します。手入力したシフトは残ります。')) return;
    setGenerating(true);
    const res = await regenerateShift(floor, year, month);
    setGenerating(false);
    if (res.patterns.length === 0) return;
    setPatterns(res.patterns);
    setCurrentPatternIdx(res.bestIndex);
    setWarnings(res.patterns[res.bestIndex].warnings);
    toast.show(`5パターン生成（通常3+最適化2）。スコア最高のパターン${res.bestIndex + 1}を表示中`);
  };

  const handleApply = async () => {
    if (patterns.length === 0) return;
    await applyPattern(floor, year, month, patterns[currentPatternIdx].assignments);
    setPatterns([]);
    toast.show('パターンを適用しました');
    router.refresh();
  };

  const handleDiscardPatterns = () => setPatterns([]);

  const handleClear = async (mode: 'keepManual' | 'all') => {
    const msg = mode === 'all'
      ? 'このフロアの今月のシフトをすべてクリアしますか？\n（🖊 手入力のシフトも含めて削除されます）'
      : 'このフロアの今月のシフトで、手入力以外をすべてクリアしますか？\n（🖊 手入力のシフトは残ります）';
    if (!confirm(msg)) return;
    await clearAssignments(floor, year, month, mode);
    toast.show(mode === 'all' ? 'すべてのシフトをクリアしました' : '手入力以外のシフトをクリアしました');
    router.refresh();
  };

  const handlePickShift = async (staffId: string, date: string, shiftId: string | null) => {
    setActiveCell(null);
    const res = await setAssignment(staffId, date, shiftId);
    if (res.warning) toast.show(res.warning, 'info');
    else if (res.akeInserted) toast.show('翌日に明けを自動設定しました', 'info');
    router.refresh();
  };

  const handleToggleLock = async (e: React.MouseEvent, staffId: string, date: string) => {
    e.stopPropagation();
    if (isPreview) return;
    const a = findAssignment(staffId, date);
    if (!a) return;
    await toggleLock(staffId, date);
    toast.show(a.isManual ? 'セルの固定を解除しました' : 'セルを固定しました（再生成で保持）');
    router.refresh();
  };

  const handleSetDuty = async (staffId: string, date: string, duty: DutyType | null) => {
    await setAssignmentDuty(staffId, date, duty);
    router.refresh();
  };

  const handleCarryover = async () => {
    await setCarryoverAke(floor, year, month, prevMonthCarryoverStaffIds);
    toast.show('前月夜勤スタッフの明けを設定しました');
    router.refresh();
  };

  const emptyCount = staff.reduce((sum, s) => {
    for (const { date } of monthDays) if (!findAssignment(s.id, date)) sum++;
    return sum;
  }, 0);

  const currentPattern = patterns[currentPatternIdx];

  return (
    <div>
      <div className="flex gap-4 mb-5">
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm text-center">
          <div className="text-2xl font-extrabold text-blue-500">{staff.length}</div>
          <div className="text-xs text-slate-500 mt-1">{floor} スタッフ数</div>
        </div>
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm text-center">
          <div className={`text-2xl font-extrabold ${emptyCount > 0 ? 'text-orange-500' : 'text-emerald-500'}`}>{emptyCount}</div>
          <div className="text-xs text-slate-500 mt-1">空欄セル数</div>
        </div>
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm text-center">
          <div className="text-2xl font-extrabold text-slate-500">{daysInMonth}</div>
          <div className="text-xs text-slate-500 mt-1">{month}月の日数</div>
        </div>
      </div>

      {generating && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-slate-700">シフトを生成しています...</p>
          </div>
        </div>
      )}

      {prevMonthCarryoverStaffIds.length > 0 && (
        <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <p className="text-xs text-amber-700">
            前月末に夜勤だったスタッフ（{prevMonthCarryoverStaffIds.map(id => staff.find(s => s.id === id)?.name).filter(Boolean).join('、')}）の1日目は自動生成時に「明け」になります
          </p>
          <button onClick={() => void handleCarryover()} className="text-xs text-amber-600 hover:text-amber-800 font-semibold shrink-0 ml-3">今すぐ明けを設定</button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold">
          <button onClick={() => gotoMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)} className="text-blue-500 hover:text-blue-700 px-1">&larr;</button>
          <span>{year}年 {month}月</span>
          <button onClick={() => gotoMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)} className="text-blue-500 hover:text-blue-700 px-1">&rarr;</button>
        </div>

        <span className="text-sm font-semibold text-slate-600 ml-2">表示密度</span>
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {(['compact', 'standard', 'spacious'] as Density[]).map(d => (
            <button
              key={d}
              onClick={() => setDensity(d)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md ${density === d ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {d === 'compact' ? 'コンパクト' : d === 'standard' ? '標準' : 'ゆったり'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setCompareMode(v => !v)}
          className={`px-3 py-1.5 text-xs rounded-lg font-semibold border transition-colors ${compareMode ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'}`}
        >
          {compareMode ? '比較モード ON（1F/2F）' : '比較モード'}
        </button>

        <div className="ml-auto flex gap-2">
          {!compareMode && (
            <>
              <button onClick={() => void handleClear('keepManual')} className="px-3 py-2 text-xs border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-500">クリア（手入力は残す）</button>
              <button onClick={() => void handleClear('all')} className="px-3 py-2 text-xs border border-rose-200 bg-white rounded-lg hover:bg-rose-50 text-rose-500">クリア（全削除）</button>
              <button onClick={() => void handleAutoFill()} disabled={generating || isPreview} className="px-4 py-2 text-sm bg-slate-600 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50">空欄を埋める</button>
              <button onClick={() => void handleRegenerate()} disabled={generating} className="px-4 py-2 text-sm text-white rounded-lg font-semibold disabled:opacity-50 bg-amber-500 hover:bg-amber-600">作成・更新</button>
            </>
          )}
          <a href={`/api/export/excel?floor=${floor}&year=${year}&month=${month}`} className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-semibold">Excel</a>
        </div>
      </div>

      {!compareMode && patterns.length > 0 && (
        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-blue-700">パターン</span>
            {patterns.map((p, i) => {
              const isBest = p.score && patterns.every(x => !x.score || x.score.total <= p.score!.total);
              return (
                <button
                  key={i}
                  onClick={() => { setCurrentPatternIdx(i); setWarnings(p.warnings); }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-semibold transition-colors ${i === currentPatternIdx ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-100'}`}
                >
                  {p.label}{isBest && ' ★'}
                </button>
              );
            })}
            <div className="flex-1 text-xs text-blue-800 pl-2 border-l border-blue-200 min-w-[200px]">
              採用中: <b>{currentPattern.label}</b> — 不足{currentPattern.score?.unfilledDays ?? '-'}日・NGペア{currentPattern.score?.ngPairViolations ?? '-'}件・夜勤ばらつき{currentPattern.score?.nightStdDev ?? '-'}
            </div>
            <button onClick={() => setShowPatternDetail(v => !v)} className="text-xs text-blue-600 font-semibold hover:underline">{showPatternDetail ? '詳細を閉じる' : '詳細を見る'}</button>
            <button onClick={() => void handleApply()} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">この内容で確定</button>
            <button onClick={handleDiscardPatterns} className="text-xs text-blue-400 hover:text-blue-600">閉じる</button>
          </div>

          {showPatternDetail && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-blue-100/50">
                    <th className="px-2 py-1 text-left text-blue-700 font-semibold border-b border-blue-200">指標</th>
                    {patterns.map((p, i) => (
                      <th key={i} className={`px-2 py-1 text-center border-b border-blue-200 ${i === currentPatternIdx ? 'text-blue-700 font-bold' : 'text-blue-500'}`}>{p.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'total', label: '総合スコア' },
                    { key: 'unfilledDays', label: '人数不足日' },
                    { key: 'consecutiveViolations', label: '連勤違反' },
                    { key: 'ngPairViolations', label: 'NGペア違反' },
                    { key: 'dutyDeficit', label: '業務不足' },
                    { key: 'dutySurplus', label: '業務超過' },
                    { key: 'nightStdDev', label: '夜勤ばらつき' },
                    { key: 'dailySurplusStdDev', label: '出勤人数ばらつき' },
                    { key: 'consecOffRate', label: '連休取得率(%)' },
                    { key: 'offTargetRate', label: '公休達成率(%)' },
                  ].map(row => (
                    <tr key={row.key}>
                      <td className="px-2 py-1 text-slate-600 border-b border-blue-100">{row.label}</td>
                      {patterns.map((p, i) => (
                        <td key={i} className="px-2 py-1 text-center border-b border-blue-100 text-slate-600">
                          {p.score ? (p.score as unknown as Record<string, number>)[row.key] : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!compareMode && warnings.length > 0 && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl">
          <button onClick={() => setShowWarningDetail(v => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
            <span className="text-amber-700 font-bold text-sm">確認事項 {warnings.length}件</span>
            <span className="text-xs text-amber-600">{warnings[0]}{warnings.length > 1 ? ' ほか' : ''}</span>
            <span className="ml-auto text-xs text-amber-600 font-semibold">{showWarningDetail ? '閉じる' : '詳細を見る'} &rsaquo;</span>
          </button>
          {showWarningDetail && (
            <ul className="px-4 pb-3 space-y-1">
              {warnings.map((w, i) => <li key={i} className="text-xs text-amber-800 flex items-start gap-1"><span className="shrink-0 mt-0.5">・</span>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {compareMode ? (
        <div>
          <CoverageSummary year={year} month={month} data1F={compareData['1F']} data2F={compareData['2F']} />
          {(['1F', '2F'] as const).map(f => {
            const isExpanded = expandedFloors.has(f);
            return (
              <div key={f} className="bg-white rounded-xl shadow-sm mb-3 overflow-hidden">
                <button
                  onClick={() => setExpandedFloors(prev => {
                    const next = new Set(prev);
                    if (next.has(f)) next.delete(f); else next.add(f);
                    return next;
                  })}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className={`text-sm font-bold ${f === '2F' ? 'text-violet-700' : 'text-blue-700'}`}>{f}</span>
                  <span className="text-xs text-slate-400">{compareData[f].staff.length}人</span>
                  <span className="ml-auto text-xs text-slate-500 font-semibold">{isExpanded ? '折りたたむ' : '詳細を見る'} &rsaquo;</span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <FloorMiniTable floorLabel={f} data={compareData[f]} year={year} month={month} density={density} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
      <div className="bg-white rounded-xl shadow-sm p-3 overflow-auto max-h-[70vh]">
        <table className="border-collapse text-sm min-w-full">
          <thead>
            <tr>
              <th className={`sticky left-0 top-0 z-30 bg-slate-100 px-3 py-2 text-left ${D.nameW} border border-slate-200 text-xs font-bold shadow-md`} rowSpan={2}>スタッフ</th>
              {monthDays.map(({ d, dow, isHoliday }) => {
                const cls = (dow === 0 || isHoliday) ? 'text-red-600 bg-red-50' : dow === 6 ? 'text-blue-600 bg-blue-50' : 'bg-slate-50';
                return <th key={d} className={`sticky top-0 z-20 ${D.cellW} px-0.5 py-1.5 text-center border border-slate-200 text-xs font-bold ${cls}`}>{d}{isHoliday ? '祝' : ''}</th>;
              })}
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 text-xs font-bold" rowSpan={2}>出勤</th>
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 text-xs font-bold" rowSpan={2}>夜勤</th>
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 text-xs font-bold" rowSpan={2}>公休</th>
            </tr>
            <tr>
              {monthDays.map(({ d, dow, isHoliday }) => {
                const cls = (dow === 0 || isHoliday) ? 'text-red-600 bg-red-50' : dow === 6 ? 'text-blue-600 bg-blue-50' : 'bg-slate-50';
                return <th key={d} className={`sticky top-[30px] z-20 px-0.5 py-0.5 text-center border border-slate-200 text-[11px] ${cls}`}>{isHoliday ? '祝' : DOW_LABELS[dow]}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map(s => {
              const stats = calcStats(s.id);
              return (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-xs font-bold border border-slate-200 border-r-2 border-r-slate-300 whitespace-nowrap align-middle">
                    {s.name}
                    {s.isNightOnly && <span className="ml-1 px-1 py-0 rounded text-[9px] font-bold bg-purple-100 text-purple-600">夜専</span>}
                  </td>
                  {monthDays.map(({ d, date, dow }) => {
                    const a = findAssignment(s.id, date);
                    const st = a ? shiftTypeMap[a.shiftTypeId] : undefined;
                    const isEmpty = !a;
                    const bgCls = dow === 0 ? 'bg-red-50/40' : dow === 6 ? 'bg-blue-50/40' : '';
                    const cellBg = st ? st.bgColor : isEmpty ? undefined : '#fecaca';
                    const cellColor = st ? st.color : isEmpty ? '#e2e8f0' : '#dc2626';
                    const cellText = isEmpty ? '' : (st?.shortName ?? '休');
                    const isDutyEligible = a && st?.isDayShift && !st.isAke;
                    const dutyLabel = a?.duty ? DUTY_LABELS[a.duty] : null;
                    const dutyColor = a?.duty ? DUTY_COLORS[a.duty] : null;
                    const locked = a?.isManual === true && !isEmpty;

                    return (
                      <td key={d} className={`px-0.5 py-0.5 text-center border border-slate-200 ${bgCls} align-top`}>
                        <button
                          onClick={e => {
                            if (isPreview) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setActiveCell({ staffId: s.id, date, x: rect.left, y: rect.bottom + 2 });
                          }}
                          className={`relative ${D.cellW} ${D.padY} rounded-lg block mx-auto ${isEmpty ? 'border border-dashed border-slate-200' : ''}`}
                          style={{ background: cellBg, color: cellColor }}
                          title={isEmpty ? '未設定（クリックで入力）' : (st?.name ?? '休み')}
                        >
                          <span className={`${D.badgeText} font-bold`}>{cellText}</span>
                          {isDutyEligible && dutyLabel && (
                            <div className={`mt-0.5 rounded ${D.dutyText} font-semibold px-1`} style={{ background: dutyColor?.bg, color: dutyColor?.color }}>{dutyLabel}</div>
                          )}
                          {!isEmpty && (
                            <span
                              onClick={e => void handleToggleLock(e, s.id, date)}
                              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                              style={{ background: locked ? '#2563eb' : 'transparent' }}
                              title={locked ? '固定中（クリックで解除）' : 'クリックで固定'}
                            >
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={locked ? '#fff' : '#cbd5e1'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="11" width="14" height="10" rx="2" />
                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                              </svg>
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold">{stats.work}</td>
                  <td className="px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold">{stats.night}</td>
                  <td className="px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold">{stats.off}</td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr><td colSpan={daysInMonth + 4} className="px-3 py-8 text-center text-slate-400">スタッフが登録されていません</td></tr>
            )}
            <tr className="bg-slate-50 font-bold">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 border border-slate-200 border-r-2 border-r-slate-300 text-xs">必要人数</td>
              {monthDays.map(({ d, date, dow }) => {
                const dayAs = assignments.filter(a => a.date === date);
                const items = shiftTypes.filter(st => {
                  if (st.isAke) return false;
                  const reqArr = config.shiftRequirements[st.id];
                  return reqArr && (reqArr[dow] ?? 0) > 0;
                }).map(st => {
                  const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef').length;
                  const req = config.shiftRequirements[st.id]?.[dow] ?? 0;
                  return { id: st.id, shortName: st.shortName, color: filled >= req ? st.color : '#dc2626', filled, req };
                });
                return (
                  <td key={d} className="px-0.5 py-1 text-center border border-slate-200 leading-snug">
                    {items.map((item, idx) => (
                      <span key={item.id}>{idx > 0 && <br />}<span style={{ color: item.color, fontSize: 10 }}>{item.shortName}{item.filled}/{item.req}</span></span>
                    ))}
                  </td>
                );
              })}
              <td colSpan={3} className="border border-slate-200" />
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {activeCell && (
        <div ref={popoverRef} className="fixed z-[200] bg-white border border-slate-200 rounded-xl shadow-2xl p-2.5" style={{ top: activeCell.y, left: activeCell.x }}>
          <div className="flex flex-wrap gap-1 mb-2" style={{ maxWidth: 240 }}>
            <button onClick={() => void handlePickShift(activeCell.staffId, activeCell.date, null)} className="w-8 h-7 text-[11px] font-bold border border-dashed border-slate-300 rounded text-slate-400 hover:border-red-400 hover:text-red-500" title="空（クリア）">空</button>
            <button onClick={() => void handlePickShift(activeCell.staffId, activeCell.date, 'off')} className="w-8 h-7 text-[11px] font-bold rounded bg-slate-100 text-slate-600 hover:bg-slate-200" title="休み">休</button>
            {editableShiftTypes.map(st => (
              <button key={st.id} onClick={() => void handlePickShift(activeCell.staffId, activeCell.date, st.id)} className="w-8 h-7 text-[11px] font-bold rounded hover:opacity-75" style={{ background: st.bgColor, color: st.color }} title={st.name}>{st.shortName}</button>
            ))}
          </div>
          {(() => {
            const a = findAssignment(activeCell.staffId, activeCell.date);
            const st = a ? shiftTypeMap[a.shiftTypeId] : undefined;
            if (!a || !st?.isDayShift || st.isAke) return null;
            const person = staff.find(x => x.id === activeCell.staffId);
            const available = person?.availableDuties ?? [];
            return (
              <div className="border-t border-slate-100 pt-2 flex flex-wrap gap-1" style={{ maxWidth: 240 }}>
                <button onClick={() => void handleSetDuty(activeCell.staffId, activeCell.date, null)} className="px-2 h-7 text-[10px] font-bold border border-dashed border-slate-300 rounded text-slate-400">業務なし</button>
                {ALL_DUTIES.filter(d => available.includes(d)).map(d => (
                  <button key={d} onClick={() => void handleSetDuty(activeCell.staffId, activeCell.date, d)} className="px-2 h-7 text-[10px] font-bold rounded" style={{ background: DUTY_COLORS[d].bg, color: DUTY_COLORS[d].color }}>{DUTY_LABELS[d]}</button>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div className="mt-4 flex gap-3 flex-wrap text-xs items-center">
        <span className="text-slate-400 text-[11px]">凡例:</span>
        <span className="text-slate-400 font-bold">休</span>
        {editableShiftTypes.map(st => (
          <span key={st.id} className="inline-block px-1.5 py-0 rounded text-xs font-bold" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
        ))}
        {shiftTypes.filter(st => st.isAke).map(st => (
          <div key={st.id} className="flex items-center gap-1">
            <span className="inline-block px-1.5 py-0 rounded text-xs font-bold" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
            <span className="text-slate-500">{st.name}（夜勤の翌日に自動）</span>
          </div>
        ))}
        <span className="text-slate-300 mx-2">|</span>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
          <span className="text-slate-500">セル右上の鍵アイコンで固定</span>
        </div>
      </div>
    </div>
  );
}
