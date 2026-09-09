'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import type { DutyType } from '@/types';

function nextDateOf(date: string): string {
  const dt = new Date(date + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface SetAssignmentResult {
  ok: true;
  warning?: string;
  akeInserted?: boolean;
}

/**
 * セルへの手動シフト設定。newShiftId が null ならセルをクリアする。
 * 夜勤を選ぶと翌日に「明け」を自動挿入し、夜勤以外に変更/クリアした場合は
 * 翌日の自動挿入された明けを取り消す（移行元: ShiftTablePage.tsx の assignShift）。
 */
export async function setAssignment(staffId: string, date: string, newShiftId: string | null): Promise<SetAssignmentResult> {
  const [nightType, akeType, current] = await Promise.all([
    db.shiftType.findFirst({ where: { isNightShift: true } }),
    db.shiftType.findFirst({ where: { isAke: true } }),
    db.shiftAssignment.findUnique({ where: { staffId_date: { staffId, date } } }),
  ]);

  // 現在が夜勤で、変更/クリアする場合は翌日の（自動挿入された）明けを削除する
  if (current?.shiftTypeId === nightType?.id && akeType) {
    const nextDate = nextDateOf(date);
    const nextA = await db.shiftAssignment.findUnique({ where: { staffId_date: { staffId, date: nextDate } } });
    if (nextA && nextA.shiftTypeId === akeType.id) {
      await db.shiftAssignment.delete({ where: { staffId_date: { staffId, date: nextDate } } });
    }
  }

  if (newShiftId === null) {
    await db.shiftAssignment.deleteMany({ where: { staffId, date } });
    revalidatePath('/shift');
    return { ok: true };
  }

  let warning: string | undefined;
  if (newShiftId !== 'off') {
    const st = await db.shiftType.findUnique({ where: { id: newShiftId } });
    const staff = await db.staff.findUnique({ where: { id: staffId }, include: { availableShiftTypes: { select: { id: true } } } });
    if (staff && st && !st.isAke && !staff.availableShiftTypes.some(x => x.id === newShiftId)) {
      warning = `${staff.name} は ${st.name} に対応していません`;
    }
  }

  await db.shiftAssignment.upsert({
    where: { staffId_date: { staffId, date } },
    create: { staffId, date, shiftTypeId: newShiftId === 'off' ? null : newShiftId, isManual: true },
    update: { shiftTypeId: newShiftId === 'off' ? null : newShiftId, isLeader: false, isManual: true },
  });

  let akeInserted = false;
  if (newShiftId === nightType?.id && akeType) {
    const nextDate = nextDateOf(date);
    await db.shiftAssignment.upsert({
      where: { staffId_date: { staffId, date: nextDate } },
      create: { staffId, date: nextDate, shiftTypeId: akeType.id, isManual: true },
      update: { shiftTypeId: akeType.id, isLeader: false, isManual: true },
    });
    akeInserted = true;
  }

  revalidatePath('/shift');
  return { ok: true, warning, akeInserted };
}

/** セル固定（isManual）のON/OFF切り替え */
export async function toggleLock(staffId: string, date: string): Promise<void> {
  const current = await db.shiftAssignment.findUnique({ where: { staffId_date: { staffId, date } } });
  if (!current) return;
  await db.shiftAssignment.update({ where: { staffId_date: { staffId, date } }, data: { isManual: !current.isManual } });
  revalidatePath('/shift');
}

/** 業務（LD・入浴・排泄・フロア・応援）の設定 */
export async function setAssignmentDuty(staffId: string, date: string, duty: DutyType | null): Promise<void> {
  const current = await db.shiftAssignment.findUnique({ where: { staffId_date: { staffId, date } } });
  if (!current) return;
  await db.shiftAssignment.update({ where: { staffId_date: { staffId, date } }, data: { duty } });
  revalidatePath('/shift');
}
