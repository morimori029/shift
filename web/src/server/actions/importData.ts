'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { migrateLegacyExport, type LegacyBackup } from '@/server/migration';
import { toStaffScalarData } from '@/server/mappers/staff';
import { toFloorConfigScalarData } from '@/server/mappers/floorConfig';
import { toAssignmentScalarData } from '@/server/mappers/assignment';

export type ImportResult =
  | { ok: true; warnings: string[]; counts: Record<string, number> }
  | { ok: false; error: string };

/**
 * 旧アプリ（localStorage版）のエクスポートJSON / 自動バックアップJSONを取り込む。
 * 既存DBの内容は全て置き換える（初回移行・障害復旧の両方を想定した「常設の取込機能」）。
 */
export async function importLegacyBackup(formData: FormData): Promise<ImportResult> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'ファイルが選択されていません' };

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'JSONとして読み込めませんでした' };
  }

  const migrated = migrateLegacyExport(raw);
  if (!migrated.ok) return { ok: false, error: migrated.error };
  const data: LegacyBackup = migrated.data;

  await db.$transaction(async tx => {
    // 依存関係の逆順で全削除してから、依存関係の正順で全投入する
    await tx.staffDayComment.deleteMany();
    await tx.shiftAssignment.deleteMany();
    await tx.tagPairSetting.deleteMany();
    await tx.pairSetting.deleteMany();
    await tx.holiday.deleteMany();
    await tx.staff.deleteMany();
    await tx.staffTag.deleteMany();
    await tx.floorConfig.deleteMany();
    await tx.shiftType.deleteMany();

    if (data.shiftTypes.length > 0) {
      await tx.shiftType.createMany({ data: data.shiftTypes });
    }

    if (data.staffTags.length > 0) {
      await tx.staffTag.createMany({ data: data.staffTags.map(t => ({ id: t.id, name: t.name })) });
    }

    for (const fc of data.floorConfigs) {
      await tx.floorConfig.create({ data: { floor: fc.floor, ...toFloorConfigScalarData(fc) } });
    }

    // Staff は availableShiftTypes/tags が M:N のため1件ずつ create（connect）する
    for (let i = 0; i < data.staffList.length; i++) {
      const s = data.staffList[i];
      await tx.staff.create({
        data: {
          id: s.id,
          order: i,
          ...toStaffScalarData({
            name: s.name,
            floor: s.floor,
            role: s.role,
            availableShiftTypeIds: s.availableShiftTypes,
            availableDuties: s.availableDuties,
            monthlyWorkDays: s.monthlyWorkDays,
            weeklyWorkDays: s.weeklyWorkDays,
            isNightOnly: s.isNightOnly,
            nightShiftMin: s.nightShiftMin,
            nightShiftMax: s.nightShiftMax,
            isShortTime: s.isShortTime,
            excludeFromCount: s.excludeFromCount,
            unavailableDow: s.unavailableDow,
            unavailableOnHoliday: s.unavailableOnHoliday,
            tagIds: s.tags,
            memo: s.memo,
            highlightColor: s.highlightColor,
          }),
          availableShiftTypes: { connect: s.availableShiftTypes.map(id => ({ id })) },
          tags: { connect: s.tags.map(id => ({ id })) },
        },
      });
    }

    const uniqueHolidays = [...new Set(data.holidays)];
    if (uniqueHolidays.length > 0) {
      await tx.holiday.createMany({ data: uniqueHolidays.map(date => ({ date })) });
    }

    if (data.pairSettings.length > 0) {
      await tx.pairSetting.createMany({
        data: data.pairSettings.map(p => ({ id: p.id, staff1Id: p.staffId1, staff2Id: p.staffId2, type: p.type, scope: p.scope, memo: p.memo })),
      });
    }

    if (data.tagPairSettings.length > 0) {
      await tx.tagPairSetting.createMany({
        data: data.tagPairSettings.map(p => ({ id: p.id, tag1Id: p.tagId1, tag2Id: p.tagId2, type: p.type, scope: p.scope, memo: p.memo })),
      });
    }

    if (data.assignments.length > 0) {
      await tx.shiftAssignment.createMany({ data: data.assignments.map(toAssignmentScalarData) });
    }

    if (data.staffComments.length > 0) {
      await tx.staffDayComment.createMany({ data: data.staffComments });
    }
  });

  revalidatePath('/', 'layout');

  return {
    ok: true,
    warnings: migrated.warnings,
    counts: {
      staff: data.staffList.length,
      shiftTypes: data.shiftTypes.length,
      floorConfigs: data.floorConfigs.length,
      assignments: data.assignments.length,
      pairSettings: data.pairSettings.length,
      holidays: data.holidays.length,
    },
  };
}
