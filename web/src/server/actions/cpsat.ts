'use server';

import { assignDuties } from '@/domain/scheduler';
import { evaluateShift } from '@/domain/schedulerSA';
import { loadContext } from '@/server/scheduleContext';
import { buildGenerationWarnings } from '@/server/warnings';
import type { Floor, ShiftAssignment } from '@/types';
import type { SchedulePattern } from './schedule';

const SIDECAR_URL = process.env.SIDECAR_URL ?? 'http://127.0.0.1:8001';

interface SidecarResponse {
  status: 'optimal' | 'feasible' | 'infeasible' | 'error';
  assignments: ShiftAssignment[];
  solveTimeSeconds: number;
  message: string | null;
}

export type CpSatResult =
  | { ok: true; pattern: SchedulePattern }
  | { ok: false; reason: 'unreachable' | 'infeasible' | 'error'; message: string };

/**
 * Python(CP-SAT)サイドカーへシフト生成を依頼する。
 * サイドカーは「誰がどのシフト種別か」だけを厳密に解き、業務（LD/入浴/排泄/フロア）の
 * 割当はここで既存の assignDuties()（scheduler.ts、テスト済み）を後段適用して行う
 * （業務ロジックの二重実装を避けるため）。
 * サイドカーが未起動・タイムアウトの場合は ok:false を返す（呼び出し元は他のパターンで代替する）。
 */
export async function generateShiftCpSat(floor: Floor, year: number, month: number): Promise<CpSatResult> {
  if (floor === '非常勤') {
    return { ok: false, reason: 'error', message: '非常勤フロアはCP-SAT非対応です' };
  }

  const ctx = await loadContext(floor, year, month);
  if (ctx.staff.length === 0) {
    return { ok: false, reason: 'error', message: 'スタッフが登録されていません' };
  }

  const payload = {
    year, month, floor,
    staff: ctx.staff,
    shiftTypes: ctx.shiftTypes,
    config: ctx.config,
    pairs: ctx.pairs,
    holidays: ctx.holidays,
    prevMonthAssignments: ctx.prevMonthAssignments,
    prefilled: ctx.prefilled,
    timeLimitSeconds: 20,
  };

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    res = await fetch(`${SIDECAR_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    return { ok: false, reason: 'unreachable', message: '最適化サイドカー（CP-SAT）に接続できませんでした' };
  }

  if (!res.ok) {
    return { ok: false, reason: 'error', message: `サイドカーがエラーを返しました (HTTP ${res.status})` };
  }

  const body = (await res.json()) as SidecarResponse;
  if (body.status === 'infeasible' || body.status === 'error') {
    return { ok: false, reason: body.status === 'infeasible' ? 'infeasible' : 'error', message: body.message ?? '解を見つけられませんでした' };
  }

  // 手入力(isManual)を確実に反映（サイドカー側でも固定しているが、二重チェックとして上書き）
  const merged: ShiftAssignment[] = body.assignments.map(a => {
    const orig = ctx.monthAssignments.find(o => o.staffId === a.staffId && o.date === a.date && o.isManual);
    return orig ? { ...orig } : a;
  });

  // 業務割当は既存ロジックを流用
  assignDuties(merged, ctx.staff, ctx.shiftTypes, ctx.config, year, month, ctx.daysInMonth, new Set(ctx.holidays));

  const warnings = buildGenerationWarnings(merged, ctx.staff, ctx.shiftTypes, ctx.config, ctx.holidays, year, month, ctx.daysInMonth);
  const score = evaluateShift(merged, { year, month, staff: ctx.staff, shiftTypes: ctx.shiftTypes, config: ctx.config, pairs: ctx.pairs, holidays: ctx.holidays });

  return {
    ok: true,
    pattern: {
      label: `CP-SAT（${body.status === 'optimal' ? '最適' : '実行可能'}・${body.solveTimeSeconds.toFixed(1)}秒）`,
      assignments: merged,
      warnings,
      score,
    },
  };
}
