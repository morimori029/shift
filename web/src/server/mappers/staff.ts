import type { Staff, DutyType } from '@/types';

/** Prisma から取得する Staff 行の最小形（このマッパーが必要とするフィールドのみ） */
export interface StaffRow {
  id: string;
  name: string;
  floor: string;
  role: string;
  order: number;
  monthlyWorkDays: number | null;
  weeklyWorkDays: number | null;
  isNightOnly: boolean;
  nightShiftMin: number | null;
  nightShiftMax: number | null;
  isShortTime: boolean;
  excludeFromCount: boolean;
  unavailableDow: unknown;
  unavailableOnHoliday: boolean | null;
  memo: string;
  highlightColor: string | null;
  availableDuties: unknown;
  availableShiftTypes: { id: string }[];
  tags: { id: string }[];
}

/** Prisma の Staff 行（関連含む）をドメイン型 Staff に変換する */
export function toDomainStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    name: row.name,
    floor: row.floor as Staff['floor'],
    role: row.role as Staff['role'],
    availableShiftTypes: row.availableShiftTypes.map(st => st.id),
    availableDuties: (row.availableDuties as DutyType[] | null) ?? [],
    monthlyWorkDays: row.monthlyWorkDays ?? undefined,
    weeklyWorkDays: row.weeklyWorkDays ?? undefined,
    isNightOnly: row.isNightOnly,
    nightShiftMin: row.nightShiftMin ?? undefined,
    nightShiftMax: row.nightShiftMax ?? undefined,
    isShortTime: row.isShortTime,
    excludeFromCount: row.excludeFromCount,
    unavailableDow: (row.unavailableDow as number[] | null) ?? [],
    unavailableOnHoliday: row.unavailableOnHoliday ?? undefined,
    tags: row.tags.map(t => t.id),
    memo: row.memo,
    highlightColor: (row.highlightColor as Staff['highlightColor']) ?? undefined,
  };
}

/** Staff CRUD フォームの入力形（新規作成・更新の両方で使う） */
export interface StaffInput {
  name: string;
  floor: Staff['floor'];
  role: Staff['role'];
  availableShiftTypeIds: string[];
  availableDuties: DutyType[];
  monthlyWorkDays?: number;
  weeklyWorkDays?: number;
  isNightOnly?: boolean;
  nightShiftMin?: number;
  nightShiftMax?: number;
  isShortTime?: boolean;
  excludeFromCount?: boolean;
  unavailableDow: number[];
  unavailableOnHoliday?: boolean;
  tagIds: string[];
  memo: string;
  highlightColor?: 'color1' | 'color2';
}

/** StaffInput から Prisma の create/update 用データ（スカラー値部分のみ）を組み立てる */
export function toStaffScalarData(input: StaffInput) {
  return {
    name: input.name,
    floor: input.floor,
    role: input.role,
    monthlyWorkDays: input.monthlyWorkDays ?? null,
    weeklyWorkDays: input.weeklyWorkDays ?? null,
    isNightOnly: input.isNightOnly ?? false,
    nightShiftMin: input.nightShiftMin ?? null,
    nightShiftMax: input.nightShiftMax ?? null,
    isShortTime: input.isShortTime ?? false,
    excludeFromCount: input.excludeFromCount ?? false,
    unavailableDow: input.unavailableDow,
    unavailableOnHoliday: input.unavailableOnHoliday ?? null,
    availableDuties: input.availableDuties,
    memo: input.memo,
    highlightColor: input.highlightColor ?? null,
  };
}
