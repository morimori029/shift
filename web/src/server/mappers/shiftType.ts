import type { ShiftType } from '@/types';

export interface ShiftTypeRow {
  id: string;
  name: string;
  shortName: string;
  startTime: string;
  endTime: string;
  color: string;
  bgColor: string;
  isDayShift: boolean;
  isNightShift: boolean;
  isAke: boolean;
  order: number;
}

export function toDomainShiftType(row: ShiftTypeRow): ShiftType {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    startTime: row.startTime,
    endTime: row.endTime,
    color: row.color,
    bgColor: row.bgColor,
    isDayShift: row.isDayShift,
    isNightShift: row.isNightShift,
    isAke: row.isAke,
    order: row.order,
  };
}
