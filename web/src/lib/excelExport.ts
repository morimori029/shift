import * as XLSX from 'xlsx';
import type { Staff, ShiftType, ShiftAssignment, FloorConfig, Floor, StaffDayComment, DutyType } from '@/types';
import { DUTY_LABELS } from '@/types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface ExportParams {
  year: number;
  month: number;
  floor: Floor;
  staff: Staff[];
  shiftTypes: ShiftType[];
  assignments: ShiftAssignment[];
  config: FloorConfig;
  comments?: StaffDayComment[];
}

/** ShiftTablePage.tsx の exportShiftToExcel を移植。サーバー側でBufferを返すよう XLSX.writeFile を XLSX.write に変更 */
export function buildShiftExcelBuffer(params: ExportParams): { buffer: Buffer; filename: string } {
  const { year, month, floor, staff, shiftTypes, assignments, config, comments } = params;
  const daysInMonth = new Date(year, month, 0).getDate();
  const shiftTypeMap = Object.fromEntries(shiftTypes.map(st => [st.id, st]));
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const floorAssignments = assignments.filter(a => {
    const s = staff.find(x => x.id === a.staffId);
    return s?.floor === floor && a.date.startsWith(monthKey);
  });

  const rows: (string | number)[][] = [];
  rows.push([`${year}年${month}月 ${floor} シフト表`]);
  rows.push([]);

  const headerDates: (string | number)[] = ['スタッフ'];
  for (let d = 1; d <= daysInMonth; d++) headerDates.push(d);
  headerDates.push('出勤', '夜勤', '公休', '有給', 'L回数');
  rows.push(headerDates);

  const headerDow: (string | number)[] = [''];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    headerDow.push(DOW_LABELS[dow]);
  }
  headerDow.push('日数', '回数', '日数', '日数', '回数');
  rows.push(headerDow);

  staff.forEach(s => {
    const shiftRow: (string | number)[] = [s.name];
    const dutyRow: (string | number)[] = [''];
    let workDays = 0, nightCount = 0, offDays = 0, paidDays = 0, leaderCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
      const stId = a?.shiftTypeId ?? 'off';
      const st = shiftTypeMap[stId];

      const isPart = s.role === 'パート';
      const cellText = stId === 'paid' ? '有' : (isPart && st?.isDayShift) ? 'H' : (st?.shortName ?? '休');
      if (a?.isLeader) leaderCount++;

      dutyRow.push(a?.duty ? DUTY_LABELS[a.duty] : '');

      if (stId === 'off') offDays++;
      else if (stId === 'paid') paidDays++;
      else {
        workDays++;
        if (st?.isNightShift) nightCount++;
      }

      shiftRow.push(cellText);
    }

    shiftRow.push(workDays, nightCount, offDays, paidDays || '', leaderCount || '');
    rows.push(shiftRow);
    rows.push(dutyRow);

    const hasAnyComment = comments?.some(c => c.staffId === s.id && c.date.startsWith(monthKey));
    if (hasAnyComment) {
      const commentRow: (string | number)[] = [''];
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cmt = comments?.find(c => c.staffId === s.id && c.date === date)?.comment ?? '';
        commentRow.push(cmt);
      }
      rows.push(commentRow);
    }
  });

  rows.push([]);

  const reqRow: (string | number)[] = ['必要人数'];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(year, month - 1, d).getDay();
    const dayAs = floorAssignments.filter(a => a.date === date);
    const parts = shiftTypes
      .filter(st => {
        if (st.isAke) return false;
        const reqArr = config.shiftRequirements[st.id];
        return reqArr && (reqArr[dow] ?? 0) > 0;
      })
      .map(st => {
        const filled = dayAs.filter(a => a.shiftTypeId === st.id).length;
        const reqArr = config.shiftRequirements[st.id];
        const req = reqArr ? reqArr[dow] ?? 0 : 0;
        return `${st.shortName}${filled}/${req}`;
      });
    reqRow.push(parts.join(' '));
  }
  rows.push(reqRow);

  rows.push([]);
  rows.push(['【業務配置】']);
  const dutyTypes: DutyType[] = ['ld', 'bathing', 'floor', 'toilet', 'onef'];
  for (const duty of dutyTypes) {
    const dutyRow: (string | number)[] = [DUTY_LABELS[duty]];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = floorAssignments.filter(a => a.date === date && a.duty === duty).length;
      dutyRow.push(count || '');
    }
    rows.push(dutyRow);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colWidths: XLSX.ColInfo[] = [{ wch: 14 }];
  for (let d = 0; d < daysInMonth; d++) colWidths.push({ wch: 6 });
  colWidths.push({ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 });
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, `${floor}シフト`);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const filename = `シフト表_${year}年${month}月_${floor}.xlsx`;
  return { buffer, filename };
}
