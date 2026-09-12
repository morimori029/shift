'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import type { StaffDayComment } from '@/types';

/** 指定フロア・月のコメント一覧を取得する */
export async function listComments(floor: string, year: number, month: number): Promise<StaffDayComment[]> {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const rows = await db.staffDayComment.findMany({
    where: { date: { startsWith: monthKey }, staff: { floor } },
  });
  return rows.map(r => ({ staffId: r.staffId, date: r.date, comment: r.comment }));
}

/** コメントを設定する。空文字なら削除する */
export async function setComment(staffId: string, date: string, comment: string): Promise<void> {
  const trimmed = comment.trim();
  if (!trimmed) {
    await db.staffDayComment.deleteMany({ where: { staffId, date } });
  } else {
    await db.staffDayComment.upsert({
      where: { staffId_date: { staffId, date } },
      create: { staffId, date, comment: trimmed },
      update: { comment: trimmed },
    });
  }
  revalidatePath('/shift');
}
