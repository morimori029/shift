import Link from 'next/link';
import { getDailyCalendarData } from '@/server/actions/daily';
import { DUTY_LABELS } from '@/types';
import type { DutyType, Floor } from '@/types';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const FLOORS: Floor[] = ['1F', '2F'];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toDateStr(dt);
}

/** 当日ダッシュボード — 誰でも見られる公開ページ（ログイン不要）。今日を起点に前後の日付にも移動できる */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = toDateStr(new Date());
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const [year, month, day] = date.split('-').map(Number);

  const { staff, shiftTypes, assignments, holidays } = await getDailyCalendarData(year, month);

  const holidaySet = new Set(holidays);
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const activeShiftTypes = [...shiftTypes].filter(st => !st.isAke).sort((a, b) => a.order - b.order);

  const dow = new Date(year, month - 1, day).getDay();
  const isHoliday = holidaySet.has(date);
  const isSun = dow === 0 || isHoliday;
  const isSat = dow === 6;
  const headerColor = isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-slate-800';

  const dayAssignments = assignments.filter(a => a.date === date);

  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const navHref = (d: string) => `/dashboard?date=${d}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-700">当日ダッシュボード</h1>
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <Link href={navHref(prevDate)} className="text-blue-500 hover:text-blue-700 text-xl px-2">&larr;</Link>
            <span className={`text-2xl font-bold ${headerColor}`}>
              {year}年{month}月{day}日（{DOW_LABELS[dow]}）{isHoliday ? ' 祝' : ''}
            </span>
            <Link href={navHref(nextDate)} className="text-blue-500 hover:text-blue-700 text-xl px-2">&rarr;</Link>
            {date !== today && (
              <Link href={navHref(today)} className="ml-2 text-xs font-semibold text-white bg-slate-500 hover:bg-slate-600 rounded-lg px-3 py-1.5">今日</Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {FLOORS.map(floor => {
            const dayFloorAssigns = dayAssignments.filter(a => {
              const s = staffMap.get(a.staffId);
              return s?.floor === floor && a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid';
            });
            const presentShiftTypes = activeShiftTypes.filter(st => dayFloorAssigns.some(a => a.shiftTypeId === st.id));

            return (
              <div key={floor} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="text-2xl font-bold text-slate-500 mb-4">{floor}</div>
                {presentShiftTypes.length === 0 ? (
                  <div className="text-lg text-slate-300">出勤者なし</div>
                ) : (
                  <div className="space-y-4">
                    {presentShiftTypes.map(st => {
                      const assigns = dayFloorAssigns.filter(a => a.shiftTypeId === st.id);
                      return (
                        <div key={st.id} className="flex gap-3 items-start">
                          <span
                            className="text-lg font-bold px-3 py-1 rounded-lg shrink-0"
                            style={{ background: st.bgColor, color: st.color }}
                          >
                            {st.shortName}
                          </span>
                          <div className="space-y-1 pt-0.5">
                            {assigns.map(a => {
                              const s = staffMap.get(a.staffId);
                              const dutyLabel = a.duty ? DUTY_LABELS[a.duty as DutyType] : '';
                              return (
                                <div key={a.staffId} className="flex items-center gap-2 text-2xl">
                                  <span className="font-semibold text-slate-800">{s?.name ?? '?'}</span>
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
    </div>
  );
}
