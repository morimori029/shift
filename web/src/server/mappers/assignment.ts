import type { ShiftAssignment, DutyType } from '@/types';

export interface AssignmentRow {
  staffId: string;
  date: string;
  shiftTypeId: string | null; // null = 'off'
  isLeader: boolean;
  isManual: boolean;
  duty: string | null;
}

/** null ⇄ 'off' センチネル変換はこの関数の中に閉じ込める */
export function toDomainAssignment(row: AssignmentRow): ShiftAssignment {
  return {
    staffId: row.staffId,
    date: row.date,
    shiftTypeId: row.shiftTypeId ?? 'off',
    isLeader: row.isLeader,
    isManual: row.isManual,
    duty: (row.duty as DutyType | null) ?? undefined,
  };
}

/** ShiftAssignment（ドメイン型）から Prisma の create/update 用データを組み立てる */
export function toAssignmentScalarData(a: ShiftAssignment) {
  return {
    staffId: a.staffId,
    date: a.date,
    shiftTypeId: a.shiftTypeId === 'off' ? null : a.shiftTypeId,
    isLeader: a.isLeader,
    isManual: a.isManual ?? false,
    duty: a.duty ?? null,
  };
}
