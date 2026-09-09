import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { toDomainStaff } from '@/server/mappers/staff';
import { toDomainShiftType } from '@/server/mappers/shiftType';
import { toDomainFloorConfig } from '@/server/mappers/floorConfig';
import { toDomainAssignment } from '@/server/mappers/assignment';
import { buildShiftExcelBuffer } from '@/lib/excelExport';
import type { Floor } from '@/types';

const staffInclude = {
  availableShiftTypes: { select: { id: true } },
  tags: { select: { id: true } },
} as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const floor = (sp.get('floor') ?? '1F') as Floor;
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  if (!year || !month) return NextResponse.json({ error: 'year/month is required' }, { status: 400 });

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const [staffRows, shiftTypeRows, configRow, assignmentRows, commentRows] = await Promise.all([
    db.staff.findMany({ where: { floor }, include: staffInclude, orderBy: { order: 'asc' } }),
    db.shiftType.findMany({ orderBy: { order: 'asc' } }),
    db.floorConfig.findUniqueOrThrow({ where: { floor } }),
    db.shiftAssignment.findMany({ where: { date: { startsWith: monthKey }, staff: { floor } } }),
    db.staffDayComment.findMany({ where: { date: { startsWith: monthKey }, staff: { floor } } }),
  ]);

  const { buffer, filename } = buildShiftExcelBuffer({
    year, month, floor,
    staff: staffRows.map(toDomainStaff),
    shiftTypes: shiftTypeRows.map(toDomainShiftType),
    config: toDomainFloorConfig(configRow),
    assignments: assignmentRows.map(toDomainAssignment),
    comments: commentRows,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
