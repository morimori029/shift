'use server';

import { db } from '@/server/db';
import { toDomainStaff } from '@/server/mappers/staff';
import { toDomainShiftType } from '@/server/mappers/shiftType';
import { toDomainAssignment } from '@/server/mappers/assignment';
import type { Staff, ShiftType, ShiftAssignment, StaffDayComment } from '@/types';

const staffInclude = {
  availableShiftTypes: { select: { id: true } },
  tags: { select: { id: true } },
} as const;

export interface DailyCalendarData {
  staff: Staff[];
  shiftTypes: ShiftType[];
  assignments: ShiftAssignment[];
  comments: StaffDayComment[];
  holidays: string[];
}

/** 日別カレンダー（1F/2F横並び）に必要なデータ一式をロードする */
export async function getDailyCalendarData(year: number, month: number): Promise<DailyCalendarData> {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const [staffRows, shiftTypeRows, assignmentRows, commentRows, holidayRows] = await Promise.all([
    db.staff.findMany({ where: { floor: { in: ['1F', '2F'] } }, include: staffInclude, orderBy: { order: 'asc' } }),
    db.shiftType.findMany({ orderBy: { order: 'asc' } }),
    db.shiftAssignment.findMany({ where: { date: { startsWith: monthKey }, floor: { in: ['1F', '2F'] } } }),
    db.staffDayComment.findMany({ where: { date: { startsWith: monthKey }, staff: { floor: { in: ['1F', '2F'] } } } }),
    db.holiday.findMany(),
  ]);

  return {
    staff: staffRows.map(toDomainStaff),
    shiftTypes: shiftTypeRows.map(toDomainShiftType),
    assignments: assignmentRows.map(toDomainAssignment),
    comments: commentRows.map(r => ({ staffId: r.staffId, date: r.date, comment: r.comment })),
    holidays: holidayRows.map(h => h.date),
  };
}
