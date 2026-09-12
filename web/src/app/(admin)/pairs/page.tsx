import { listStaff } from '@/server/actions/staff';
import { listStaffTags } from '@/server/actions/staffTags';
import { listPairSettings, listTagPairSettings } from '@/server/actions/pairs';
import PairPageClient from '@/components/pairs/PairPageClient';
import type { Floor } from '@/types';

export default async function PairPage({ searchParams }: { searchParams: Promise<{ floor?: string }> }) {
  const params = await searchParams;
  const floor = (params.floor as Floor | undefined) ?? '1F';

  const [staff, tags, pairSettings, tagPairSettings] = await Promise.all([
    listStaff(floor),
    listStaffTags(),
    listPairSettings(floor),
    listTagPairSettings(),
  ]);

  return <PairPageClient staff={staff} tags={tags} initialPairs={pairSettings} initialTagPairs={tagPairSettings} />;
}
