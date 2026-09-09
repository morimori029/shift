/**
 * =========================================================
 * schedulerSA.ts — 焼きなまし法（SA）によるシフト最適化エンジン
 * =========================================================
 *
 * グリーディスケジューラーの結果を初期解とし、SA で改善する。
 * 既存エンジンとは独立 — 使わなければ影響ゼロ。
 */

import type { Staff, ShiftType, FloorConfig, PairSetting, ShiftAssignment, Floor } from '../types';
import { generateShift, assignDuties } from './scheduler';

// ---- 共通型 ----

export interface SAContext {
  year: number;
  month: number;
  floor: Floor;
  staff: Staff[];
  shiftTypes: ShiftType[];
  config: FloorConfig;
  pairs: PairSetting[];
  holidays?: string[];
  prevMonthAssignments?: ShiftAssignment[];
  prefilled?: ShiftAssignment[];
  seed?: number;
  iterations?: number; // デフォルト 20000
}

/** スコアの内訳（比較表示用） */
export interface ShiftScore {
  total: number;
  unfilledDays: number;          // 必要人数の不足日数
  consecutiveViolations: number; // 連勤上限違反回数
  nightStdDev: number;           // 夜勤回数の標準偏差
  consecOffRate: number;         // 連休取得率 (%)
  dailySurplusStdDev: number;    // 日別出勤人数ばらつき
  offTargetRate: number;         // 公休目標達成率 (%)
  ngPairViolations: number;      // NGペア違反回数
  dutyDeficit: number;           // 業務割り当て不足（人数×日数の合計）
  dutySurplus: number;           // 業務割り当て超過（人数×日数の合計）
}

// ---- ヘルパー ----

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getDow(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}

function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- スコア関数（グリーディ結果にも使える） ----

