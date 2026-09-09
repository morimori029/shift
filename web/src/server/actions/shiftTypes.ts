'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { toDomainShiftType } from '@/server/mappers/shiftType';
import type { ShiftType } from '@/types';

export async function listShiftTypes(): Promise<ShiftType[]> {
  const rows = await db.shiftType.findMany({ orderBy: { order: 'asc' } });
  return rows.map(toDomainShiftType);
}

/**
 * ShiftType削除ガード: このシフト種別が「唯一の担当可能シフト」になっているスタッフが
 * 1人でもいる場合は削除を拒否する（現行アプリの無言no-opと違い、呼び出し元に明示エラーを返す）。
 */
export async function deleteShiftType(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const staffLeftWithNone = await db.staff.findMany({
    where: { availableShiftTypes: { some: { id } } },
    select: { id: true, name: true, availableShiftTypes: { select: { id: true } } },
  });
  const blocked = staffLeftWithNone.filter(s => s.availableShiftTypes.length === 1);
  if (blocked.length > 0) {
    return {
      ok: false,
      error: `このシフト種別を削除すると、${blocked.map(s => s.name).join('、')} の担当可能シフトが0件になるため削除できません`,
    };
  }

  // ShiftAssignment.shiftTypeId は onDelete: Cascade なので、このシフト種別が入っている
  // 割当は削除される（現行アプリの「assignmentsからこのshiftTypeIdの行を削除」と同じ挙動）。
  await db.shiftType.delete({ where: { id } });
  revalidatePath('/settings');
  revalidatePath('/shift');
  return { ok: true };
}
