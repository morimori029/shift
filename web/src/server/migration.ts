/**
 * 旧アプリ（localStorage版）のエクスポートJSON / 自動バックアップJSONを取り込むための
 * 検証・移行（マイグレーション）・クロスリファレンス検証ロジック。
 *
 * 移行元: c:/app/shift/src/context/AppContext.tsx の migrateStaff/migrateShiftTypes/migrateFloorConfigs と
 *        c:/app/shift/src/lib/dataIO.ts の validateImportData/migrateImportedStaff/migrateImportedFloorConfigs/sanitizeCrossReferences。
 * 両者で微妙に食い違っていたロジック（memoの補完有無、floor configの欠落補完有無など）を1本化した。
 */
import { DEFAULT_SHIFT_TYPES, DEFAULT_FLOOR_CONFIGS } from '@/domain/defaults';
import { ALL_DUTIES } from '@/types';
import type {
  Staff, ShiftType, FloorConfig, StaffTag, PairSetting, TagPairSetting,
  ShiftAssignment, StaffDayComment, DutyType,
} from '@/types';

export interface LegacyBackup {
  staffList: Staff[];
  shiftTypes: ShiftType[];
  floorConfigs: FloorConfig[];
  staffTags: StaffTag[];
  pairSettings: PairSetting[];
  tagPairSettings: TagPairSetting[];
  assignments: ShiftAssignment[];
  staffComments: StaffDayComment[];
  holidays: string[];
}

const EXPORT_KEYS = [
  'staffList', 'shiftTypes', 'floorConfigs', 'staffTags', 'pairSettings', 'tagPairSettings',
  'assignments', 'staffComments', 'holidays',
] as const;

// 旧バージョンのJSONに含まれていない場合がある省略可能キー
const OPTIONAL_KEYS = new Set(['holidays', 'staffTags', 'tagPairSettings']);

function validateImportData(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.staffList)) return 'staffList が配列ではありません';
  for (const s of data.staffList) {
    if (typeof s !== 'object' || s === null) return 'staffList の要素がオブジェクトではありません';
    const staff = s as Record<string, unknown>;
    if (typeof staff.id !== 'string') return 'スタッフに id がありません';
    if (typeof staff.name !== 'string') return 'スタッフに name がありません';
    if (typeof staff.floor !== 'string') return 'スタッフに floor がありません';
  }

  if (!Array.isArray(data.shiftTypes)) return 'shiftTypes が配列ではありません';
  for (const st of data.shiftTypes) {
    if (typeof st !== 'object' || st === null) return 'shiftTypes の要素がオブジェクトではありません';
    const shiftType = st as Record<string, unknown>;
    if (typeof shiftType.id !== 'string') return 'シフト種別に id がありません';
    if (typeof shiftType.name !== 'string') return 'シフト種別に name がありません';
  }

  if (!Array.isArray(data.floorConfigs)) return 'floorConfigs が配列ではありません';
  for (const fc of data.floorConfigs) {
    if (typeof fc !== 'object' || fc === null) return 'floorConfigs の要素がオブジェクトではありません';
    const config = fc as Record<string, unknown>;
    if (typeof config.floor !== 'string') return 'フロア設定に floor がありません';
    if (typeof config.shiftRequirements !== 'object' || config.shiftRequirements === null) {
      return 'フロア設定に shiftRequirements がありません';
    }
  }

  if (!Array.isArray(data.pairSettings)) return 'pairSettings が配列ではありません';

  if (!Array.isArray(data.assignments)) return 'assignments が配列ではありません';
  for (const a of data.assignments) {
    if (typeof a !== 'object' || a === null) return 'assignments の要素がオブジェクトではありません';
    const assignment = a as Record<string, unknown>;
    if (typeof assignment.staffId !== 'string') return 'シフト割当に staffId がありません';
    if (typeof assignment.date !== 'string') return 'シフト割当に date がありません';
    if (typeof assignment.shiftTypeId !== 'string') return 'シフト割当に shiftTypeId がありません';
  }

  if (!Array.isArray(data.staffComments)) return 'staffComments が配列ではありません';
  if ('holidays' in data && !Array.isArray(data.holidays)) return 'holidays が配列ではありません';

  return null;
}

function migrateStaff(loaded: Staff[]): Staff[] {
  if (!Array.isArray(loaded)) return [];
  return loaded.map(s => {
    const migrated = { ...s } as Staff & { canLead?: boolean };
    if (!Array.isArray(migrated.availableDuties)) {
      const duties: DutyType[] = migrated.canLead ? ['ld', 'floor', 'toilet'] : ['floor', 'toilet'];
      migrated.availableDuties = duties;
    }
    if (!Array.isArray(migrated.availableShiftTypes)) migrated.availableShiftTypes = [];
    if (!Array.isArray(migrated.unavailableDow)) migrated.unavailableDow = [];
    if (!Array.isArray((migrated as Staff & { tags?: string[] }).tags)) {
      (migrated as Staff & { tags: string[] }).tags = [];
    }
    if (typeof migrated.memo !== 'string') migrated.memo = '';
    delete migrated.canLead;
    return migrated as Staff;
  });
}

function migrateShiftTypes(loaded: ShiftType[]): ShiftType[] {
  const defaultMap = new Map(DEFAULT_SHIFT_TYPES.map(st => [st.id, st]));
  const migrated = loaded.map(st => {
    const def = defaultMap.get(st.id);
    if (def && st.shortName !== def.shortName) return { ...st, shortName: def.shortName };
    return st;
  });
  const ids = new Set(migrated.map(st => st.id));
  const missing = DEFAULT_SHIFT_TYPES.filter(st => !ids.has(st.id));
  return missing.length > 0 ? [...migrated, ...missing] : migrated;
}

