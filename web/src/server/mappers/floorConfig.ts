import { Prisma } from '../../generated/prisma/client';
import type { FloorConfig, DutyType } from '@/types';

export interface FloorConfigRow {
  floor: string;
  shiftRequirements: unknown;
  shiftRequirementsEnabled: unknown;
  holidayShiftRequirements: unknown;
  useHolidayRequirements: boolean;
  dutyRequirements: unknown;
  holidayDutyRequirements: unknown;
  leaderCountPerDay: number;
  maxConsecutiveDays: number;
  monthlyOffDays: number;
}

export function toDomainFloorConfig(row: FloorConfigRow): FloorConfig {
  return {
    floor: row.floor as FloorConfig['floor'],
    shiftRequirements: row.shiftRequirements as Record<string, number[]>,
    shiftRequirementsEnabled: row.shiftRequirementsEnabled as Record<string, boolean>,
    holidayShiftRequirements: (row.holidayShiftRequirements as Record<string, number> | null) ?? undefined,
    useHolidayRequirements: row.useHolidayRequirements,
    dutyRequirements: row.dutyRequirements as Record<Exclude<DutyType, 'onef'>, number[]>,
    holidayDutyRequirements: (row.holidayDutyRequirements as Record<string, number> | null) ?? undefined,
    leaderCountPerDay: row.leaderCountPerDay,
    maxConsecutiveDays: row.maxConsecutiveDays,
    monthlyOffDays: row.monthlyOffDays,
  };
}

/** FloorConfig（ドメイン型）から Prisma の update 用スカラーデータを組み立てる */
export function toFloorConfigScalarData(config: FloorConfig) {
  return {
    shiftRequirements: config.shiftRequirements,
    shiftRequirementsEnabled: config.shiftRequirementsEnabled,
    holidayShiftRequirements: config.holidayShiftRequirements ?? Prisma.JsonNull,
    useHolidayRequirements: config.useHolidayRequirements ?? false,
    dutyRequirements: config.dutyRequirements,
    holidayDutyRequirements: config.holidayDutyRequirements ?? Prisma.JsonNull,
    leaderCountPerDay: config.leaderCountPerDay,
    maxConsecutiveDays: config.maxConsecutiveDays,
    monthlyOffDays: config.monthlyOffDays,
  };
}
