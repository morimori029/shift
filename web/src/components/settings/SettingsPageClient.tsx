'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { updateFloorConfig } from '@/server/actions/floorConfig';
import { addHoliday, removeHoliday, generateHolidaysForYear } from '@/server/actions/holidays';
import { countOldAssignments, purgeOldData } from '@/server/actions/dataManagement';
import type { FloorConfig, ShiftType, Staff, DutyType, Floor } from '@/types';
import { ALL_DUTIES, DUTY_LABELS } from '@/types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const EXCLUDED_FROM_REQUIREMENTS = new Set(['half_am', 'half_pm', 'short', 'paid', 'training']);

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

interface Props {
  floor: Floor;
  initialConfig: FloorConfig;
  initialHolidays: string[];
  shiftTypes: ShiftType[];
  staff: Staff[];
}

export default function SettingsPageClient({ floor, initialConfig, initialHolidays, shiftTypes: allShiftTypes, staff }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [config, setConfig] = useState<FloorConfig>(initialConfig);
  const [holidays, setHolidays] = useState<string[]>(initialHolidays);
  const [inputDate, setInputDate] = useState('');
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [generatingHolidays, setGeneratingHolidays] = useState(false);

  const shiftTypes = allShiftTypes.filter(st => !st.isAke && !EXCLUDED_FROM_REQUIREMENTS.has(st.id));
  const useHoliday = config.useHolidayRequirements ?? false;

  const persist = (patch: Partial<FloorConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    void updateFloorConfig(floor, patch);
  };

  const dowInputCls = (dow: number) =>
    `w-full px-1 py-1 border border-slate-200 rounded text-center text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none transition ${dow === 0 ? 'bg-red-50/40' : dow === 6 ? 'bg-blue-50/40' : ''}`;

  const getReq = (shiftId: string, dow: number): number => config.shiftRequirements[shiftId]?.[dow] ?? 0;
  const updateReq = (shiftId: string, dow: number, val: number) => {
    const arr = [...(config.shiftRequirements[shiftId] ?? [0, 0, 0, 0, 0, 0, 0])];
    arr[dow] = clamp(val, 0, 20);
    persist({ shiftRequirements: { ...config.shiftRequirements, [shiftId]: arr } });
  };
  const setAllDow = (shiftId: string, val: number) => {
    const v = clamp(val, 0, 20);
    persist({ shiftRequirements: { ...config.shiftRequirements, [shiftId]: [v, v, v, v, v, v, v] } });
  };

  const getDutyReq = (duty: DutyType, dow: number): number => config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>]?.[dow] ?? 0;
  const updateDutyReq = (duty: DutyType, dow: number, val: number) => {
    const arr = [...(config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>] ?? [0, 0, 0, 0, 0, 0, 0])];
    arr[dow] = clamp(val, 0, 20);
    persist({ dutyRequirements: { ...config.dutyRequirements, [duty]: arr } as FloorConfig['dutyRequirements'] });
  };
  const setAllDutyDow = (duty: DutyType, val: number) => {
    const v = clamp(val, 0, 20);
    persist({ dutyRequirements: { ...config.dutyRequirements, [duty]: [v, v, v, v, v, v, v] } as FloorConfig['dutyRequirements'] });
  };

  const getHolidayReq = (shiftId: string): number => {
    const custom = config.holidayShiftRequirements?.[shiftId];
    if (custom !== undefined) return custom;
    return config.shiftRequirements[shiftId]?.[0] ?? 0;
  };
  const setHolidayReq = (shiftId: string, val: number) => {
    persist({ holidayShiftRequirements: { ...(config.holidayShiftRequirements ?? {}), [shiftId]: clamp(val, 0, 20) } });
  };

  const getHolidayDutyReq = (duty: string): number => {
    const custom = config.holidayDutyRequirements?.[duty];
    if (custom !== undefined) return custom;
    return config.dutyRequirements?.[duty as Exclude<DutyType, 'onef'>]?.[0] ?? 0;
  };
  const setHolidayDutyReq = (duty: string, val: number) => {
    persist({ holidayDutyRequirements: { ...(config.holidayDutyRequirements ?? {}), [duty]: clamp(val, 0, 20) } });
  };

  const fmtHoliday = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}(${'日月火水木金土'[dt.getDay()]})`;
  };

  const handleAddHoliday = async () => {
    if (!inputDate) return;
    if (holidays.includes(inputDate)) { setInputDate(''); return; }
    const next = [...holidays, inputDate].sort();
    setHolidays(next);
    setInputDate('');
    await addHoliday(inputDate);
  };

  const handleRemoveHoliday = async (d: string) => {
    setHolidays(holidays.filter(h => h !== d));
    await removeHoliday(d);
  };

  const handleGenerateHolidays = async () => {
    setGeneratingHolidays(true);
    try {
      const res = await generateHolidaysForYear(genYear);
      if (res.added.length === 0) {
        toast.show(`${genYear}年の祝日はすでに全て登録済みです`, 'info');
      } else {
        setHolidays([...holidays, ...res.added.map(h => h.date)].sort());
        toast.show(`${genYear}年の祝日を${res.added.length}件追加しました（${res.added.map(h => h.name).join('・')}）`);
      }
    } finally {
      setGeneratingHolidays(false);
    }
  };

  const handlePurge = async () => {
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 24, 1);
    const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
    const beforeCount = await countOldAssignments(cutoff);
    if (beforeCount === 0) {
      alert('削除対象のデータはありません（24ヶ月以内のデータのみ保存されています）。');
      return;
    }
    if (!confirm(`【確認】${cutoff} より前のシフトデータ ${beforeCount} 件を削除します。\nこの操作は元に戻せません。\n\nバックアップは取りましたか？`)) return;
    const res = await purgeOldData(cutoff);
    toast.show(`削除完了しました。${res.deletedAssignments} 件のシフトデータを削除しました。`);
    router.refresh();
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {floor !== '非常勤' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold">シフト必要人数</h3>
            <span className="px-2 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-bold">{floor}</span>
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
              {shiftTypes.map(st => (
                <tr key={st.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block px-1.5 py-0 rounded text-xs font-bold" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                      <span className="text-slate-600">{st.name}</span>
                    </span>
                  </td>
                  <td className="px-1 py-0.5">
                    <input
                      type="number" min="0" max="20" placeholder="-"
                      className="w-full px-1 py-1 border border-dashed border-slate-300 rounded text-center text-xs bg-slate-50 focus:border-blue-400 outline-none"
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

      {floor !== '非常勤' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold">業務必要人数</h3>
            <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] rounded-full font-bold">{floor}</span>
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
                const capableCount = staff.filter(s => s.availableDuties.includes(duty)).length;
                return (
                  <tr key={duty} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-2 py-1.5"><span className="font-bold text-slate-700">{DUTY_LABELS[duty]}</span></td>
                    <td className="px-1 py-0.5">
                      <input
                        type="number" min="0" max="20" placeholder="-"
                        className="w-full px-1 py-1 border border-dashed border-slate-300 rounded text-center text-xs bg-slate-50 focus:border-blue-400 outline-none"
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

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-bold">🎌 祝日設定</h3>

        <div>
          <p className="text-[11px] text-slate-500 font-semibold mb-1.5">祝日一覧 <span className="font-normal text-slate-400">（全フロア共通）</span></p>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date" value={inputDate}
              onChange={e => setInputDate(e.target.value)}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:border-blue-400 outline-none"
            />
            <button onClick={() => void handleAddHoliday()} disabled={!inputDate} className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-red-600 transition-colors font-semibold">+ 追加</button>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <input
              type="number" value={genYear}
              onChange={e => setGenYear(Number(e.target.value))}
              className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center focus:border-blue-400 outline-none"
            />
            <span className="text-xs text-slate-500">年の</span>
            <button
              onClick={() => void handleGenerateHolidays()}
              disabled={generatingHolidays}
              className="px-3 py-1.5 bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-indigo-600 transition-colors font-semibold"
            >
              {generatingHolidays ? '生成中...' : '祝日を自動生成'}
            </button>
          </div>
          {holidays.length === 0 ? (
            <p className="text-[11px] text-slate-400">祝日が登録されていません。</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {holidays.map(d => (
                <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-full font-medium">
                  {fmtHoliday(d)}
                  <button onClick={() => void handleRemoveHoliday(d)} className="text-red-400 hover:text-red-600 leading-none">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {floor !== '非常勤' && (
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-[11px] text-slate-500 font-semibold">祝日の必要人数 <span className="font-normal text-slate-400">（{floor}）</span></p>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={useHoliday} onChange={() => persist({ useHolidayRequirements: !useHoliday })} className="w-4 h-4 accent-red-500" />
                <span className="text-xs font-semibold text-slate-600">祝日専用設定を使う</span>
              </label>
            </div>
            {!useHoliday ? (
              <p className="text-[11px] text-slate-400">OFF: 祝日は日曜日の必要人数で自動生成されます。ONにすると祝日専用の人数を設定できます。</p>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 mb-2">祝日に適用する必要人数を設定してください（「有効」チェックがOFFのシフトは無視されます）。</p>
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
                            <span className="inline-block px-1.5 py-0 rounded text-xs font-bold" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
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
                <p className="text-[11px] text-slate-500 font-semibold mt-3 mb-2">祝日の業務必要人数</p>
                <table className="text-xs w-full">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="px-2 py-1.5 text-left font-semibold w-24">業務</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-20 text-red-500">祝日 人数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_DUTIES.map(duty => (
                      <tr key={duty} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-2 py-1.5"><span className="font-bold text-slate-700">{DUTY_LABELS[duty]}</span></td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" min="0" max="20"
                            className="w-16 px-1 py-1 border border-red-200 bg-red-50/30 rounded text-center text-xs focus:border-red-400 focus:ring-1 focus:ring-red-200 outline-none transition"
                            value={getHolidayDutyReq(duty)}
                            onChange={e => setHolidayDutyReq(duty, Number(e.target.value))}
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

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-bold mb-3">共通ルール</h3>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">連勤上限</span>
            <input
              type="number" min="1" max="14"
              className="w-14 px-2 py-1 border border-slate-200 rounded text-sm text-center focus:border-blue-400 outline-none"
              value={config.maxConsecutiveDays}
              onChange={e => persist({ maxConsecutiveDays: clamp(Number(e.target.value), 1, 14) })}
            />
            <span className="text-xs text-slate-500">日</span>
          </div>
          {floor !== '非常勤' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">月の公休日数</span>
              <input
                type="number" min="0" max="20"
                className="w-14 px-2 py-1 border border-slate-200 rounded text-sm text-center focus:border-blue-400 outline-none"
                value={config.monthlyOffDays}
                onChange={e => persist({ monthlyOffDays: clamp(Number(e.target.value), 0, 20) })}
              />
              <span className="text-xs text-slate-500">日</span>
            </div>
          )}
          <div className="px-3 py-1.5 bg-slate-50 rounded-lg text-[11px] text-slate-500">
            <span className="font-bold text-slate-600">夜勤→明け→夜勤or休み</span>（明けの翌日に日勤帯は入れない）
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 border border-red-100">
        <h3 className="text-sm font-bold mb-1 text-red-600">🗑️ 古いシフトデータの削除</h3>
        <p className="text-xs text-slate-500 mb-3">
          現在より <strong>24ヶ月以前</strong>（2年以上前）のシフト割当とコメントを削除します。<br />
          スタッフ・設定・ペア設定は削除されません。<br />
          <span className="text-red-500 font-semibold">実行前に必ずデータ取込（JSON）でバックアップを取ってください。</span>
        </p>
        <button onClick={() => void handlePurge()} className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors">
          24ヶ月以前のデータを削除する
        </button>
      </div>
    </div>
  );
}
