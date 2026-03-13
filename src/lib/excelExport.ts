import * as XLSX from 'xlsx';
import type { Staff, ShiftType, ShiftAssignment, FloorConfig, Floor, StaffDayComment } from '../types';
import { DUTY_LABELS } from '../types';
import type { DutyType } from '../types';

const DOW_LABELS = ['日','月','火','水','木','金','土'];

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

export function exportShiftToExcel(params: ExportParams) {
  const { year, month, floor, staff, shiftTypes, assignments, config, comments } = params;
  const daysInMonth = new Date(year, month, 0).getDate();
  const shiftTypeMap = Object.fromEntries(shiftTypes.map(st => [st.id, st]));

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const floorAssignments = assignments.filter(a => {
    const s = staff.find(x => x.id === a.staffId);
    return s?.floor === floor && a.date.startsWith(monthKey);
  });

  const rows: (string | number)[][] = [];

  // Title row
  rows.push([`${year}年${month}月 ${floor} シフト表`]);
  rows.push([]);

  // Header row 1: dates
  const headerDates: (string | number)[] = ['スタッフ'];
  for (let d = 1; d <= daysInMonth; d++) {
    headerDates.push(d);
  }
  headerDates.push('出勤', '夜勤', '公休', 'L回数');
  rows.push(headerDates);

  // Header row 2: day of week
  const headerDow: (string | number)[] = [''];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    headerDow.push(DOW_LABELS[dow]);
  }
  headerDow.push('日数', '回数', '日数', '回数');
  rows.push(headerDow);

  // Staff rows (2 rows per staff: shift row + duty row, matching ShiftTablePage layout)
  staff.forEach(s => {
    const shiftRow: (string | number)[] = [s.name];
    const dutyRow: (string | number)[] = [''];
    let workDays = 0, nightCount = 0, offDays = 0, leaderCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
      const stId = a?.shiftTypeId ?? 'off';
      const st = shiftTypeMap[stId];

      const isPart = s.role === 'パート';
      let cellText = stId === 'paid' ? '有' : (isPart && st?.isDayShift) ? 'H' : (st?.shortName ?? '休');
      if (a?.isLeader) {
        cellText += '(L)';
        leaderCount++;
      }

      // Duty row: show duty label for day shifts (early/day), empty for others
      dutyRow.push(a?.duty ? DUTY_LABELS[a.duty] : '');

      if (stId === 'off' || stId === 'paid') {
        offDays++;
      } else {
        workDays++;
        if (st?.isNightShift) nightCount++;
      }

      shiftRow.push(cellText);
    }

    shiftRow.push(workDays, nightCount, offDays, leaderCount || '');
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

  // Empty row
  rows.push([]);

  // Required staff summary row
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

  // Duty summary rows (業務配置の集計)
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

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  const colWidths: XLSX.ColInfo[] = [{ wch: 14 }];
  for (let d = 0; d < daysInMonth; d++) colWidths.push({ wch: 6 });
  colWidths.push({ wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, `${floor}シフト`);

  const filename = `シフト表_${year}年${month}月_${floor}.xlsx`;
  XLSX.writeFile(wb, filename);
}
