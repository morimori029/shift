import { getFloorConfig } from '@/server/actions/floorConfig';
import { listHolidays } from '@/server/actions/holidays';
import { listShiftTypes } from '@/server/actions/shiftTypes';
import { listStaff } from '@/server/actions/staff';
import SettingsPageClient from '@/components/settings/SettingsPageClient';
import type { Floor } from '@/types';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ floor?: string }> }) {
  const params = await searchParams;
  const floor = (params.floor as Floor | undefined) ?? '1F';

  const [config, holidays, shiftTypes, staff] = await Promise.all([
    getFloorConfig(floor),
    listHolidays(),
    listShiftTypes(),
    listStaff(floor),
  ]);

  return <SettingsPageClient floor={floor} initialConfig={config} initialHolidays={holidays} shiftTypes={shiftTypes} staff={staff} />;
}
