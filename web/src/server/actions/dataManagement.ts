'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';

/** 24ヶ月前などのカットオフ年月（'YYYY-MM'）より前のシフト割当・コメント件数を数える */
export async function countOldAssignments(cutoffYearMonth: string): Promise<number> {
  return db.shiftAssignment.count({ where: { date: { lt: `${cutoffYearMonth}-00` } } });
}

/** カットオフ年月より前のシフト割当・コメントを削除する（スタッフ・設定・ペア設定は対象外） */
export async function purgeOldData(cutoffYearMonth: string): Promise<{ deletedAssignments: number; deletedComments: number }> {
  const cutoff = `${cutoffYearMonth}-00`;
  const [assignments, comments] = await db.$transaction([
    db.shiftAssignment.deleteMany({ where: { date: { lt: cutoff } } }),
    db.staffDayComment.deleteMany({ where: { date: { lt: cutoff } } }),
  ]);
  revalidatePath('/shift');
  revalidatePath('/settings');
  return { deletedAssignments: assignments.count, deletedComments: comments.count };
}
