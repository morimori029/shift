/**
 * =========================================================
 * SettingsPage.tsx — フロアごとの設定画面
 * =========================================================
 *
 * 管理者が「月ごとの公休数」「連続勤務の最大日数」や、
 * 「この曜日は早番が何人必要か」「入浴担当は何人必要か」など、
 * 施設を回すための必要な人数（条件）を設定する画面です。
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { FloorConfig, DutyType } from '../types';
import { ALL_DUTIES, DUTY_LABELS } from '../types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 祝日設定セクション
 * ① 祝日日付の登録・削除（全フロア共通）
 * ② 祝日の必要人数設定（フロアごと・ON/OFFトグル付き）
 */
function HolidaySection({ shiftTypes }: { shiftTypes: { id: string; shortName: string; name: string; bgColor: string; color: string }[] }) {
  const { state, dispatch } = useApp();
  const [inputDate, setInputDate] = useState('');
  const config = state.floorConfigs.find(c => c.floor === state.currentFloor)!;
  const useHoliday = config.useHolidayRequirements ?? false;

  const addHoliday = () => {
    if (!inputDate) return;
    if (state.holidays.includes(inputDate)) { setInputDate(''); return; }
    dispatch({ type: 'SET_HOLIDAYS', holidays: [...state.holidays, inputDate].sort() });
    setInputDate('');
  };

  const removeHoliday = (d: string) => {
    dispatch({ type: 'SET_HOLIDAYS', holidays: state.holidays.filter(h => h !== d) });
  };

  const fmt = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}(${'日月火水木金土'[dt.getDay()]})`;
  };

  const updateFloorConfig = (patch: Partial<import('../types').FloorConfig>) => {
    dispatch({
      type: 'SET_FLOOR_CONFIGS',
      floorConfigs: state.floorConfigs.map(c => c.floor === state.currentFloor ? { ...c, ...patch } : c),
    });
  };

  const setHolidayReq = (shiftId: string, val: number) => {
    updateFloorConfig({
      holidayShiftRequirements: {
        ...(config.holidayShiftRequirements ?? {}),
        [shiftId]: Math.max(0, Math.min(20, val)),
      },
    });
  };

  const getHolidayReq = (shiftId: string): number => {
    // 設定がなければ日曜（dow=0）の値をデフォルト表示
    const custom = config.holidayShiftRequirements?.[shiftId];
    if (custom !== undefined) return custom;
    return config.shiftRequirements[shiftId]?.[0] ?? 0;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold">🎌 祝日設定</h3>
      </div>

      {/* ① 祝日日付の登録 — 全フロア共通 */}
      <div>
        <p className="text-[11px] text-slate-500 font-semibold mb-1.5">祝日一覧 <span className="font-normal text-slate-400">（全フロア共通）</span></p>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="date" value={inputDate}
            onChange={e => setInputDate(e.target.value)}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:border-blue-400 outline-none"
          />
          <button
            onClick={addHoliday} disabled={!inputDate}
            className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-red-600 transition-colors font-semibold"
          >
            + 追加
          </button>
        </div>
        {state.holidays.length === 0 ? (
          <p className="text-[11px] text-slate-400">祝日が登録されていません。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {state.holidays.map(d => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-full font-medium">
                {fmt(d)}
                <button onClick={() => removeHoliday(d)} className="text-red-400 hover:text-red-600 leading-none">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ② 祝日必要人数設定 — フロアごと（非常勤は表示しない） */}
      {state.currentFloor !== '非常勤' && (
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-[11px] text-slate-500 font-semibold">
              祝日の必要人数 <span className="font-normal text-slate-400">（{state.currentFloor}）</span>
            </p>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox" checked={useHoliday}
                onChange={() => updateFloorConfig({ useHolidayRequirements: !useHoliday })}
                className="w-4 h-4 accent-red-500"
              />
              <span className="text-xs font-semibold text-slate-600">祝日専用設定を使う</span>
            </label>
          </div>
          {!useHoliday ? (
            <p className="text-[11px] text-slate-400">
              OFF: 祝日は日曜日の必要人数で自動生成されます。ONにすると祝日専用の人数を設定できます。
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-400 mb-2">
                祝日に適用する必要人数を設定してください（「有効」チェックがOFFのシフトは無視されます）。
              </p>
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="px-2 py-1.5 text-left font-semibold w-24">種別</th>
                    <th className="px-2 py-1.5 text-center font-semibold w-20 text-red-500">祝日 人数</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftTypes.map(st => (
                    <tr key={st.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="shift-tag" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                          <span className="text-slate-600">{st.name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number" min="0" max="20"
                          className="w-16 px-1 py-1 border border-red-200 bg-red-50/30 rounded text-center text-xs focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition"
                          value={getHolidayReq(st.id)}
                          onChange={e => setHolidayReq(st.id, Number(e.target.value))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DowHeader() {
  return (
    <>
      <th className="px-1 py-1.5 text-center font-semibold w-12 text-slate-400">一括</th>
      {DOW_LABELS.map((d, i) => (
        <th key={i} className={`px-1 py-1.5 text-center font-semibold w-10 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}>{d}</th>
      ))}
    </>
  );
}

