'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { generateShift } from '@/domain/scheduler';
import { generateShiftSA, evaluateShift, type ShiftScore } from '@/domain/schedulerSA';
import { toAssignmentScalarData } from '@/server/mappers/assignment';
import { buildGenerationWarnings } from '@/server/warnings';
import { loadContext, monthKeyOf, prevMonthOf } from '@/server/scheduleContext';
import { generateShiftCpSat } from './cpsat';
import { listComments } from './comments';
import type { Floor, ShiftAssignment, Staff, ShiftType, FloorConfig, StaffDayComment } from '@/types';

export interface ShiftTableData {
  staff: Staff[];
  shiftTypes: ShiftType[];
  config: FloorConfig;
  holidays: string[];
  assignments: ShiftAssignment[];
  comments: StaffDayComment[];
  daysInMonth: number;
  prevMonthCarryoverStaffIds: string[];
}

/** /shift ページの表示に必要なデータを一式ロードする */
export async function getShiftTableData(floor: Floor, year: number, month: number): Promise<ShiftTableData> {
  const ctx = await loadContext(floor, year, month);
  const nightType = ctx.shiftTypes.find(st => st.isNightShift);

  // 前月末に夜勤で、今月1日にまだ何も入っていないスタッフ（明け引き継ぎバナー用）
  const pm = prevMonthOf(year, month);
  const prevLastDay = new Date(pm.year, pm.month, 0).getDate();
  const prevLastDate = `${pm.year}-${String(pm.month).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;
  const day1 = `${year}-${String(month).padStart(2, '0')}-01`;
  const prevMonthCarryoverStaffIds = nightType
    ? ctx.staff
        .filter(s => {
          const prevA = ctx.prevMonthAssignments.find(a => a.staffId === s.id && a.date === prevLastDate);
          if (!prevA || prevA.shiftTypeId !== nightType.id) return false;
          const day1A = ctx.monthAssignments.find(a => a.staffId === s.id && a.date === day1);
          return !day1A;
        })
        .map(s => s.id)
    : [];

  const comments = await listComments(floor, year, month);

  return {
    staff: ctx.staff,
    shiftTypes: ctx.shiftTypes,
    config: ctx.config,
    holidays: ctx.holidays,
    assignments: ctx.monthAssignments,
    comments,
    daysInMonth: ctx.daysInMonth,
    prevMonthCarryoverStaffIds,
  };
}

export interface SchedulePattern {
  label: string;
  assignments: ShiftAssignment[];
  warnings: string[];
  score: ShiftScore | null;
}

/** 空欄を自動で埋める（グリーディ1パターンのみ・即時保存） */
export async function autoFillShift(floor: Floor, year: number, month: number): Promise<{ warnings: string[] }> {
  const ctx = await loadContext(floor, year, month);
  if (ctx.staff.length === 0) return { warnings: [] };

  const result = generateShift({
    year, month, floor,
    staff: ctx.staff, shiftTypes: ctx.shiftTypes, config: ctx.config, pairs: ctx.pairs,
    holidays: ctx.holidays, prevMonthAssignments: ctx.prevMonthAssignments, prefilled: ctx.prefilled,
  });

  const merged: ShiftAssignment[] = result.map(a => {
    const orig = ctx.monthAssignments.find(o => o.staffId === a.staffId && o.date === a.date && o.isManual);
    return orig ? { ...a, isManual: true } : a;
  });

  await persistFloorMonth(floor, ctx.mk, merged);
  const warnings = buildGenerationWarnings(merged, ctx.staff, ctx.shiftTypes, ctx.config, ctx.holidays, year, month, ctx.daysInMonth);
  revalidatePath('/shift');
  return { warnings };
}

/** 5パターン生成（通常3+最適化2）。保存はしない — 選んでから applyPattern で確定する */
export async function regenerateShift(floor: Floor, year: number, month: number): Promise<{ patterns: SchedulePattern[]; bestIndex: number }> {
  const ctx = await loadContext(floor, year, month);
  if (ctx.staff.length === 0) return { patterns: [], bestIndex: 0 };

  const evalCtx = { year, month, staff: ctx.staff, shiftTypes: ctx.shiftTypes, config: ctx.config, pairs: ctx.pairs, holidays: ctx.holidays };
  const patterns: SchedulePattern[] = [];

  const applyManual = (result: ShiftAssignment[]) => result.map(a => {
    const orig = ctx.monthAssignments.find(o => o.staffId === a.staffId && o.date === a.date && o.isManual);
    return orig ? { ...a, isManual: true } : a;
  });

  for (let seed = 0; seed < 3; seed++) {
    const result = generateShift({
      year, month, floor, staff: ctx.staff, shiftTypes: ctx.shiftTypes, config: ctx.config, pairs: ctx.pairs,
      holidays: ctx.holidays, prevMonthAssignments: ctx.prevMonthAssignments, prefilled: ctx.prefilled, seed,
    });
    const merged = applyManual(result);
    const warnings = buildGenerationWarnings(merged, ctx.staff, ctx.shiftTypes, ctx.config, ctx.holidays, year, month, ctx.daysInMonth);
    const score = evaluateShift(merged, evalCtx);
    patterns.push({ label: `通常${seed + 1}`, assignments: merged, warnings, score });
  }

  for (let seed = 0; seed < 2; seed++) {
    const result = generateShiftSA({
      year, month, floor, staff: ctx.staff, shiftTypes: ctx.shiftTypes, config: ctx.config, pairs: ctx.pairs,
      holidays: ctx.holidays, prevMonthAssignments: ctx.prevMonthAssignments, prefilled: ctx.prefilled, seed, iterations: 20000,
    });
    const merged = applyManual(result);
    const warnings = buildGenerationWarnings(merged, ctx.staff, ctx.shiftTypes, ctx.config, ctx.holidays, year, month, ctx.daysInMonth);
    const score = evaluateShift(merged, evalCtx);
    patterns.push({ label: `最適化${seed + 1}`, assignments: merged, warnings, score });
  }

  // CP-SATサイドカーが起動していれば6パターン目として追加（未起動・タイムアウト時は黙ってスキップ）
  const cpsat = await generateShiftCpSat(floor, year, month);
  if (cpsat.ok) {
    patterns.push(cpsat.pattern);
  }

  let bestIndex = 0;
  let bestTotal = -Infinity;
  patterns.forEach((p, i) => {
    if (p.score && p.score.total > bestTotal) { bestTotal = p.score.total; bestIndex = i; }
  });

  return { patterns, bestIndex };
}

/** 選んだパターンを確定保存する */
export async function applyPattern(floor: Floor, year: number, month: number, assignments: ShiftAssignment[]): Promise<void> {
  const mk = monthKeyOf(year, month);
  await persistFloorMonth(floor, mk, assignments);
  revalidatePath('/shift');
}

async function persistFloorMonth(floor: Floor, monthKey: string, assignments: ShiftAssignment[]) {
  const staffIds = (await db.staff.findMany({ where: { floor }, select: { id: true } })).map(s => s.id);
  await db.$transaction(async tx => {
    await tx.shiftAssignment.deleteMany({ where: { date: { startsWith: monthKey }, staffId: { in: staffIds } } });
    if (assignments.length > 0) {
      await tx.shiftAssignment.createMany({ data: assignments.map(toAssignmentScalarData) });
    }
  });
}

/** クリア（keepManual: 手入力以外を削除 / all: 全削除） */
export async function clearAssignments(floor: Floor, year: number, month: number, mode: 'keepManual' | 'all'): Promise<void> {
  const mk = monthKeyOf(year, month);
  const staffIds = (await db.staff.findMany({ where: { floor }, select: { id: true } })).map(s => s.id);
  await db.shiftAssignment.deleteMany({
    where: {
      date: { startsWith: mk },
      staffId: { in: staffIds },
      ...(mode === 'keepManual' ? { isManual: false } : {}),
    },
  });
  revalidatePath('/shift');
}

/** 前月末夜勤スタッフの1日目「明け」を一括設定 */
export async function setCarryoverAke(floor: Floor, year: number, month: number, staffIds: string[]): Promise<void> {
  const akeType = await db.shiftType.findFirst({ where: { isAke: true } });
  if (!akeType) return;
  const day1 = `${year}-${String(month).padStart(2, '0')}-01`;
  await db.$transaction(
    staffIds.map(staffId =>
      db.shiftAssignment.upsert({
        where: { staffId_date: { staffId, date: day1 } },
        create: { staffId, date: day1, shiftTypeId: akeType.id, isManual: true },
        update: { shiftTypeId: akeType.id, isManual: true },
      })
    )
  );
  revalidatePath('/shift');
}