export function evaluateShift(
  assignments: ShiftAssignment[],
  ctx: {
    year: number; month: number;
    staff: Staff[]; shiftTypes: ShiftType[];
    config: FloorConfig; pairs: PairSetting[];
    holidays?: string[];
  },
): ShiftScore {
  const { year, month, staff, shiftTypes, config, pairs, holidays } = ctx;
  const daysInMonth = new Date(year, month, 0).getDate();
  const holidaySet = new Set(holidays ?? []);
  const nightType = shiftTypes.find(st => st.isNightShift);
  const dayShiftTypes = shiftTypes.filter(st => st.isDayShift);
  const excludedIds = new Set(staff.filter(s => s.excludeFromCount).map(s => s.id));

  const getEffectiveDow = (date: string, dow: number): number => {
    if (!holidaySet.has(date)) return dow;
    return config.useHolidayRequirements ? -1 : dow;
  };
  const getEffectiveReq = (shiftId: string, edow: number): number => {
    if (config.shiftRequirementsEnabled?.[shiftId] === false) return 0;
    if (edow === -1) {
      const hReq = config.holidayShiftRequirements?.[shiftId];
      if (hReq !== undefined) return hReq;
      const arr = config.shiftRequirements[shiftId];
      return arr ? arr[0] ?? 0 : 0;
    }
    const arr = config.shiftRequirements[shiftId];
    return arr ? arr[edow] ?? 0 : 0;
  };

  // 高速参照用マップ
  const aMap = new Map<string, ShiftAssignment>();
  for (const a of assignments) aMap.set(`${a.staffId}:${a.date}`, a);

  // 1. 必要人数の不足日数 & 余剰リスト
  let unfilledDays = 0;
  const surplusList: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = dateStr(year, month, d);
    const dow = getDow(year, month, d);
    const edow = getEffectiveDow(date, dow);
    let dayUnfilled = false;
    let totalFilled = 0, totalReq = 0;
    for (const st of dayShiftTypes) {
      let filled = 0;
      for (const s of staff) {
        const a = aMap.get(`${s.id}:${date}`);
        if (a && a.shiftTypeId === st.id && !excludedIds.has(s.id)) filled++;
      }
      const req = getEffectiveReq(st.id, edow);
      if (filled < req) dayUnfilled = true;
      totalFilled += filled;
      totalReq += req;
    }
    if (nightType) {
      let filled = 0;
      for (const s of staff) {
        const a = aMap.get(`${s.id}:${date}`);
        if (a && a.shiftTypeId === nightType.id && !excludedIds.has(s.id)) filled++;
      }
      const req = getEffectiveReq(nightType.id, edow);
      if (filled < req) dayUnfilled = true;
      totalFilled += filled;
      totalReq += req;
    }
    if (dayUnfilled) unfilledDays++;
    surplusList.push(totalFilled - totalReq);
  }

  // 2. 連勤違反
  let consecutiveViolations = 0;
  for (const s of staff) {
    let consec = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const a = aMap.get(`${s.id}:${dateStr(year, month, d)}`);
      if (a && a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid') {
        consec++;
        if (consec > config.maxConsecutiveDays) consecutiveViolations++;
      } else {
        consec = 0;
      }
    }
  }

  // 3. 夜勤回数の標準偏差（非専従のみ）
  const nightStaffCounts: number[] = [];
  if (nightType) {
    for (const s of staff) {
      if (s.isNightOnly || !s.availableShiftTypes.includes(nightType.id)) continue;
      let cnt = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const a = aMap.get(`${s.id}:${dateStr(year, month, d)}`);
        if (a && a.shiftTypeId === nightType.id) cnt++;
      }
      nightStaffCounts.push(cnt);
    }
  }
  const nightMean = nightStaffCounts.length > 0 ? nightStaffCounts.reduce((a, b) => a + b, 0) / nightStaffCounts.length : 0;
  const nightStdDev = nightStaffCounts.length > 0
    ? Math.sqrt(nightStaffCounts.reduce((sum, c) => sum + (c - nightMean) ** 2, 0) / nightStaffCounts.length)
    : 0;

  // 4. 連休取得率
  let consecOffStaff = 0;
  const nonNightOnly = staff.filter(s => !s.isNightOnly);
  for (const s of nonNightOnly) {
    let streak = 0;
    let has = false;
    for (let d = 1; d <= daysInMonth; d++) {
      const a = aMap.get(`${s.id}:${dateStr(year, month, d)}`);
      if (a && (a.shiftTypeId === 'off' || a.shiftTypeId === 'paid')) {
        streak++;
        if (streak >= 2) has = true;
      } else {
        streak = 0;
      }
    }
    if (has) consecOffStaff++;
  }
  const consecOffRate = nonNightOnly.length > 0 ? consecOffStaff / nonNightOnly.length : 1;

  // 5. 日ごとの出勤人数ばらつき
  const surplusMean = surplusList.reduce((a, b) => a + b, 0) / surplusList.length;
  const dailySurplusStdDev = Math.sqrt(surplusList.reduce((sum, s) => sum + (s - surplusMean) ** 2, 0) / surplusList.length);

  // 6. 公休目標達成率
  let offTargetMet = 0;
  for (const s of staff) {
    const targetOff = s.monthlyWorkDays
      ? Math.max(config.monthlyOffDays, daysInMonth - s.monthlyWorkDays)
      : config.monthlyOffDays;
    let actualOff = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const a = aMap.get(`${s.id}:${dateStr(year, month, d)}`);
      if (a && a.shiftTypeId === 'off') actualOff++;
    }
    if (actualOff >= targetOff) offTargetMet++;
  }
  const offTargetRate = staff.length > 0 ? offTargetMet / staff.length : 1;

  // 7. NGペア違反
  let ngPairViolations = 0;
  const ngPairs = pairs.filter(p => p.type === 'ng' && (!p.scope || p.scope === 'night' || p.scope === 'all'));
  if (nightType) {
    for (let d = 1; d <= daysInMonth; d++) {
      const date = dateStr(year, month, d);
      const nightIds: string[] = [];
      for (const s of staff) {
        const a = aMap.get(`${s.id}:${date}`);
        if (a && a.shiftTypeId === nightType.id) nightIds.push(s.id);
      }
      for (const p of ngPairs) {
        if (nightIds.includes(p.staffId1) && nightIds.includes(p.staffId2)) ngPairViolations++;
      }
    }
  }

  // 8. 業務割り当て不足・超過（設定要件との差分を集計）
  const DUTY_TYPES = ['ld', 'bathing', 'floor', 'toilet'] as const;
  const dutyReqs = (config.dutyRequirements ?? {}) as Record<string, number[]>;
  const holidayDutyReqs = (config.holidayDutyRequirements ?? {}) as Record<string, number>;
  let dutyDeficit = 0;
  let dutySurplus = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = dateStr(year, month, d);
    const dow = getDow(year, month, d);
    const isHoliday = holidaySet.has(date);
    const dayAs = assignments.filter(a => a.date === date);
    for (const duty of DUTY_TYPES) {
      const req = isHoliday && config.useHolidayRequirements && holidayDutyReqs[duty] !== undefined
        ? holidayDutyReqs[duty]
        : (dutyReqs[duty]?.[dow] ?? 0);
      if (req === 0) continue;
      const filled = dayAs.filter(a => a.duty === duty).length;
      if (filled < req) dutyDeficit += req - filled;
      else if (filled > req) dutySurplus += filled - req;
    }
  }

  const total =
    - unfilledDays * 1000
    - consecutiveViolations * 500
    - ngPairViolations * 800
    - dutyDeficit * 300
    - dutySurplus * 150
    - nightStdDev * 50
    - dailySurplusStdDev * 30
    + consecOffRate * 100
    + offTargetRate * 200;

  return {
    total: Math.round(total * 10) / 10,
    unfilledDays,
    consecutiveViolations,
    nightStdDev: Math.round(nightStdDev * 100) / 100,
    consecOffRate: Math.round(consecOffRate * 100),
    dailySurplusStdDev: Math.round(dailySurplusStdDev * 100) / 100,
    offTargetRate: Math.round(offTargetRate * 100),
    ngPairViolations,
    dutyDeficit,
    dutySurplus,
  };
}

// ---- SA エンジン ----

