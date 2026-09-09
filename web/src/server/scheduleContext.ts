/**
 * シフト自動生成に必要なデータ一式をDBからロードする共通ヘルパー。
 * Server Action (schedule.ts) と CP-SATサイドカー連携 (cpsat.ts) の両方から使う。
 * 'use server' を付けていない通常のサーバー専用モジュール（Server Action化させないため）。
 */
import { db } from '@/server/db';
import { expandTagPairs } from '@/domain/scheduler';
import { toDomainStaff } from '@/server/mappers/staff';
import { toDomainShiftType } from '@/server/mappers/shiftType';
import { toDomainFloorConfig } from '@/server/mappers/floorConfig';
import { toDomainPairSetting } from '@/server/mappers/pair';
import { toDomainAssignment } from '@/server/mappers/assignment';
import type { Floor, Staff, ShiftType, FloorConfig, PairSetting } from '@/types';

const staffInclude = {
  availableShiftTypes: { select: { id: true } },
  tags: { select: { id: true } },
} as const;

export function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function prevMonthOf(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export async function loadContext(floor: Floor, year: number, month: number) {
  const [staffRows, shiftTypeRows, configRow, pairRows, tagPairRows, holidayRows, staffTagRows] = await Promise.all([
    db.staff.findMany({ where: { floor }, include: staffInclude, orderBy: { order: 'asc' } }),
    db.shiftType.findMany({ orderBy: { order: 'asc' } }),
    db.floorConfig.findUniqueOrThrow({ where: { floor } }),
    db.pairSetting.findMany({ include: { staff1: { select: { floor: true } } } }),
    db.tagPairSetting.findMany(),
    db.holiday.findMany(),
    db.staffTag.findMany(),
  ]);

  const staff: Staff[] = staffRows.map(toDomainStaff);
  const shiftTypes: ShiftType[] = shiftTypeRows.map(toDomainShiftType);
  const config: FloorConfig = toDomainFloorConfig(configRow);
  const holidays = holidayRows.map(h => h.date);

  const floorPairs: PairSetting[] = pairRows.filter(p => p.staff1.floor === floor).map(toDomainPairSetting);
  const tagPairs = tagPairRows.map(tp => ({ id: tp.id, tagId1: tp.tag1Id, tagId2: tp.tag2Id, type: tp.type as 'ng' | 'preferred', scope: tp.scope as 'night' | 'day' | 'all', memo: tp.memo }));
  void staffTagRows;
  const pairs = [...floorPairs, ...expandTagPairs(tagPairs, staff)];

  const mk = monthKeyOf(year, month);
  const monthAssignmentRows = await db.shiftAssignment.findMany({
    where: { date: { startsWith: mk }, staff: { floor } },
  });
  const monthAssignments = monthAssignmentRows.map(toDomainAssignment);
  const prefilled = monthAssignments.filter(a => a.isManual);

  const pm = prevMonthOf(year, month);
  const pmKey = monthKeyOf(pm.year, pm.month);
  const prevMonthRows = await db.shiftAssignment.findMany({
    where: { date: { startsWith: pmKey }, staff: { floor } },
  });
  const prevMonthAssignments = prevMonthRows.map(toDomainAssignment);

  const daysInMonth = new Date(year, month, 0).getDate();

  return { staff, shiftTypes, config, pairs, holidays, prefilled, prevMonthAssignments, monthAssignments, daysInMonth, mk };
}