export default function SettingsPage() {
  const { state, dispatch } = useApp();
  const config = state.floorConfigs.find(c => c.floor === state.currentFloor)!;
  const EXCLUDED_FROM_REQUIREMENTS = new Set(['half_am', 'half_pm', 'short', 'paid', 'training']);
  const shiftTypes = state.shiftTypes.filter(st => !st.isAke && !EXCLUDED_FROM_REQUIREMENTS.has(st.id));

  const updateConfig = (patch: Partial<FloorConfig>) => {
    dispatch({
      type: 'SET_FLOOR_CONFIGS',
      floorConfigs: state.floorConfigs.map(c => c.floor === state.currentFloor ? { ...c, ...patch } : c),
    });
  };

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const getReq = (shiftId: string, dow: number): number => {
    const arr = config.shiftRequirements[shiftId];
    if (!arr) return 0;
    return arr[dow] ?? 0;
  };

  const updateReq = (shiftId: string, dow: number, val: number) => {
    const arr = [...(config.shiftRequirements[shiftId] ?? [0, 0, 0, 0, 0, 0, 0])];
    arr[dow] = clamp(val, 0, 20);
    updateConfig({ shiftRequirements: { ...config.shiftRequirements, [shiftId]: arr } });
  };

  const setAllDow = (shiftId: string, val: number) => {
    const v = clamp(val, 0, 20);
    updateConfig({ shiftRequirements: { ...config.shiftRequirements, [shiftId]: [v, v, v, v, v, v, v] } });
  };

  const getDutyReq = (duty: DutyType, dow: number): number => {
    const arr = config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>];
    if (!arr) return 0;
    return arr[dow] ?? 0;
  };

  const updateDutyReq = (duty: DutyType, dow: number, val: number) => {
    const arr = [...(config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>] ?? [0, 0, 0, 0, 0, 0, 0])];
    arr[dow] = clamp(val, 0, 20);
    updateConfig({ dutyRequirements: { ...config.dutyRequirements, [duty]: arr } });
  };

  const setAllDutyDow = (duty: DutyType, val: number) => {
    const v = clamp(val, 0, 20);
    updateConfig({ dutyRequirements: { ...config.dutyRequirements, [duty]: [v, v, v, v, v, v, v] } });
  };

  const dowInputCls = (dow: number) =>
    `w-full px-1 py-1 border border-slate-200 rounded text-center text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition ${dow === 0 ? 'bg-red-50/40' : dow === 6 ? 'bg-blue-50/40' : ''}`;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* シフト必要人数 — 非常勤は非表示 */}
      {state.currentFloor !== '非常勤' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold">シフト必要人数</h3>
            <span className="px-2 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-bold">{state.currentFloor}</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">各シフト種別の曜日別最低必要人数。「一括」に入力すると全曜日に反映。</p>
          <table className="text-xs w-full">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="px-2 py-1.5 text-left font-semibold w-24">種別</th>
                <DowHeader />
              </tr>
            </thead>
            <tbody>
              {shiftTypes.filter(st => !st.isAke).map(st => (
                <tr key={st.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="shift-tag" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                      <span className="text-slate-600">{st.name}</span>
                    </span>
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="number" min="0" max="20"
                      className="w-full px-1 py-1 border border-dashed border-slate-300 rounded text-center text-xs bg-slate-50 focus:border-blue-400 outline-none"
                      placeholder="-"
                      onChange={e => { if (e.target.value) setAllDow(st.id, Number(e.target.value)); }}
                    />
                  </td>
                  {DOW_LABELS.map((_, dow) => (
                    <td key={dow} className="px-1 py-0.5">
                      <input
                        type="number" min="0" max="20"
                        className={dowInputCls(dow)}
                        value={getReq(st.id, dow)}
                        onChange={e => updateReq(st.id, dow, Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 業務必要人数 — 非常勤は非表示 */}
      {state.currentFloor !== '非常勤' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold">業務必要人数</h3>
            <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] rounded-full font-bold">{state.currentFloor}</span>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">日勤帯の各業務に必要な人数を曜日ごとに設定。右端は対応可能なスタッフ数。</p>
          <table className="text-xs w-full">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="px-2 py-1.5 text-left font-semibold w-24">業務</th>
                <DowHeader />
                <th className="px-2 py-1.5 text-center font-semibold w-14">対応可</th>
              </tr>
            </thead>
            <tbody>
              {ALL_DUTIES.map(duty => {
                const capableCount = state.staffList.filter(s => s.floor === state.currentFloor && (s.availableDuties ?? []).includes(duty)).length;
                return (
                  <tr key={duty} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-2 py-1.5">
                      <span className="font-bold text-slate-700">{DUTY_LABELS[duty]}</span>
                    </td>
                    <td className="px-1 py-0.5">
                      <input
                        type="number" min="0" max="20"
                        className="w-full px-1 py-1 border border-dashed border-slate-300 rounded text-center text-xs bg-slate-50 focus:border-blue-400 outline-none"
                        placeholder="-"
                        onChange={e => { if (e.target.value) setAllDutyDow(duty, Number(e.target.value)); }}
                      />
                    </td>
                    {DOW_LABELS.map((_, dow) => (
                      <td key={dow} className="px-1 py-0.5">
                        <input
                          type="number" min="0" max="20"
                          className={dowInputCls(dow)}
                          value={getDutyReq(duty, dow)}
                          onChange={e => updateDutyReq(duty, dow, Number(e.target.value))}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${capableCount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{capableCount}名</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 祝日設定 — 全フロア共通 */}
      <HolidaySection shiftTypes={shiftTypes} />

      {/* 共通ルール */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-bold mb-3">共通ルール</h3>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">連勤上限</span>
            <input
              type="number" min="1" max="14"
              className="w-14 px-2 py-1 border border-slate-200 rounded text-sm text-center focus:border-blue-400 outline-none"
              value={config.maxConsecutiveDays}
              onChange={e => updateConfig({ maxConsecutiveDays: clamp(Number(e.target.value), 1, 14) })}
            />
            <span className="text-xs text-slate-500">日</span>
          </div>
          {/* 月の公休日数 — 非常勤は公休管理なし */}
          {state.currentFloor !== '非常勤' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">月の公休日数</span>
              <input
                type="number" min="0" max="20"
                className="w-14 px-2 py-1 border border-slate-200 rounded text-sm text-center focus:border-blue-400 outline-none"
                value={config.monthlyOffDays}
                onChange={e => updateConfig({ monthlyOffDays: clamp(Number(e.target.value), 0, 20) })}
              />
              <span className="text-xs text-slate-500">日</span>
            </div>
          )}
          <div className="px-3 py-1.5 bg-slate-50 rounded-lg text-[11px] text-slate-500">
            <span className="font-bold text-slate-600">夜勤→明け→夜勤or休み</span>（明けの翌日に日勤帯は入れない）
          </div>
        </div>
      </div>

      {/* 古いデータの削除 */}
      <div className="bg-white rounded-xl shadow-sm p-5 border border-red-100">
        <h3 className="text-sm font-bold mb-1 text-red-600">🗑️ 古いシフトデータの削除</h3>
        <p className="text-xs text-slate-500 mb-3">
          現在より <strong>24ヶ月以前</strong>（2年以上前）のシフト割当とコメントを削除します。<br />
          スタッフ・設定・ペア設定は削除されません。<br />
          <span className="text-red-500 font-semibold">実行前に必ずデータ保存（JSONエクスポート）でバックアップを取ってください。</span>
        </p>
        <button
          onClick={() => {
            const now = new Date();
            // 24ヶ月前の年月を計算
            const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 24, 1);
            const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
            const beforeCount = state.assignments.filter(a => a.date.slice(0, 7) < cutoff).length;
            if (beforeCount === 0) {
              alert('削除対象のデータはありません（24ヶ月以内のデータのみ保存されています）。');
              return;
            }
            if (!confirm(
              `【確認】${cutoff} より前のシフトデータ ${beforeCount} 件を削除します。\n` +
              `この操作は元に戻せません。\n\n` +
              `バックアップは取りましたか？`
            )) return;
            dispatch({ type: 'PURGE_OLD_DATA', cutoffYearMonth: cutoff });
            alert(`削除完了しました。${beforeCount} 件のシフトデータを削除しました。`);
          }}
          className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors"
        >
          24ヶ月以前のデータを削除する
        </button>
      </div>
    </div>
  );
}

