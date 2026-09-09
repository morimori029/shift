/**
 * 自動生成後の警告メッセージ生成。移行元: src/pages/ShiftTablePage.tsx の buildGenerationWarnings。
 */
import type { Staff, ShiftType, FloorConfig, ShiftAssignment } from '@/types';

export function buildGenerationWarnings(
  result: ShiftAssignment[],
  floorStaff: Staff[],
  shiftTypes: ShiftType[],
  config: FloorConfig,
  holidays: string[],
  year: number,
  month: number,
  daysInMonth: number,
): string[] {
  const warns: string[] = [];
  const holidaySet = new Set(holidays);
  const excludedSet = new Set(floorStaff.filter(s => s.excludeFromCount).map(s => s.id));
  const nightType = shiftTypes.find(st => st.isNightShift);
  const akeType = shiftTypes.find(st => st.isAke);
  const dow = (d: number) => new Date(year, month - 1, d).getDay();

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

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayA = result.filter(a => a.date === dateStr);
    const eDow = getEffectiveDow(dateStr, dow(d));

    if (nightType) {
      const nightCount = dayA.filter(a => a.shiftTypeId === nightType.id).length;
      const nightReq = getEffectiveReq(nightType.id, eDow);
      if (nightReq > 0 && nightCount < nightReq) {
        warns.push(`夜勤入りスタッフが${nightCount}人（必要${nightReq}人） — ${month}/${d}`);
      }
    }

    for (const [stId] of Object.entries(config.shiftRequirements)) {
      const req = getEffectiveReq(stId, eDow);
      if (req <= 0) continue;
      const filled = dayA.filter(a => a.shiftTypeId === stId && a.duty !== 'onef' && !excludedSet.has(a.staffId)).length;
      if (filled < req) {
        const stName = shiftTypes.find(st => st.id === stId)?.name ?? stId;
        const shortage = req - filled;
        const reasons: string[] = [];
        const capable = floorStaff.filter(s => s.availableShiftTypes.includes(stId));
        if (capable.length < req) reasons.push(`対応可能スタッフが${capable.length}人のみ`);
        const dayOff = dayA.filter(a => a.shiftTypeId === 'off' || a.shiftTypeId === 'paid').length;
        const dayAke = dayA.filter(a => a.shiftTypeId === akeType?.id).length;
        if (dayOff + dayAke > floorStaff.length * 0.5) reasons.push('休み/明けのスタッフが多い');
        const reasonStr = reasons.length > 0 ? `（${reasons.join('・')}）` : '';
        warns.push(`${month}/${d} ${stName}: ${shortage}人不足（配置${filled}/${req}人）${reasonStr}`);
      }
    }
  }

  if (warns.length > 0) {
    const totalReq = Object.entries(config.shiftRequirements).reduce((sum, [stId, arr]) => {
      const dayReqs = (arr as number[]).reduce((s, v) => s + v, 0);
      return config.shiftRequirementsEnabled?.[stId] !== false ? sum + dayReqs : sum;
    }, 0);
    const avgDailyReq = totalReq / 7;
    if (floorStaff.length < avgDailyReq * 1.5) {
      warns.unshift(`スタッフ数(${floorStaff.length}人)が1日の平均必要人数(${avgDailyReq.toFixed(0)}人)に対して少なめです`);
    }
  }

  return warns;
}
