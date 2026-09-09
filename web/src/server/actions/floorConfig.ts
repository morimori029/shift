'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { toDomainFloorConfig, toFloorConfigScalarData } from '@/server/mappers/floorConfig';
import type { FloorConfig, Floor } from '@/types';

export async function getFloorConfig(floor: Floor): Promise<FloorConfig> {
  const row = await db.floorConfig.findUniqueOrThrow({ where: { floor } });
  return toDomainFloorConfig(row);
}

export async function updateFloorConfig(floor: Floor, patch: Partial<FloorConfig>): Promise<void> {
  const current = await db.floorConfig.findUniqueOrThrow({ where: { floor } });
  const merged = toDomainFloorConfig({ ...current, ...patch });
  await db.floorConfig.update({ where: { floor }, data: toFloorConfigScalarData(merged) });
  revalidatePath('/settings');
  revalidatePath('/shift');
}
