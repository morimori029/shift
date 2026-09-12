'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { computeJapaneseHolidays } from '@/domain/japaneseHolidays';

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

/** 指定年の日本の祝日を自動計算し、まだ登録されていない日付だけ追加する */
export async function generateHolidaysForYear(year: number): Promise<{ added: { date: string; name: string }[] }> {
  const computed = computeJapaneseHolidays(year);
  const existing = new Set((await db.holiday.findMany({ where: { date: { startsWith: `${year}-` } } })).map(h => h.date));
  const toAdd = computed.filter(h => !existing.has(h.date));

  if (toAdd.length > 0) {
    await db.holiday.createMany({ data: toAdd.map(h => ({ date: h.date })) });
  }

  revalidatePath('/settings');
  revalidatePath('/shift');
  return { added: toAdd };
}
