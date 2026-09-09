'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';

export async function listHolidays(): Promise<string[]> {
  const rows = await db.holiday.findMany({ orderBy: { date: 'asc' } });
  return rows.map(r => r.date);
}

export async function addHoliday(date: string): Promise<void> {
  await db.holiday.upsert({ where: { date }, create: { date }, update: {} });
  revalidatePath('/settings');
  revalidatePath('/shift');
}

export async function removeHoliday(date: string): Promise<void> {
  await db.holiday.delete({ where: { date } }).catch(() => {});
  revalidatePath('/settings');
  revalidatePath('/shift');
}
