import type { ShiftTableData } from '@/server/actions/schedule';
import { DUTY_LABELS } from '@/types';
import { DENSITY_STYLE, DUTY_COLORS, dateStr, type Density } from './constants';

interface Props {
  floorLabel: string;
  data: ShiftTableData;
  year: number;
  month: number;
  density: Density;
}

/**
 * 比較モード用の読み取り専用フロア表。
 * 通常のシフト表と同じ密度スタイル・セル統合デザインを流用するが、
 * クリック編集・ロックは持たない（編集は通常のフロア別ビューで行う）。
 */
export default function FloorMiniTable({ floorLabel, data, year, month, density }: Props) {
  const { staff, shiftTypes, config, holidays, assignments, daysInMonth } = data;
  const D = DENSITY_STYLE[density];
  const shiftTypeMap = Object.fromEntries(shiftTypes.map(st => [st.id, st]));
  const holidaySet = new Set(holidays);

  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const date = dateStr(year, month, d);
    const dow = new Date(year, month - 1, d).getDay();
    return { d, date, dow, isHoliday: holidaySet.has(date) };
  });

  const findAssignment = (staffId: string, date: string) => assignments.find(a => a.staffId === staffId && a.date === date);

  return (
    <div className="overflow-auto max-h-[50vh] border border-slate-100 rounded-lg">
      <table className="border-collapse text-sm min-w-full">
        <thead>
          <tr>
            <th className={`sticky left-0 top-0 z-30 bg-slate-100 px-3 py-2 text-left ${D.nameW} border border-slate-200 text-xs font-bold shadow-md`}>{floorLabel}</th>
            {monthDays.map(({ d, dow, isHoliday }) => {
              const cls = (dow === 0 || isHoliday) ? 'text-red-600 bg-red-50' : dow === 6 ? 'text-blue-600 bg-blue-50' : 'bg-slate-50';
              return <th key={d} className={`sticky top-0 z-20 ${D.cellW} px-0.5 py-1.5 text-center border border-slate-200 text-xs font-bold ${cls}`}>{d}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map(s => (
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

                return (
                  <td key={d} className={`px-0.5 py-0.5 text-center border border-slate-200 ${bgCls} align-top`}>
                    <div className={`${D.cellW} ${D.padY} rounded-lg mx-auto ${isEmpty ? 'border border-dashed border-slate-200' : ''}`} style={{ background: cellBg, color: cellColor }}>
                      <span className={`${D.badgeText} font-bold`}>{cellText}</span>
                      {isDutyEligible && dutyLabel && (
                        <div className={`mt-0.5 rounded ${D.dutyText} font-semibold px-1`} style={{ background: dutyColor?.bg, color: dutyColor?.color }}>{dutyLabel}</div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {staff.length === 0 && (
            <tr><td colSpan={daysInMonth + 1} className="px-3 py-6 text-center text-slate-400 text-xs">スタッフが登録されていません</td></tr>
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
          </tr>
        </tbody>
      </table>
    </div>
  );
}
