import type { Staff, ShiftType, ShiftAssignment, FloorConfig, Floor, StaffDayComment, DutyType } from '@/types';
import { DUTY_LABELS } from '@/types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface PdfParams {
  year: number;
  month: number;
  floor: Floor;
  staff: Staff[];
  shiftTypes: ShiftType[];
  assignments: ShiftAssignment[];
  config: FloorConfig;
  comments?: StaffDayComment[];
}

/** 移行元: c:/app/shift/src/lib/pdfExport.ts。実体はPDFライブラリではなく、ブラウザの印刷機能（window.print）を使う方式のため、クライアント側のまま無改変で移植 */
export function exportShiftToPdf(params: PdfParams) {
  const { year, month, floor, staff, shiftTypes, assignments, config, comments } = params;
  const daysInMonth = new Date(year, month, 0).getDate();
  const shiftTypeMap = Object.fromEntries(shiftTypes.map(st => [st.id, st]));
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const floorAssignments = assignments.filter(a => {
    const s = staff.find(x => x.id === a.staffId);
    return s?.floor === floor && a.date.startsWith(monthKey);
  });
  const excludedIds = new Set(staff.filter(s => s.excludeFromCount).map(s => s.id));

  const PART_WORK_H = (15 * 60 - 9 * 60 - 30) / 60; // 5.5h (9:00-15:00 休憩30分)

  const calcShiftHours = (st: ShiftType | undefined, isPart: boolean): number => {
    if (!st || st.isAke) return 0;
    if (isPart && st.isDayShift) return PART_WORK_H;
    if (!st.startTime || !st.endTime) return 0;
    const [sh, sm] = st.startTime.split(':').map(Number);
    const [eh, em] = st.endTime.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    const breakMins = st.isNightShift ? 90 : 60;
    return (mins - breakMins) / 60;
  };

  const getStats = (staffId: string) => {
    const s = staff.find(x => x.id === staffId);
    const isPart = s?.role === 'パート' && !s?.isShortTime;
    const sa = floorAssignments.filter(a => a.staffId === staffId);
    const totalHours = sa.reduce((sum, a) => sum + calcShiftHours(shiftTypeMap[a.shiftTypeId], isPart), 0);
    return {
      work: sa.filter(a => a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid').length,
      night: sa.filter(a => shiftTypeMap[a.shiftTypeId]?.isNightShift).length,
      off: sa.filter(a => a.shiftTypeId === 'off' || a.shiftTypeId === 'paid').length,
      leader: sa.filter(a => a.isLeader).length,
      totalHours,
    };
  };

  let dateHeaders = '';
  let dowHeaders = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const cls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    dateHeaders += `<th class="${cls}">${d}</th>`;
    dowHeaders += `<th class="dow ${cls}">${DOW_LABELS[dow]}</th>`;
  }

  const DUTY_ROW_COLORS: Record<DutyType, string> = {
    ld: '#7c3aed', bathing: '#2563eb', floor: '#059669', toilet: '#d97706', onef: '#6b7280',
  };

  let staffRows = '';
  staff.forEach(s => {
    const stats = getStats(s.id);
    let cells = '';
    let dutyCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
      const stId = a?.shiftTypeId ?? 'off';
      const st = shiftTypeMap[stId];
      const dow = new Date(year, month - 1, d).getDay();
      const dowCls = dow === 0 ? 'sun-bg' : dow === 6 ? 'sat-bg' : '';

      const isShort = s.isShortTime && st?.isDayShift;
      const isPart = s.role === 'パート' && !s.isShortTime && st?.isDayShift;
      const text = stId === 'paid' ? '有' : isShort ? 'I' : isPart ? 'H' : (st?.shortName ?? '休');
      let style = '';
      if (stId === 'paid') {
        style = 'background:#e0e7ff;color:#4338ca;font-weight:bold;';
      } else if (isShort) {
        style = 'background:#ccfbf1;color:#0d9488;font-weight:bold;';
      } else if (isPart) {
        style = 'background:#fef3c7;color:#d97706;font-weight:bold;';
      } else if (st) {
        style = `background:${st.bgColor};color:${st.color};font-weight:bold;`;
      } else {
        style = 'color:#94a3b8;';
      }
      cells += `<td class="${dowCls}" style="${style}">${text}</td>`;

      if (a?.duty) {
        const dutyColor = DUTY_ROW_COLORS[a.duty] ?? '#6b7280';
        dutyCells += `<td class="duty-cell" style="color:${dutyColor}">${DUTY_LABELS[a.duty]}</td>`;
      } else {
        dutyCells += `<td class="duty-cell"></td>`;
      }
    }
    const offWarn = stats.off > config.monthlyOffDays ? ' style="color:#dc2626;font-weight:bold"' : '';
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const hasAnyComment = comments?.some(c => c.staffId === s.id && c.date.startsWith(monthPrefix));

    const extraRows = 1 + (hasAnyComment ? 1 : 0);
    const rowspanAttr = extraRows > 0 ? ` rowspan="${1 + extraRows}"` : '';

    staffRows += `<tr>
      <td class="name"${rowspanAttr}>${s.name}</td>
      ${cells}
      <td class="stat"${rowspanAttr}>${stats.work}</td>
      <td class="stat"${rowspanAttr}>${stats.night}</td>
      <td class="stat"${rowspanAttr}${offWarn}>${stats.off}</td>
      <td class="stat"${rowspanAttr}>${stats.totalHours % 1 === 0 ? stats.totalHours : stats.totalHours.toFixed(1)}h</td>
    </tr>`;

    staffRows += `<tr class="duty-row">${dutyCells}</tr>`;

    if (hasAnyComment) {
      let cmtCells = '';
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cmt = (comments?.find(c => c.staffId === s.id && c.date === date)?.comment ?? '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        cmtCells += `<td class="cmt-cell">${cmt}</td>`;
      }
      staffRows += `<tr class="cmt-row">${cmtCells}</tr>`;
    }
  });

  let reqCells = '';
  let dutySumCells = '';
  let hasDutySummary = false;
  const DUTY_COLORS: Partial<Record<DutyType, string>> = {
    ld: '#7c3aed', bathing: '#2563eb', floor: '#059669', toilet: '#d97706',
  };
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
        const filled = dayAs.filter(a => a.shiftTypeId === st.id && !excludedIds.has(a.staffId)).length;
        const reqArr = config.shiftRequirements[st.id];
        const req = reqArr ? reqArr[dow] ?? 0 : 0;
        const color = filled >= req ? st.color : '#dc2626';
        return `<span style="color:${color}">${st.shortName}${filled}/${req}</span>`;
      });
    reqCells += `<td class="req">${parts.join('<br>')}</td>`;

    const dutyParts = (['ld', 'bathing', 'floor', 'toilet'] as DutyType[])
      .map(duty => {
        const req = (config.dutyRequirements as Record<string, number[]> | undefined)?.[duty]?.[dow] ?? 0;
        if (req === 0) return '';
        hasDutySummary = true;
        const filled = dayAs.filter(a => a.duty === duty).length;
        const color = filled >= req ? (DUTY_COLORS[duty] ?? '#6b7280') : '#dc2626';
        return `<span style="color:${color}">${DUTY_LABELS[duty]}${filled}/${req}</span>`;
      })
      .filter(Boolean);
    dutySumCells += `<td class="req">${dutyParts.join('<br>')}</td>`;
  }

  let legendHtml = '';
  shiftTypes.forEach(st => {
    legendHtml += `<span class="legend-item" style="background:${st.bgColor};color:${st.color}">${st.shortName}</span><span class="legend-label">${st.name}</span>`;
  });
  legendHtml += '<span class="legend-item" style="color:#94a3b8">休</span><span class="legend-label">公休</span>';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>シフト表 ${year}年${month}月 ${floor}</title>
