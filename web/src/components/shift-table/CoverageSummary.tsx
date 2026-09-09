import type { ShiftTableData } from '@/server/actions/schedule';
import { computeDayCoverage } from './coverage';

interface Props {
  year: number;
  month: number;
  data1F: ShiftTableData;
  data2F: ShiftTableData;
}

function statusStyle(shortage: number) {
  if (shortage === 0) return { bg: '#f0fdf4', color: '#16a34a' };
  if (shortage <= 2) return { bg: '#fef3c7', color: '#b45309' };
  return { bg: '#fee2e2', color: '#dc2626' };
}

/** 1F/2Fの日別充足状況を並べたサマリー。詳細な個人シフトを見る前に「どちらが不足しているか」を一目で把握する */
export default function CoverageSummary({ year, month, data1F, data2F }: Props) {
  const cov1F = computeDayCoverage(data1F, year, month);
  const cov2F = computeDayCoverage(data2F, year, month);

  const rows: { label: string; cov: ReturnType<typeof computeDayCoverage> }[] = [
    { label: '1F', cov: cov1F },
    { label: '2F', cov: cov2F },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-700">充足状況サマリー</h3>
        <span className="text-[11px] text-slate-400">緑=充足 ・ 黄=軽微な不足 ・ 赤=不足あり（クリックせず一目で比較用）</span>
      </div>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="flex">
            <div className="w-10 shrink-0" />
            {cov1F.map(c => (
              <div key={c.d} className={`w-6 shrink-0 text-center text-[10px] font-semibold ${c.dow === 0 || c.isHoliday ? 'text-red-500' : c.dow === 6 ? 'text-blue-500' : 'text-slate-400'}`}>{c.d}</div>
            ))}
          </div>
          {rows.map(row => (
            <div key={row.label} className="flex items-center gap-0 mb-1">
              <div className="w-10 shrink-0 text-xs font-bold text-slate-600">{row.label}</div>
              {row.cov.map(c => {
                const s = statusStyle(c.shortage);
                return (
                  <div
                    key={c.d}
                    className="w-6 h-6 shrink-0 flex items-center justify-center text-[9px] font-bold rounded-sm mx-px"
                    style={{ background: s.bg, color: s.color }}
                    title={`${row.label} ${month}/${c.d}: ${c.shortage === 0 ? '充足' : `${c.shortage}人不足`}`}
                  >
                    {c.shortage > 0 ? c.shortage : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
