'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import type { StaffTag } from '@/types';

export async function listStaffTags(): Promise<StaffTag[]> {
  return db.staffTag.findMany({ orderBy: { name: 'asc' } });
}

export async function createStaffTag(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!name.trim()) return { ok: false, error: 'タグ名を入力してください' };
  const created = await db.staffTag.create({ data: { name: name.trim() } });
  revalidatePath('/staff');
  return { ok: true, id: created.id };
}

/**
 * タグ削除は現行アプリと同じくカスケード的に扱う:
 * - 全スタッフの tags リレーションから自動的に外れる（Prismaの暗黙M:N解除）
 * - このタグを参照する tagPairSettings も削除する
 */
export async function deleteStaffTag(id: string): Promise<void> {
  await db.$transaction([
    db.tagPairSetting.deleteMany({ where: { OR: [{ tag1Id: id }, { tag2Id: id }] } }),
    db.staffTag.delete({ where: { id } }),
  ]);
  revalidatePath('/staff');
  revalidatePath('/pairs');
}