function migrateFloorConfigs(loaded: FloorConfig[]): FloorConfig[] {
  const defaultDayShiftIds = DEFAULT_SHIFT_TYPES.filter(st => st.isDayShift).map(st => st.id);

  const migrated = loaded.map(fc => {
    const reqs = { ...fc.shiftRequirements } as Record<string, number | number[]>;
    for (const key of Object.keys(reqs)) {
      const val = reqs[key];
      if (typeof val === 'number') reqs[key] = [val, val, val, val, val, val, val];
    }
    for (const id of defaultDayShiftIds) {
      if (!(id in reqs)) reqs[id] = [0, 0, 0, 0, 0, 0, 0];
    }

    const enabled = { ...(fc.shiftRequirementsEnabled ?? {}) } as Record<string, boolean>;
    for (const key of Object.keys(reqs)) {
      if (!(key in enabled)) enabled[key] = true;
    }

    const dutyReqs = { ...(fc.dutyRequirements ?? {}) } as Record<string, number | number[]>;
    for (const d of ALL_DUTIES) {
      if (!(d in dutyReqs)) {
        dutyReqs[d] = [0, 0, 0, 0, 0, 0, 0];
      } else if (typeof dutyReqs[d] === 'number') {
        const v = dutyReqs[d] as number;
        dutyReqs[d] = [v, v, v, v, v, v, v];
      }
    }

    return {
      ...fc,
      shiftRequirements: reqs as Record<string, number[]>,
      shiftRequirementsEnabled: enabled,
      dutyRequirements: dutyReqs as Record<Exclude<DutyType, 'onef'>, number[]>,
    };
  });

  const existingFloors = new Set(migrated.map(fc => fc.floor));
  for (const def of DEFAULT_FLOOR_CONFIGS) {
    if (!existingFloors.has(def.floor)) migrated.push(def);
  }

  return migrated;
}

function sanitizeCrossReferences(result: LegacyBackup): { data: LegacyBackup; warnings: string[] } {
  const warnings: string[] = [];
  const staffIds = new Set(result.staffList.map(s => s.id));
  const shiftTypeIds = new Set(result.shiftTypes.map(st => st.id));
  const specialShiftIds = new Set(['off', 'paid']);

  const validAssignments = result.assignments.filter(a => {
    if (!staffIds.has(a.staffId)) {
      warnings.push(`割当: 存在しないスタッフID "${a.staffId}" を除去`);
      return false;
    }
    if (!specialShiftIds.has(a.shiftTypeId) && !shiftTypeIds.has(a.shiftTypeId)) {
      warnings.push(`割当: 存在しないシフト種別 "${a.shiftTypeId}" を除去`);
      return false;
    }
    return true;
  });

  const validPairs = result.pairSettings.filter(p => {
    if (!staffIds.has(p.staffId1) || !staffIds.has(p.staffId2)) {
      warnings.push('ペア設定: 存在しないスタッフを参照するペアを除去');
      return false;
    }
    return true;
  });

  const tagIds = new Set(result.staffTags.map(t => t.id));
  const validTagPairs = result.tagPairSettings.filter(p => {
    if (!tagIds.has(p.tagId1) || !tagIds.has(p.tagId2)) {
      warnings.push('タグペア設定: 存在しないタグを参照するペアを除去');
      return false;
    }
    return true;
  });

  const validComments = result.staffComments.filter(c => staffIds.has(c.staffId));

  return {
    data: { ...result, assignments: validAssignments, pairSettings: validPairs, tagPairSettings: validTagPairs, staffComments: validComments },
    warnings,
  };
}

export type MigrateResult =
  | { ok: true; data: LegacyBackup; warnings: string[] }
  | { ok: false; error: string };

/** 旧アプリのエクスポートJSON（手動エクスポート or 3分毎自動バックアップ）を検証・移行する */
export function migrateLegacyExport(raw: unknown): MigrateResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'ファイルの形式が正しくありません' };
  }
  const data = raw as Record<string, unknown>;

  if (data._format !== 'shift-app-backup') {
    return { ok: false, error: 'このファイルはシフトアプリのデータではありません' };
  }
  for (const key of EXPORT_KEYS) {
    if (OPTIONAL_KEYS.has(key)) continue;
    if (!(key in data)) return { ok: false, error: `データに「${key}」が含まれていません` };
  }

  const validationError = validateImportData(data);
  if (validationError) return { ok: false, error: `データの形式が正しくありません: ${validationError}` };

  const rawResult: LegacyBackup = {
    staffList: migrateStaff(data.staffList as Staff[]),
    shiftTypes: migrateShiftTypes(data.shiftTypes as ShiftType[]),
    floorConfigs: migrateFloorConfigs(data.floorConfigs as FloorConfig[]),
    staffTags: (Array.isArray(data.staffTags) ? data.staffTags : []) as StaffTag[],
    pairSettings: data.pairSettings as PairSetting[],
    tagPairSettings: (Array.isArray(data.tagPairSettings) ? data.tagPairSettings : []) as TagPairSetting[],
    assignments: data.assignments as ShiftAssignment[],
    staffComments: data.staffComments as StaffDayComment[],
    holidays: (Array.isArray(data.holidays) ? data.holidays : []) as string[],
  };

  const { data: sanitized, warnings } = sanitizeCrossReferences(rawResult);
  return { ok: true, data: sanitized, warnings };
}