<style>
  @page { size: A3 landscape; margin: 5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Meiryo", "Hiragino Sans", sans-serif; font-size: 8.5px; line-height: 1.2; color: #1e293b; }
  h1 { font-size: 12px; margin-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 1px solid #cbd5e1; padding: 1px 2px; text-align: center; white-space: nowrap; overflow: hidden; height: 14px; }
  th { background: #f1f5f9; font-size: 7.5px; }
  th.sun, td.sun { color: #dc2626; }
  th.sat, td.sat { color: #2563eb; }
  td.sun-bg { background: #fef2f2; }
  td.sat-bg { background: #eff6ff; }
  th.dow { font-size: 6.5px; padding: 1px; }
  td.name { text-align: left; font-weight: bold; padding: 1px 4px; background: #fff; width: 62px; vertical-align: top; overflow: hidden; }
  .duty-row td, .duty-cell { font-size: 5.5px; font-weight: bold; padding: 0 1px; height: 14px; }
  .cmt-row td, .cmt-cell { font-size: 5.5px; color: #64748b; font-weight: normal; padding: 0 1px; height: 10px; }
  td.stat { background: #f8fafc; font-weight: bold; width: 20px; }
  td.req { font-size: 6.5px; line-height: 1.2; vertical-align: top; }
  tr.req-row td { background: #f8fafc; }
  sup { font-size: 5.5px; color: #b45309; font-weight: bold; }
  .legend { margin-top: 3px; font-size: 7.5px; }
  .legend-item { display: inline-block; padding: 1px 4px; border-radius: 3px; font-weight: bold; font-size: 7.5px; margin-right: 2px; }
  .legend-label { margin-right: 6px; color: #64748b; }
  .footer { margin-top: 2px; font-size: 6.5px; color: #94a3b8; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<h1>${year}年${month}月 ${floor} シフト表</h1>
<table>
  <thead>
    <tr>
      <th rowspan="2" style="min-width:70px">スタッフ</th>
      ${dateHeaders}
      <th rowspan="2">出勤</th>
      <th rowspan="2">夜勤</th>
      <th rowspan="2">公休</th>
      <th rowspan="2">時間</th>
    </tr>
    <tr>${dowHeaders}</tr>
  </thead>
  <tbody>
    ${staffRows}
    <tr class="req-row">
      <td class="name" style="font-size:7px">必要人数</td>
      ${reqCells}
      <td colspan="4"></td>
    </tr>
    ${hasDutySummary ? `<tr class="req-row">
      <td class="name" style="font-size:7px">業務</td>
      ${dutySumCells}
      <td colspan="4"></td>
    </tr>` : ''}
  </tbody>
</table>
<div class="legend">${legendHtml}</div>
<div class="footer">出力日: ${new Date().toLocaleDateString('ja-JP')} ／ L=リーダー</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 300);
}
