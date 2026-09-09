import Link from 'next/link';
import { getDailyCalendarData } from '@/server/actions/daily';
import { DUTY_LABELS } from '@/types';
import type { DutyType, Floor } from '@/types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const FLOORS: Floor[] = ['1F', '2F'];

export default async function DailyCalendarPage({ searchParams }: { searchParams: Promise<{ floor?: string; year?: string; month?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const year = params.year ? Number(params.year) : now.getFullYear();
  const month = params.month ? Number(params.month) : now.getMonth() + 1;
  const floorParam = params.floor ?? '1F';

  const { staff, shiftTypes, assignments, holidays } = await getDailyCalendarData(year, month);

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const holidaySet = new Set(holidays);
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const activeShiftTypes = [...shiftTypes].filter(st => !st.isAke).sort((a, b) => a.order - b.order);
  const monthAssignments = assignments.filter(a => a.date.startsWith(monthKey));

  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const navHref = (y: number, m: number) => `/daily?floor=${floorParam}&year=${y}&month=${m}`;

  return (
    <div className="space-y-2 max-w-2xl">
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold mb-2 w-fit">
        <Link href={navHref(prevMonth.y, prevMonth.m)} className="text-blue-500 hover:text-blue-700 px-1">&larr;</Link>
        <span>{year}年 {month}月</span>
        <Link href={navHref(nextMonth.y, nextMonth.m)} className="text-blue-500 hover:text-blue-700 px-1">&rarr;</Link>
      </div>

      {Array.from({ length: daysInMonth }, (_, i) => {
        const d = i + 1;
        const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dow = new Date(year, month - 1, d).getDay();
        const isHoliday = holidaySet.has(date);
        const isSun = dow === 0 || isHoliday;
        const isSat = dow === 6;
        const headerBg = isSun ? 'bg-red-50' : isSat ? 'bg-blue-50' : 'bg-slate-50';
        const headerColor = isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-slate-700';

        return (
          <div key={d} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className={`px-4 py-1.5 border-b border-slate-100 ${headerBg}`}>
              <span className={`text-[20px] font-bold ${headerColor}`}>{d}日（{DOW_LABELS[dow]}）{isHoliday ? ' 祝' : ''}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-200 min-h-[40px]">
              {FLOORS.map(floor => {
                const dayFloorAssigns = monthAssignments.filter(a => {
                  const s = staffMap.get(a.staffId);
                  return a.date === date && s?.floor === floor && a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid';
                });
                const presentShiftTypes = activeShiftTypes.filter(st => dayFloorAssigns.some(a => a.shiftTypeId === st.id));

                return (
                  <div key={floor} className="p-2">
                    <div className="text-base font-bold text-slate-400 mb-1">{floor}</div>
                    {presentShiftTypes.length === 0 ? (
                      <div className="text-base text-slate-300">−</div>
                    ) : (
                      <div className="space-y-1.5">
                        {presentShiftTypes.map(st => {
                          const assigns = dayFloorAssigns.filter(a => a.shiftTypeId === st.id);
                          return (
                            <div key={st.id} className="flex gap-2 items-start">
                              <span className="text-base font-bold px-1.5 py-0.5 rounded shrink-0 leading-tight" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                              <div className="space-y-0.5">
                                {assigns.map(a => {
                                  const s = staffMap.get(a.staffId);
                                  const dutyLabel = a.duty ? DUTY_LABELS[a.duty as DutyType] : '';
                                  return (
                                    <div key={a.staffId} className="flex items-center gap-1.5 text-lg">
                                      <span className="font-medium text-slate-800">{s?.name ?? '?'}</span>
                                      {dutyLabel && <span className="text-slate-400 text-base">{dutyLabel}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
