import type { Staff, ShiftType, ShiftAssignment, FloorConfig, Floor, StaffDayComment } from '../types';

const DOW_LABELS = ['日','月','火','水','木','金','土'];

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

export function exportShiftToPdf(params: PdfParams) {
  const { year, month, floor, staff, shiftTypes, assignments, config, comments } = params;
  const daysInMonth = new Date(year, month, 0).getDate();
  const shiftTypeMap = Object.fromEntries(shiftTypes.map(st => [st.id, st]));
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const floorAssignments = assignments.filter(a => {
    const s = staff.find(x => x.id === a.staffId);
    return s?.floor === floor && a.date.startsWith(monthKey);
  });

  const getStats = (staffId: string) => {
    const sa = floorAssignments.filter(a => a.staffId === staffId);
    return {
      work: sa.filter(a => a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid').length,
      night: sa.filter(a => shiftTypeMap[a.shiftTypeId]?.isNightShift).length,
      off: sa.filter(a => a.shiftTypeId === 'off' || a.shiftTypeId === 'paid').length,
      leader: sa.filter(a => a.isLeader).length,
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

  let staffRows = '';
  staff.forEach(s => {
    const stats = getStats(s.id);
    let cells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const a = floorAssignments.find(x => x.staffId === s.id && x.date === date);
      const stId = a?.shiftTypeId ?? 'off';
      const st = shiftTypeMap[stId];
      const dow = new Date(year, month - 1, d).getDay();
      const dowCls = dow === 0 ? 'sun-bg' : dow === 6 ? 'sat-bg' : '';

      const isPart = s.role === 'パート';
      const usePartStyle = isPart && st?.isDayShift;
      let text = stId === 'paid' ? '有' : usePartStyle ? 'H' : (st?.shortName ?? '休');
      let style = '';
      if (stId === 'paid') {
        style = 'background:#e0e7ff;color:#4338ca;font-weight:bold;';
      } else if (usePartStyle) {
        style = 'background:#fef3c7;color:#d97706;font-weight:bold;';
      } else if (st) {
        style = `background:${st.bgColor};color:${st.color};font-weight:bold;`;
      } else {
        style = 'color:#94a3b8;';
      }
      if (a?.isLeader) text += '<sup>L</sup>';
      cells += `<td class="${dowCls}" style="${style}">${text}</td>`;
    }
    const offWarn = stats.off > config.monthlyOffDays ? ' style="color:#dc2626;font-weight:bold"' : '';
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const hasAnyComment = comments?.some(c => c.staffId === s.id && c.date.startsWith(monthPrefix));

    staffRows += `<tr>
      <td class="name"${hasAnyComment ? ' rowspan="2"' : ''}>${s.name}</td>
      ${cells}
      <td class="stat"${hasAnyComment ? ' rowspan="2"' : ''}>${stats.work}</td>
      <td class="stat"${hasAnyComment ? ' rowspan="2"' : ''}>${stats.night}</td>
      <td class="stat"${hasAnyComment ? ' rowspan="2"' : ''}${offWarn}>${stats.off}</td>
      <td class="stat"${hasAnyComment ? ' rowspan="2"' : ''}>${stats.leader || '-'}</td>
    </tr>`;

    if (hasAnyComment) {
      let cmtCells = '';
      for (let d = 1; d <= daysInMonth; d++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cmt = comments?.find(c => c.staffId === s.id && c.date === date)?.comment ?? '';
        cmtCells += `<td class="cmt-cell">${cmt}</td>`;
      }
      staffRows += `<tr class="cmt-row">${cmtCells}</tr>`;
    }
  });

  let reqCells = '';
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
        const color = filled >= req ? st.color : '#dc2626';
        return `<span style="color:${color}">${st.shortName}${filled}/${req}</span>`;
      });
    reqCells += `<td class="req">${parts.join('<br>')}</td>`;
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
  @page { size: A3 landscape; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Meiryo", "Hiragino Sans", sans-serif; font-size: 9px; color: #1e293b; }
  h1 { font-size: 14px; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #cbd5e1; padding: 2px 3px; text-align: center; white-space: nowrap; }
  th { background: #f1f5f9; font-size: 8px; }
  th.sun, td.sun { color: #dc2626; }
  th.sat, td.sat { color: #2563eb; }
  td.sun-bg { background: #fef2f2; }
  td.sat-bg { background: #eff6ff; }
  th.dow { font-size: 7px; padding: 1px 2px; }
  td.name { text-align: left; font-weight: bold; padding: 2px 5px; background: #fff; min-width: 70px; vertical-align: top; }
  .cmt-row td, .cmt-cell { font-size: 6px; color: #64748b; font-weight: normal; padding: 0 1px; height: 12px; }
  td.stat { background: #f8fafc; font-weight: bold; min-width: 24px; }
  td.req { font-size: 7px; line-height: 1.3; vertical-align: top; }
  tr.req-row td { background: #f8fafc; }
  sup { font-size: 6px; color: #b45309; font-weight: bold; }
  .legend { margin-top: 6px; font-size: 8px; }
  .legend-item { display: inline-block; padding: 1px 5px; border-radius: 3px; font-weight: bold; font-size: 8px; margin-right: 2px; }
  .legend-label { margin-right: 8px; color: #64748b; }
  .footer { margin-top: 4px; font-size: 7px; color: #94a3b8; }
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
      <th rowspan="2">L</th>
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
