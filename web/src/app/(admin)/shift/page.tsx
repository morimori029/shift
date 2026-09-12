import { getShiftTableData } from '@/server/actions/schedule';
import ShiftTablePageClient from '@/components/shift-table/ShiftTablePageClient';
import type { Floor } from '@/types';

export default async function ShiftPage({ searchParams }: { searchParams: Promise<{ floor?: string; year?: string; month?: string }> }) {
  const params = await searchParams;
  const floor = (params.floor as Floor | undefined) ?? '1F';
  const now = new Date();
  const year = params.year ? Number(params.year) : now.getFullYear();
  const month = params.month ? Number(params.month) : now.getMonth() + 1;

  // 比較モード（1F/2F）は常に両フロア分を読み込んでおく（フロア切替タブとは独立に使えるようにするため）
  const [data1F, data2F, dataCurrent] = await Promise.all([
    getShiftTableData('1F', year, month),
    getShiftTableData('2F', year, month),
    floor === '非常勤' ? getShiftTableData('非常勤', year, month) : Promise.resolve(null),
  ]);
  const data = floor === '1F' ? data1F : floor === '2F' ? data2F : dataCurrent!;

  return (
    <ShiftTablePageClient
      floor={floor}
      year={year}
      month={month}
      data={data}
      compareData={{ '1F': data1F, '2F': data2F }}
    />
  );
}
