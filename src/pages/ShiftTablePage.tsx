/**
 * =========================================================
 * ShiftTablePage.tsx — メインの「シフト表」画面
 * =========================================================
 *
 * カレンダー形式でシフトを表示し、自動作成の実行や手動入力を行うメイン画面です。
 * - scheduler.ts を呼び出してシフトを自動で埋める
 * - セルをクリックして手入力でシフトを変更する
 * - 結果を Excel や PDF でダウンロードする
 * メインの機能がここに詰まっています。
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';
import { generateShift } from '../lib/scheduler';
import { exportShiftToExcel } from '../lib/excelExport';
import { exportShiftToPdf } from '../lib/pdfExport';
import { ALL_DUTIES, DUTY_LABELS } from '../types';
import type { DutyType } from '../types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export default function ShiftTablePage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [activeCell, setActiveCell] = useState<{ staffId: string; date: string; x: number; y: number } | null>(null);
  // 生成後の警告ログ（#6/#11）
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { currentYear: year, currentMonth: month, currentFloor: floor } = state;

  // ポップオーバーの外クリックで閉じる
  useEffect(() => {
    if (!activeCell) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActiveCell(null);
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [activeCell]);

  // #8: キーボードショートカット —— ←キーで前月、→キーで翌月に移動
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 入力フィールドやダイアログにフォーカス中は無視
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (activeCell) return; // ポップオーバー表示中は無視
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const newMonth = month === 1 ? 12 : month - 1;
        const newYear = month === 1 ? year - 1 : year;
        dispatch({ type: 'SET_MONTH', year: newYear, month: newMonth });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const newMonth = month === 12 ? 1 : month + 1;
        const newYear = month === 12 ? year + 1 : year;
        dispatch({ type: 'SET_MONTH', year: newYear, month: newMonth });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [month, year, activeCell, dispatch]);

  const floorStaff = state.staffList.filter(s => s.floor === floor);
  const config = state.floorConfigs.find(c => c.floor === floor)!;
  const daysInMonth = new Date(year, month, 0).getDate();
  const shiftTypeMap = Object.fromEntries(state.shiftTypes.map(st => [st.id, st]));
  const editableShiftTypes = state.shiftTypes.filter(st => !st.isAke);
  const holidaySet = new Set(state.holidays);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const floorAssignments = useMemo(() => state.assignments.filter(a => {
    const s = state.staffList.find(x => x.id === a.staffId);
    return s?.floor === floor && a.date.startsWith(monthKey);
  }), [state.assignments, state.staffList, floor, monthKey]);

  const nightType = state.shiftTypes.find(st => st.isNightShift);
  const akeType = state.shiftTypes.find(st => st.isAke);

  // 前月末の夜勤→当月1日の明け引き継ぎを検出
  const prevMonthCarryover = useMemo(() => {
    if (!nightType || !akeType) return [];
    const py = month === 1 ? year - 1 : year;
    const pm = month === 1 ? 12 : month - 1;
    const lastDay = new Date(py, pm, 0).getDate();
    const prevLastDate = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const day1 = `${year}-${String(month).padStart(2, '0')}-01`;

    return floorStaff.filter(s => {
      const prevA = state.assignments.find(a => a.staffId === s.id && a.date === prevLastDate);
      if (!prevA || prevA.shiftTypeId !== nightType.id) return false;
      const day1A = floorAssignments.find(a => a.staffId === s.id && a.date === day1);
      return !day1A; // 当月1日にまだシフトが入っていない
    });
  }, [floorStaff, state.assignments, floorAssignments, nightType, akeType, year, month]);

  const getNextDate = (d: string, withinMonth = true): string | null => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + 1);
    const ny = dt.getFullYear();
    const nm = dt.getMonth() + 1;
    if (withinMonth && (ny !== year || nm !== month)) return null;
    return `${ny}-${String(nm).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  // シフトを直接設定（newShiftId=null でクリア）
  const assignShift = (staffId: string, date: string, newShiftId: string | null) => {
    const current = floorAssignments.find(a => a.staffId === staffId && a.date === date);
    let updated = [...state.assignments];

    // 現在が夜勤の場合、翻日の明けを削除
    if (current?.shiftTypeId === nightType?.id && akeType) {
      const nextDate = getNextDate(date);
      if (nextDate) {
        const nextA = updated.find(a => a.staffId === staffId && a.date === nextDate);
        if (nextA && nextA.shiftTypeId === akeType.id) {
          updated = updated.filter(a => !(a.staffId === staffId && a.date === nextDate));
        }
      }
    }

    if (newShiftId === null) {
      // クリア（セルを空に）
      updated = updated.filter(a => !(a.staffId === staffId && a.date === date));
    } else {
      const warnings = checkManualEditWarnings(staffId, date, newShiftId);
      if (warnings.length > 0) toast.show(warnings[0], 'info');
      if (current) {
        updated = updated.map(a =>
          a.staffId === staffId && a.date === date
            ? { ...a, shiftTypeId: newShiftId, isLeader: false, isManual: true }
            : a
        );
      } else {
        updated.push({ staffId, date, shiftTypeId: newShiftId, isLeader: false, isManual: true });
      }

      // #2: 夜勤を選択した場合、翻日に明けを自動設定
      // さらに「明けの翻日にまた夜勤」が入っていた場合はそのまた翻日にも明けを自動設定（連鎖）
      const insertAke = (targetDate: string) => {
        if (!akeType) return;
        const existing = updated.find(a => a.staffId === staffId && a.date === targetDate);
        if (existing) {
          updated = updated.map(a =>
            a.staffId === staffId && a.date === targetDate
              ? { ...a, shiftTypeId: akeType.id, isLeader: false, isManual: true }
              : a
          );
        } else {
          updated.push({ staffId, date: targetDate, shiftTypeId: akeType.id, isLeader: false, isManual: true });
        }
      };

      if (newShiftId === nightType?.id && akeType) {
        const nextDate = getNextDate(date);
        if (nextDate) {
          insertAke(nextDate);
          // 明けの翻日にまた夜勤が入っていた場合（失っていた明け）の復元はしない
          // （手動入力が優先・連鎖は1段階だけ）
          toast.show('翻日に明けを自動設定しました', 'info');
        }
      }
    }

    dispatch({ type: 'SET_ASSIGNMENTS', assignments: updated });
  };

  // #6/#11: 自動生成後の警告アイテムを生成する
  const buildGenerationWarnings = (result: typeof floorAssignments, daysInM: number): string[] => {
    const warns: string[] = [];
    const holidaySet = new Set(state.holidays);
    const dow = (d: number) => new Date(year, month - 1, d).getDay();
    // スケジューラーと同じ祝日ロジック
    const getEffectiveDow = (dateStr: string, rawDow: number): number => {
      if (!holidaySet.has(dateStr)) return rawDow;
      return config.useHolidayRequirements ? -1 : 0;
    };
    const getEffectiveReq = (shiftId: string, effectiveDow: number): number => {
      if (config.shiftRequirementsEnabled?.[shiftId] === false) return 0;
      if (effectiveDow === -1) {
        const holidayReq = config.holidayShiftRequirements?.[shiftId];
        if (holidayReq !== undefined) return holidayReq;
        const arr = config.shiftRequirements[shiftId];
        return arr ? arr[0] ?? 0 : 0;
      }
      const arr = config.shiftRequirements[shiftId];
      return arr ? arr[effectiveDow] ?? 0 : 0;
    };

    for (let d = 1; d <= daysInM; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayA = result.filter(a => a.date === dateStr);
      const eDow = getEffectiveDow(dateStr, dow(d));

      // #11: 夜勤最低2人チェック
      if (nightType) {
        const nightCount = dayA.filter(a => a.shiftTypeId === nightType.id).length;
        const nightReq = getEffectiveReq(nightType.id, eDow);
        if (nightReq > 0 && nightCount < nightReq) {
          warns.push(`☔ ${month}/​${d}(日) 夜勤入りスタッフが${nightCount}人（必要${nightReq}人）`);
        }
      }

      // #6: 各シフトの人数不足チェック + 原因診断
      for (const [stId] of Object.entries(config.shiftRequirements)) {
        const req = getEffectiveReq(stId, eDow);
        if (req <= 0) continue;
        const filled = dayA.filter(a => a.shiftTypeId === stId && a.duty !== 'onef').length;
        if (filled < req) {
          const stName = state.shiftTypes.find(st => st.id === stId)?.name ?? stId;
          const shortage = req - filled;
          // 原因診断: なぜ埋まらなかったか
          const reasons: string[] = [];
          const capable = floorStaff.filter(s => s.availableShiftTypes.includes(stId));
          if (capable.length < req) {
            reasons.push(`対応可能スタッフが${capable.length}人のみ`);
          }
          const dayOff = dayA.filter(a => a.shiftTypeId === 'off' || a.shiftTypeId === 'paid').length;
          const dayAke = dayA.filter(a => a.shiftTypeId === akeType?.id).length;
          if (dayOff + dayAke > floorStaff.length * 0.5) {
            reasons.push('休み/明けのスタッフが多い');
          }
          const reasonStr = reasons.length > 0 ? `（${reasons.join('・')}）` : '';
          warns.push(`⚠️ ${month}/${d} ${stName}: ${shortage}人不足（配置${filled}/${req}人）${reasonStr}`);
        }
      }
    }

    // サマリー: 総合診断
    if (warns.length > 0) {
      const totalReq = Object.entries(config.shiftRequirements).reduce((sum, [stId, arr]) => {
        const dayReqs = (arr as number[]).reduce((s, v) => s + v, 0);
        return config.shiftRequirementsEnabled?.[stId] !== false ? sum + dayReqs : sum;
      }, 0);
      const avgDailyReq = totalReq / 7;
      if (floorStaff.length < avgDailyReq * 1.5) {
        warns.unshift(`📊 スタッフ数(${floorStaff.length}人)が1日の平均必要人数(${avgDailyReq.toFixed(0)}人)に対して少なめです`);
      }
    }

    return warns;
  };

  const handleAutoFill = () => {
    if (floorStaff.length === 0) {
      toast.show('スタッフが登録されていません', 'error');
      return;
    }

    setGenerating(true);
    setTimeout(() => {
      const floorPairs = state.pairSettings.filter(p => {
        const s = state.staffList.find(x => x.id === p.staffId1);
        return s?.floor === floor;
      });

      const prevMonthAssignments = state.assignments.filter(a => {
        const s = state.staffList.find(x => x.id === a.staffId);
        if (!s || s.floor !== floor) return false;
        const py = month === 1 ? year - 1 : year;
        const pm = month === 1 ? 12 : month - 1;
        const pmKey = `${py}-${String(pm).padStart(2, '0')}`;
        return a.date.startsWith(pmKey);
      });

      const prefilled = floorAssignments;

      const result = generateShift({
        year, month, floor,
        staff: floorStaff,
        shiftTypes: state.shiftTypes,
        config,
        pairs: floorPairs,
        holidays: state.holidays,
        prevMonthAssignments,
        prefilled,
      });

      const otherAssignments = state.assignments.filter(a => {
        const s = state.staffList.find(x => x.id === a.staffId);
        return !(s?.floor === floor && a.date.startsWith(monthKey));
      });

      const merged = result.map(a => {
        const orig = floorAssignments.find(o => o.staffId === a.staffId && o.date === a.date && o.isManual);
        return orig ? { ...a, isManual: true } : a;
      });

      dispatch({ type: 'SET_ASSIGNMENTS', assignments: [...otherAssignments, ...merged] });

      // 警告ログを計算して表示
      const warns = buildGenerationWarnings(merged, new Date(year, month, 0).getDate());
      setGenerationWarnings(warns);

      setGenerating(false);
      if (warns.length > 0) {
        toast.show(`自動生成完了（注意${warns.length}件）`, 'error');
      } else {
        toast.show('空欄を自動で埋めました');
      }
    }, 50);
  };

  const handleRegenerate = () => {
    if (floorStaff.length === 0) {
      toast.show('スタッフが登録されていません', 'error');
      return;
    }
    if (!confirm('自動生成分をクリアして作り直します。手入力したシフトは残ります。')) return;

    setGenerating(true);
    setTimeout(() => {
      const otherAssignments = state.assignments.filter(a => {
        const s = state.staffList.find(x => x.id === a.staffId);
        return !(s?.floor === floor && a.date.startsWith(monthKey));
      });
      const manualAssignments = floorAssignments.filter(a => a.isManual);

      const floorPairs = state.pairSettings.filter(p => {
        const s = state.staffList.find(x => x.id === p.staffId1);
        return s?.floor === floor;
      });
      const prevMonthAssignments = state.assignments.filter(a => {
        const s = state.staffList.find(x => x.id === a.staffId);
        if (!s || s.floor !== floor) return false;
        const py = month === 1 ? year - 1 : year;
        const pm = month === 1 ? 12 : month - 1;
        const pmKey = `${py}-${String(pm).padStart(2, '0')}`;
        return a.date.startsWith(pmKey);
      });

      const result = generateShift({
        year, month, floor,
        staff: floorStaff,
        shiftTypes: state.shiftTypes,
        config,
        pairs: floorPairs,
        holidays: state.holidays,
        prevMonthAssignments,
        prefilled: manualAssignments,
      });

      const merged = result.map(a => {
        const manual = manualAssignments.find(m => m.staffId === a.staffId && m.date === a.date);
        return manual ? { ...a, isManual: true } : a;
      });

      dispatch({ type: 'SET_ASSIGNMENTS', assignments: [...otherAssignments, ...merged] });

      // 作り直し後も警告ログを計算して表示
      const warns = buildGenerationWarnings(merged, new Date(year, month, 0).getDate());
      setGenerationWarnings(warns);

      setGenerating(false);
      if (warns.length > 0) {
        toast.show(`作り直し完了（注意${warns.length}件）`, 'error');
      } else {
        toast.show('手入力を残してシフトを作り直しました');
      }
    }, 50);
  };

  const handleClear = () => {
    if (!confirm('このフロアの今月のシフトで、手入力以外をすべてクリアしますか？\n（🖊 手入力のシフトは残ります）')) return;
    const cleared = state.assignments.filter(a => {
      const s = state.staffList.find(x => x.id === a.staffId);
      const isThisFloorMonth = s?.floor === floor && a.date.startsWith(monthKey);
      // このフロア・今月のシフトはisManual=trueのみ残す
      if (isThisFloorMonth) return a.isManual === true;
      return true;
    });
    dispatch({ type: 'SET_ASSIGNMENTS', assignments: cleared });
    toast.show('手入力以外のシフトをクリアしました');
  };

  const checkManualEditWarnings = (staffId: string, _date: string, newShiftId: string): string[] => {
    const warns: string[] = [];
    const s = floorStaff.find(x => x.id === staffId);
    if (!s) return warns;
    const st = shiftTypeMap[newShiftId];
    if (newShiftId !== 'off' && st && !st.isAke && !s.availableShiftTypes.includes(newShiftId)) {
      warns.push(`${s.name} は ${st.name} に対応していません`);
    }
    return warns;
  };

  const PART_STYLE = { bg: '#fef3c7', color: '#d97706', shortName: 'H' };
  const PART_HOURS = (9 * 60 + 0);   // 9:00
  const PART_HOURS_END = (15 * 60);   // 15:00
  const PART_BREAK = 30;              // 休憩30分
  const PART_WORK_H = (PART_HOURS_END - PART_HOURS - PART_BREAK) / 60; // 5.5h

  const isPartStaff = (staffId: string) => {
    const s = state.staffList.find(x => x.id === staffId);
    return s?.role === 'パート' && !s?.isShortTime;
  };

  const isShortTimeStaff = (staffId: string) => {
    return state.staffList.find(x => x.id === staffId)?.isShortTime === true;
  };

  const SHORT_STYLE = (() => {
    const st = shiftTypeMap['short'];
    return st ? { bg: st.bgColor, color: st.color, shortName: st.shortName } : { bg: '#ccfbf1', color: '#0d9488', shortName: 'I' };
  })();

  const calcShiftHours = (st: typeof state.shiftTypes[0] | undefined, staffId?: string): number => {
    if (!st || st.isAke) return 0;
    if (staffId && isPartStaff(staffId) && st.isDayShift) return PART_WORK_H;
    if (!st.startTime || !st.endTime) return 0;
    const [sh, sm] = st.startTime.split(':').map(Number);
    const [eh, em] = st.endTime.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    const breakMins = st.isNightShift ? 90 : 60;
    return (mins - breakMins) / 60;
  };

  const PARTIAL_SHIFT_IDS = new Set(['half_am', 'half_pm', 'short']);

  const getStaffStats = (staffId: string) => {
    const sa = floorAssignments.filter(a => a.staffId === staffId);
    const work = sa.filter(a =>
      a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid' && !PARTIAL_SHIFT_IDS.has(a.shiftTypeId)
    ).length;
    const night = sa.filter(a => shiftTypeMap[a.shiftTypeId]?.isNightShift).length;
    const off = sa.filter(a => a.shiftTypeId === 'off' || a.shiftTypeId === 'paid').length;
    const totalHours = sa.reduce((sum, a) => sum + calcShiftHours(shiftTypeMap[a.shiftTypeId], staffId), 0);
    return { work, night, off, totalHours };
  };

  const DUTY_COLORS: Record<string, { bg: string; color: string }> = {
    ld: { bg: '#fef3c7', color: '#92400e' },
    bathing: { bg: '#cffafe', color: '#155e75' },
    floor: { bg: '#d1fae5', color: '#065f46' },
    toilet: { bg: '#ede9fe', color: '#5b21b6' },
    onef: { bg: '#e2e8f0', color: '#334155' },
  };

  const setDuty = (staffId: string, date: string, dutyVal: string) => {
    const a = floorAssignments.find(x => x.staffId === staffId && x.date === date);
    if (!a) return;
    const newDuty = dutyVal === '' ? undefined : dutyVal as DutyType;
    const updated = state.assignments.map(x =>
      x.staffId === staffId && x.date === date ? { ...x, duty: newDuty } : x
    );
    dispatch({ type: 'SET_ASSIGNMENTS', assignments: updated });
  };

  const emptyCount = floorStaff.reduce((sum, s) => {
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!floorAssignments.find(a => a.staffId === s.id && a.date === date)) sum++;
    }
    return sum;
  }, 0);

  return (
    <div>
      <div className="flex gap-4 mb-5">
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm text-center">
          <div className="text-2xl font-extrabold text-blue-500">{floorStaff.length}</div>
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
      )};

      {/* 警告ログパネル (#6/#11) */}
      {generationWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
              <span>⚠️</span>
              <span>生成後の確認事項 {generationWarnings.length}件</span>
            </div>
            <button
              onClick={() => setGenerationWarnings([])}
              className="text-xs text-amber-500 hover:text-amber-700"
            >✕ 閉じる</button>
          </div>
          <ul className="space-y-1">
            {generationWarnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-800 flex items-start gap-1">
                <span className="shrink-0 mt-0.5">・</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* プルダウンポップオーバー */}
      {activeCell && (
        <div
          ref={popoverRef}
          className="fixed z-[200] bg-white border border-slate-200 rounded-xl shadow-2xl p-2.5"
          style={{ top: activeCell.y, left: activeCell.x }}
        >
          <div className="flex flex-wrap gap-1" style={{ maxWidth: 240 }}>
            {/* 空白(クリア) */}
            <button
              onClick={() => { assignShift(activeCell.staffId, activeCell.date, null); setActiveCell(null); }}
              className="w-8 h-7 text-[11px] font-bold border border-dashed border-slate-300 rounded text-slate-400 hover:border-red-400 hover:text-red-500 transition-colors"
              title="空（クリア）"
            >空</button>
            {/* 休み */}
            <button
              onClick={() => { assignShift(activeCell.staffId, activeCell.date, 'off'); setActiveCell(null); }}
              className="w-8 h-7 text-[11px] font-bold rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              title="休み"
            >休</button>
            {/* 各シフト種別（明け以外） */}
            {editableShiftTypes.map(st => (
              <button
                key={st.id}
                onClick={() => { assignShift(activeCell.staffId, activeCell.date, st.id); setActiveCell(null); }}
                className="w-8 h-7 text-[11px] font-bold rounded hover:opacity-75 transition-opacity"
                style={{ background: st.bgColor, color: st.color }}
                title={st.name}
              >{st.shortName}</button>
            ))}
          </div>
        </div>
      )}

      {prevMonthCarryover.length > 0 && (
        <div className="mb-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <p className="text-xs text-amber-700">
            前月末に夜勤だったスタッフ（{prevMonthCarryover.map(s => s.name).join('、')}）の1日目は自動生成時に「明け」になります
          </p>
          <button
            className="text-xs text-amber-600 hover:text-amber-800 font-semibold shrink-0 ml-3"
            onClick={() => {
              if (!akeType) return;
              const day1 = `${year}-${String(month).padStart(2, '0')}-01`;
              const newAssignments = [...state.assignments];
              prevMonthCarryover.forEach(s => {
                newAssignments.push({ staffId: s.id, date: day1, shiftTypeId: akeType.id, isLeader: false, isManual: true });
              });
              dispatch({ type: 'SET_ASSIGNMENTS', assignments: newAssignments });
              toast.show('前月夜勤スタッフの明けを設定しました');
            }}
          >
            今すぐ明けを設定
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4 justify-between">
        <p className="text-xs text-slate-400 self-center">
          セルをクリックしてシフトを選択（夜勤の翻日は明けを自動設定）
        </p>
        <div className="flex gap-2">
          <button onClick={handleClear} className="px-3 py-2 text-xs border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-500">
            クリア
          </button>
          <button onClick={handleRegenerate} disabled={generating} className="px-4 py-2 text-sm text-white rounded-lg font-semibold disabled:opacity-50 hover:-translate-y-0.5 transition-transform bg-amber-500 hover:bg-amber-600">
            作り直す
          </button>
          <button onClick={handleAutoFill} disabled={generating || emptyCount === 0} className="px-4 py-2 text-sm text-white rounded-lg font-semibold disabled:opacity-50 hover:-translate-y-0.5 transition-transform" style={{ background: 'linear-gradient(135deg, #6c8cff, #a78bfa)' }}>
            空欄を自動で埋める
          </button>
          <button
            onClick={() => exportShiftToExcel({ year, month, floor, staff: floorStaff, shiftTypes: state.shiftTypes, assignments: state.assignments, config, comments: state.staffComments })}
            className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-semibold"
          >
            Excel
          </button>
          <button
            onClick={() => exportShiftToPdf({ year, month, floor, staff: floorStaff, shiftTypes: state.shiftTypes, assignments: state.assignments, config, comments: state.staffComments })}
            className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-semibold"
          >
            PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 overflow-auto max-h-[72vh]">
        <table className="border-collapse text-sm min-w-full">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-slate-100 px-3 py-2 text-left min-w-[100px] border border-slate-200 text-xs font-bold shadow-md" rowSpan={2}>スタッフ</th>
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = i + 1;
                const dow = new Date(year, month - 1, d).getDay();
                const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const isHoliday = holidaySet.has(date);
                const cls = (dow === 0 || isHoliday) ? 'text-red-600 bg-red-50' : dow === 6 ? 'text-blue-600 bg-blue-50' : 'bg-slate-50';
                return <th key={d} className={`sticky top-0 z-20 px-1 py-1.5 text-center border border-slate-200 min-w-[42px] text-xs font-bold ${cls}`}>{d}{isHoliday ? '🎌' : ''}</th>;
              })}
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 min-w-[38px] text-xs font-bold">出勤</th>
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 min-w-[38px] text-xs font-bold">夜勤</th>
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 min-w-[38px] text-xs font-bold">公休</th>
              <th className="sticky top-0 z-20 bg-slate-100 px-2 py-1.5 border border-slate-200 min-w-[42px] text-xs font-bold">時間</th>
            </tr>
            <tr>
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = i + 1;
                const dow = new Date(year, month - 1, d).getDay();
                const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const isHoliday = holidaySet.has(date);
                const cls = (dow === 0 || isHoliday) ? 'text-red-600 bg-red-50' : dow === 6 ? 'text-blue-600 bg-blue-50' : 'bg-slate-50';
                return <th key={d} className={`sticky top-[30px] z-20 px-1 py-1 text-center border border-slate-200 text-[11px] ${cls}`}>{isHoliday ? '祝' : DOW_LABELS[dow]}</th>;
              })}
              <th className="sticky top-[30px] z-20 bg-slate-100 px-1 py-1 border border-slate-200 text-[11px]">日数</th>
              <th className="sticky top-[30px] z-20 bg-slate-100 px-1 py-1 border border-slate-200 text-[11px]">回数</th>
              <th className="sticky top-[30px] z-20 bg-slate-100 px-1 py-1 border border-slate-200 text-[11px]">日数</th>
              <th className="sticky top-[30px] z-20 bg-slate-100 px-1 py-1 border border-slate-200 text-[11px]">h</th>
            </tr>
          </thead>
          <tbody>
            {floorStaff.map(s => {
              const stats = getStaffStats(s.id);
              const offWarn = stats.off > config.monthlyOffDays;
              const workWarn = s.monthlyWorkDays ? stats.work > s.monthlyWorkDays : false;
              return (
                <React.Fragment key={s.id}>
                  <tr>
                    <td rowSpan={2} className="sticky left-0 z-10 bg-white px-3 py-1.5 text-xs font-bold border border-slate-200 border-r-2 border-r-slate-300 whitespace-nowrap align-middle">
                      {s.name}
                      {s.isNightOnly && <span className="ml-1 px-1 py-0 rounded text-[9px] font-bold bg-purple-100 text-purple-600">夜専</span>}
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const d = i + 1;
                      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
                      const stId = a?.shiftTypeId;
                      const st = stId ? shiftTypeMap[stId] : undefined;
                      const dow = new Date(year, month - 1, d).getDay();
                      const bgCls = dow === 0 ? 'bg-red-50/50' : dow === 6 ? 'bg-blue-50/50' : '';
                      const isEmpty = !a;

                      const isPart = isPartStaff(s.id);
                      const isShort = isShortTimeStaff(s.id);
                      const useShortStyle = isShort && st?.isDayShift;
                      const usePartStyle = isPart && st?.isDayShift;
                      const cellBg = useShortStyle ? SHORT_STYLE.bg : usePartStyle ? PART_STYLE.bg : st ? st.bgColor : isEmpty ? undefined : '#fecaca';
                      const cellColor = useShortStyle ? SHORT_STYLE.color : usePartStyle ? PART_STYLE.color : st ? st.color : isEmpty ? '#e2e8f0' : '#dc2626';
                      const cellText = isEmpty ? '' : useShortStyle ? SHORT_STYLE.shortName : usePartStyle ? PART_STYLE.shortName : (st?.shortName ?? '休');
                      const cellTitle = useShortStyle ? `短時間（9:00-16:00）` : usePartStyle ? `パート（9:00-15:00）` : st?.name ?? (isEmpty ? '未設定（クリックで入力）' : '休み');

                      return (
                        <td key={d} className={`px-0.5 py-0.5 text-center border border-slate-200 border-b-0 ${bgCls}`}>
                          <button
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setActiveCell({ staffId: s.id, date, x: rect.left, y: rect.bottom + 2 });
                            }}
                            className={`relative inline-block w-8 h-6 leading-6 rounded text-xs font-bold ${isEmpty ? 'border border-dashed border-slate-200' : ''}`}
                            style={{ background: cellBg, color: cellColor }}
                            title={cellTitle}
                          >
                            {cellText}
                            {a?.isManual && !isEmpty && (
                              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td rowSpan={2} className={`px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold align-middle ${workWarn ? 'text-red-600' : ''}`}>{stats.work}</td>
                    <td rowSpan={2} className={`px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold align-middle ${s.isNightOnly && ((s.nightShiftMin && stats.night < s.nightShiftMin) || (s.nightShiftMax && stats.night > s.nightShiftMax)) ? 'text-red-600' : ''}`}
                      title={s.isNightOnly ? `目標: ${s.nightShiftMin ?? '-'}〜${s.nightShiftMax ?? '-'}回` : undefined}
                    >{stats.night}</td>
                    <td rowSpan={2} className={`px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold align-middle ${offWarn ? 'text-red-600' : ''}`}>{stats.off}</td>
                    <td rowSpan={2} className="px-2 py-1.5 text-center border border-slate-200 bg-slate-50 text-xs font-bold align-middle">{stats.totalHours % 1 === 0 ? stats.totalHours : stats.totalHours.toFixed(1)}</td>
                  </tr>
                  <tr>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const d = i + 1;
                      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const dow = new Date(year, month - 1, d).getDay();
                      const bgCls = dow === 0 ? 'bg-red-50/30' : dow === 6 ? 'bg-blue-50/30' : '';
                      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
                      const isDutyEligible = a && (a.shiftTypeId === 'early' || a.shiftTypeId === 'day');
                      const dutyVal = a?.duty;
                      const dc = dutyVal ? DUTY_COLORS[dutyVal] : undefined;
                      return (
                        <td key={d} className={`px-0 py-0 border border-slate-200 border-t-0 ${bgCls}`}>
                          {isDutyEligible ? (() => {
                            const available = Array.from(new Set([...(s.availableDuties ?? []), 'onef' as DutyType]));
                            const dc = dutyVal ? DUTY_COLORS[dutyVal] : undefined;
                            return (
                              <select
                                value={dutyVal ?? ''}
                                onChange={e => setDuty(s.id, date, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                className="w-full h-5 text-[9px] font-bold border-0 rounded-none outline-none cursor-pointer appearance-none text-center"
                                style={dc ? { background: dc.bg, color: dc.color } : { background: 'transparent', color: '#94a3b8' }}
                                title="業務を選択"
                              >
                                <option value="">-</option>
                                {available.map(dv => (
                                  <option key={dv} value={dv}>{DUTY_LABELS[dv]}</option>
                                ))}
                              </select>
                            );
                          })() : (
                            <div className="w-full h-5" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
            <tr className="bg-slate-50 font-bold">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 border border-slate-200 border-r-2 border-r-slate-300 text-xs">必要人数</td>
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = i + 1;
                const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dow = new Date(year, month - 1, d).getDay();
                const dayAs = floorAssignments.filter(a => a.date === date);
                const items = state.shiftTypes.filter(st => {
                  if (st.isAke) return false;
                  const reqArr = config.shiftRequirements[st.id];
                  return reqArr && (reqArr[dow] ?? 0) > 0;
                }).map(st => {
                  const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef').length;
                  const reqArr = config.shiftRequirements[st.id];
                  const req = reqArr ? reqArr[dow] ?? 0 : 0;
                  const ok = filled >= req;
                  return { id: st.id, shortName: st.shortName, color: ok ? st.color : '#dc2626', filled, req };
                });
                return (
                  <td key={d} className="px-0.5 py-1 text-center border border-slate-200 leading-snug">
                    {items.map((item, idx) => (
                      <span key={item.id}>
                        {idx > 0 && <br />}
                        <span style={{ color: item.color, fontSize: 11 }}>{item.shortName}{item.filled}/{item.req}</span>
                      </span>
                    ))}
                  </td>
                );
              })}
              <td colSpan={4} className="border border-slate-200"></td>
            </tr>
            {ALL_DUTIES.some(d => {
              const arr = config.dutyRequirements?.[d as Exclude<DutyType, 'onef'>];
              return arr && arr.some((v: number) => v > 0);
            }) && (
                <tr className="bg-emerald-50/50 font-bold">
                  <td className="sticky left-0 z-10 bg-emerald-50 px-3 py-2 border border-slate-200 border-r-2 border-r-slate-300 text-xs text-emerald-700">業務人数</td>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const d = i + 1;
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const dow = new Date(year, month - 1, d).getDay();
                    const dayAs = floorAssignments.filter(a => a.date === date);
                    const items = ALL_DUTIES
                      .filter(duty => {
                        const arr = config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>];
                        return arr && (arr[dow] ?? 0) > 0;
                      })
                      .map(duty => {
                        const req = config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>]?.[dow] ?? 0;
                        const filled = dayAs.filter(a => a.duty === duty).length;
                        const ok = filled >= req;
                        return { duty, label: DUTY_LABELS[duty], color: ok ? '#059669' : '#dc2626', filled, req };
                      });
                    return (
                      <td key={d} className="px-0.5 py-1 text-center border border-slate-200 leading-snug">
                        {items.map((item, idx) => (
                          <span key={item.duty}>
                            {idx > 0 && <br />}
                            <span style={{ color: item.color, fontSize: 11 }}>{item.label}{item.filled}/{item.req}</span>
                          </span>
                        ))}
                      </td>
                    );
                  })}
                  <td colSpan={4} className="border border-slate-200"></td>
                </tr>
              )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-3 flex-wrap text-xs items-center">
        <span className="text-slate-400 text-[11px]">凡例:</span>
        <span className="text-slate-400 font-bold">休</span>
        {editableShiftTypes.map(st => (
          <span key={st.id} className="shift-tag" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
        ))}
        {state.shiftTypes.filter(st => st.isAke).map(st => (
          <div key={st.id} className="flex items-center gap-1">
            <span className="shift-tag" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
            <span className="text-slate-500">{st.name}（夜勤の翌日に自動）</span>
          </div>
        ))}
        <span className="text-slate-300 mx-2">|</span>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
          <span className="text-slate-500">手入力</span>
        </div>
      </div>
    </div>
  );
}
