import type { PairSetting, TagPairSetting, PairType, PairScope } from '@/types';

export interface PairSettingRow {
  id: string;
  staff1Id: string;
  staff2Id: string;
  type: string;
  scope: string;
  memo: string;
}

export function toDomainPairSetting(row: PairSettingRow): PairSetting {
  return {
    id: row.id,
    staffId1: row.staff1Id,
    staffId2: row.staff2Id,
    type: row.type as PairType,
    scope: row.scope as PairScope,
    memo: row.memo,
  };
}

export interface TagPairSettingRow {
  id: string;
  tag1Id: string;
  tag2Id: string;
  type: string;
  scope: string;
  memo: string;
}

export function toDomainTagPairSetting(row: TagPairSettingRow): TagPairSetting {
  return {
    id: row.id,
    tagId1: row.tag1Id,
    tagId2: row.tag2Id,
    type: row.type as PairType,
    scope: row.scope as PairScope,
    memo: row.memo,
  };
}
