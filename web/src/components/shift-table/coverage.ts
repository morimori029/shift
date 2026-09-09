import type { ShiftTableData } from '@/server/actions/schedule';

export interface DayCoverage {
  d: number;
  date: string;
  dow: number;
  isHoliday: boolean;
  shortage: number; // 不足人数の合計（0なら充足）
}

/** 日ごとの「必要人数に対する不足数」を集計する（比較モードのサマリー表示用） */
export function computeDayCoverage(data: ShiftTableData, year: number, month: number): DayCoverage[] {
  const { config, shiftTypes, assignments, holidays, daysInMonth } = data;
  const holidaySet = new Set(holidays);
  const excludedIds = new Set(data.staff.filter(s => s.excludeFromCount).map(s => s.id));

  const getEffectiveDow = (dateStr: string, rawDow: number): number => {
    if (!holidaySet.has(dateStr)) return rawDow;
    return config.useHolidayRequirements ? -1 : 0;
  };
  const getEffectiveReq = (shiftId: string, effectiveDow: number): number => {
    if (config.shiftRequirementsEnabled?.[shiftId] === false) return 0;
    if (effectiveDow === -1) {
      const holidayReq = config.holidayShiftRequirements?.[shiftId];
      if (holidayReq !== undefined) return holidayReq;
      return config.shiftRequirements[shiftId]?.[0] ?? 0;
    }
    return config.shiftRequirements[shiftId]?.[effectiveDow] ?? 0;
  };

  const result: DayCoverage[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(year, month - 1, d).getDay();
    const isHoliday = holidaySet.has(date);
    const eDow = getEffectiveDow(date, dow);
    const dayA = assignments.filter(a => a.date === date);

    let shortage = 0;
    for (const st of shiftTypes) {
      if (st.isAke) continue;
      const req = getEffectiveReq(st.id, eDow);
      if (req <= 0) continue;
      const filled = dayA.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef' && !excludedIds.has(a.staffId)).length;
      if (filled < req) shortage += req - filled;
    }
    result.push({ d, date, dow, isHoliday, shortage });
  }
  return result;
}
