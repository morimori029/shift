import { listStaff } from '@/server/actions/staff';
import { listStaffTags } from '@/server/actions/staffTags';
import { listShiftTypes } from '@/server/actions/shiftTypes';
import StaffPageClient from '@/components/staff/StaffPageClient';
import type { Floor } from '@/types';

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ floor?: string }> }) {
  const params = await searchParams;
  const floor = (params.floor as Floor | undefined) ?? '1F';

  const [staff, tags, shiftTypes] = await Promise.all([
    listStaff(floor),
    listStaffTags(),
    listShiftTypes(),
  ]);

  return <StaffPageClient floor={floor} initialStaff={staff} initialTags={tags} shiftTypes={shiftTypes} />;
}
