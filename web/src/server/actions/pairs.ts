'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { toDomainPairSetting, toDomainTagPairSetting } from '@/server/mappers/pair';
import type { PairSetting, TagPairSetting, PairType, PairScope, Floor } from '@/types';

export async function listPairSettings(floor: Floor): Promise<PairSetting[]> {
  const rows = await db.pairSetting.findMany({ include: { staff1: { select: { floor: true } } } });
  return rows.filter(r => r.staff1.floor === floor).map(toDomainPairSetting);
}

export interface PairSettingInput {
  staffId1: string;
  staffId2: string;
  type: PairType;
  scope: PairScope;
  memo: string;
}

export async function createPairSetting(input: PairSettingInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.staffId1 || !input.staffId2 || input.staffId1 === input.staffId2) {
    return { ok: false, error: 'スタッフを正しく選択してください' };
  }
  const exists = await db.pairSetting.findFirst({
    where: {
      scope: input.scope,
      OR: [
        { staff1Id: input.staffId1, staff2Id: input.staffId2 },
        { staff1Id: input.staffId2, staff2Id: input.staffId1 },
      ],
    },
  });
  if (exists) return { ok: false, error: 'この組み合わせは既に登録されています' };

  await db.pairSetting.create({
    data: { staff1Id: input.staffId1, staff2Id: input.staffId2, type: input.type, scope: input.scope, memo: input.memo },
  });
  revalidatePath('/pairs');
  return { ok: true };
}

export async function deletePairSetting(id: string): Promise<void> {
  await db.pairSetting.delete({ where: { id } });
  revalidatePath('/pairs');
}

export async function listTagPairSettings(): Promise<TagPairSetting[]> {
  const rows = await db.tagPairSetting.findMany();
  return rows.map(toDomainTagPairSetting);
}

export interface TagPairSettingInput {
  tagId1: string;
  tagId2: string;
  type: PairType;
  scope: PairScope;
  memo: string;
}

export async function createTagPairSetting(input: TagPairSettingInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.tagId1 || !input.tagId2 || input.tagId1 === input.tagId2) {
    return { ok: false, error: 'タグを正しく選択してください' };
  }
  const exists = await db.tagPairSetting.findFirst({
    where: {
      scope: input.scope,
      OR: [
        { tag1Id: input.tagId1, tag2Id: input.tagId2 },
        { tag1Id: input.tagId2, tag2Id: input.tagId1 },
      ],
    },
  });
  if (exists) return { ok: false, error: 'この組み合わせは既に登録されています' };

  await db.tagPairSetting.create({
    data: { tag1Id: input.tagId1, tag2Id: input.tagId2, type: input.type, scope: input.scope, memo: input.memo },
  });
  revalidatePath('/pairs');
  return { ok: true };
}

export async function deleteTagPairSetting(id: string): Promise<void> {
  await db.tagPairSetting.delete({ where: { id } });
  revalidatePath('/pairs');
}
