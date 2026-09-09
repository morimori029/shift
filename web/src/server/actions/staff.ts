'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { toDomainStaff, toStaffScalarData, type StaffInput } from '@/server/mappers/staff';
import type { Floor, Staff } from '@/types';

const staffInclude = {
  availableShiftTypes: { select: { id: true } },
  tags: { select: { id: true } },
} as const;

export async function listStaff(floor?: Floor): Promise<Staff[]> {
  const rows = await db.staff.findMany({
    where: floor ? { floor } : undefined,
    include: staffInclude,
    orderBy: { order: 'asc' },
  });
  return rows.map(toDomainStaff);
}

export async function createStaff(input: StaffInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: '氏名を入力してください' };
  if (input.availableShiftTypeIds.length === 0) return { ok: false, error: '担当できるシフトを1つ以上選択してください' };

  // 現行アプリと同じ自動補正: 夜勤最低回数 > 最高回数 なら最高回数を最低回数に合わせる
  const nightShiftMax =
    input.nightShiftMin && input.nightShiftMax && input.nightShiftMin > input.nightShiftMax
      ? input.nightShiftMin
      : input.nightShiftMax;

  const maxOrder = await db.staff.aggregate({ where: { floor: input.floor }, _max: { order: true } });
  const order = (maxOrder._max.order ?? -1) + 1;

  const created = await db.staff.create({
    data: {
      ...toStaffScalarData({ ...input, nightShiftMax }),
      order,
      availableShiftTypes: { connect: input.availableShiftTypeIds.map(id => ({ id })) },
      tags: { connect: input.tagIds.map(id => ({ id })) },
    },
  });

  revalidatePath('/staff');
  return { ok: true, id: created.id };
}

export async function updateStaff(id: string, input: StaffInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: '氏名を入力してください' };
  if (input.availableShiftTypeIds.length === 0) return { ok: false, error: '担当できるシフトを1つ以上選択してください' };

  const nightShiftMax =
    input.nightShiftMin && input.nightShiftMax && input.nightShiftMin > input.nightShiftMax
      ? input.nightShiftMin
      : input.nightShiftMax;

  await db.staff.update({
    where: { id },
    data: {
      ...toStaffScalarData({ ...input, nightShiftMax }),
      availableShiftTypes: { set: input.availableShiftTypeIds.map(sid => ({ id: sid })) },
      tags: { set: input.tagIds.map(tid => ({ id: tid })) },
    },
  });

  revalidatePath('/staff');
  return { ok: true };
}

/** カスケード削除（PairSetting両側・ShiftAssignment・StaffDayComment）は Prisma スキーマの onDelete: Cascade に委ねる */
export async function deleteStaff(id: string): Promise<void> {
  await db.staff.delete({ where: { id } });
  revalidatePath('/staff');
}

/** フロア内の並び替え。ドラッグ&ドロップ・▲▼ボタンの両方からこの関数を呼ぶ */
export async function reorderStaff(floor: Floor, orderedIds: string[]): Promise<void> {
  await db.$transaction(
    orderedIds.map((id, index) => db.staff.update({ where: { id }, data: { order: index } }))
  );
  revalidatePath('/staff');
}