export function generateShiftSA(ctx: SAContext): ShiftAssignment[] {
  const { year, month, staff, shiftTypes, config, pairs, holidays, prevMonthAssignments, prefilled, seed } = ctx;
  const iterations = ctx.iterations ?? 20000;
  const daysInMonth = new Date(year, month, 0).getDate();
  const rng = createRng(seed ?? 42);

  const akeType = shiftTypes.find(st => st.isAke);
  const nightType = shiftTypes.find(st => st.isNightShift);
  const holidaySet = new Set(holidays ?? []);

  // 手動入力セット
  const manualSet = new Set<string>();
  if (prefilled) {
    for (const a of prefilled) {
      if (a.isManual) manualSet.add(`${a.staffId}:${a.date}`);
    }
  }

  // 1. グリーディで初期解を生成
  const initial = generateShift({
    year, month, floor: ctx.floor, staff, shiftTypes, config, pairs,
    holidays, prevMonthAssignments, prefilled, seed,
  });

  // Map化
  const assignMap = new Map<string, ShiftAssignment>();
  for (const a of initial) assignMap.set(`${a.staffId}:${a.date}`, a);

  const evalCtx = { year, month, staff, shiftTypes, config, pairs, holidays };
  const toArray = () => Array.from(assignMap.values());

  let currentScore = evaluateShift(toArray(), evalCtx).total;
  let bestScore = currentScore;
  const bestMap = new Map(assignMap);

  // スワップ可能スタッフ
  const swappable = staff.filter(s => !s.excludeFromCount && !s.isNightOnly);
  if (swappable.length === 0) return initial;

  const T0 = 100;
  const Tf = 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = T0 * Math.pow(Tf / T0, iter / iterations);

    const s = swappable[Math.floor(rng() * swappable.length)];
    const d1 = Math.floor(rng() * daysInMonth) + 1;
    const d2 = Math.floor(rng() * daysInMonth) + 1;
    if (d1 === d2) continue;

    const date1 = dateStr(year, month, d1);
    const date2 = dateStr(year, month, d2);
    const key1 = `${s.id}:${date1}`;
    const key2 = `${s.id}:${date2}`;

    if (manualSet.has(key1) || manualSet.has(key2)) continue;

    const a1 = assignMap.get(key1);
    const a2 = assignMap.get(key2);
    if (!a1 || !a2) continue;

    // 夜勤・明けはスワップしない
    if (nightType && (a1.shiftTypeId === nightType.id || a2.shiftTypeId === nightType.id)) continue;
    if (akeType && (a1.shiftTypeId === akeType.id || a2.shiftTypeId === akeType.id)) continue;
    if (a1.shiftTypeId === a2.shiftTypeId) continue;

    // 出勤不可曜日チェック
    const dow1 = getDow(year, month, d1);
    const dow2 = getDow(year, month, d2);
    const isWork = (id: string) => id !== 'off' && id !== 'paid';
    if (isWork(a2.shiftTypeId) && s.unavailableDow.includes(dow1)) continue;
    if (isWork(a1.shiftTypeId) && s.unavailableDow.includes(dow2)) continue;
    if (s.unavailableOnHoliday) {
      if (isWork(a2.shiftTypeId) && holidaySet.has(date1)) continue;
      if (isWork(a1.shiftTypeId) && holidaySet.has(date2)) continue;
    }

    // 担当可能シフトチェック
    if (isWork(a2.shiftTypeId) && !s.availableShiftTypes.includes(a2.shiftTypeId)) continue;
    if (isWork(a1.shiftTypeId) && !s.availableShiftTypes.includes(a1.shiftTypeId)) continue;

    // 明け後に日勤NGチェック
    const adjacentOk = (day: number, shiftId: string): boolean => {
      if (!isWork(shiftId)) return true;
      if (day > 1) {
        const prev = assignMap.get(`${s.id}:${dateStr(year, month, day - 1)}`);
        if (prev && akeType && prev.shiftTypeId === akeType.id) return false;
      }
      return true;
    };
    if (!adjacentOk(d1, a2.shiftTypeId) || !adjacentOk(d2, a1.shiftTypeId)) continue;

    // スワップ実行（dutyはシフト位置が変わるので一旦クリア）
    const newA1 = { ...a1, shiftTypeId: a2.shiftTypeId, duty: undefined };
    const newA2 = { ...a2, shiftTypeId: a1.shiftTypeId, duty: undefined };
    assignMap.set(key1, newA1);
    assignMap.set(key2, newA2);

    const newScore = evaluateShift(toArray(), evalCtx).total;
    const delta = newScore - currentScore;

    if (delta > 0 || rng() < Math.exp(delta / temp)) {
      currentScore = newScore;
      if (newScore > bestScore) {
        bestScore = newScore;
        for (const [k, v] of assignMap) bestMap.set(k, v);
      }
    } else {
      assignMap.set(key1, a1);
      assignMap.set(key2, a2);
    }
  }

  // SA最適化後に業務を再割り当て（スワップでdutyが失われているため）
  const daysInMonth2 = new Date(year, month, 0).getDate();
  const finalAssignments = Array.from(bestMap.values());
  assignDuties(finalAssignments, staff, shiftTypes, config, year, month, daysInMonth2, holidaySet);
  return finalAssignments;
}
