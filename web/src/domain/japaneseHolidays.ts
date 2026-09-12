/**
 * 日本の祝日を計算で求める（内閣府の祝日法に基づくルール実装）。
 * - 固定日の祝日
 * - ハッピーマンデー（第n月曜日）の祝日
 * - 春分の日・秋分の日（1980〜2099年で有効な近似式）
 * - 振替休日（日曜が祝日の場合、直後の祝日でない日を休日にする）
 * - 国民の休日（祝日と祝日に挟まれた平日を休日にする）
 *
 * 天皇誕生日は2020年（令和2年）2月23日以降の運用のみ対応。
 */

export interface JapaneseHoliday {
  date: string; // 'YYYY-MM-DD'
  name: string;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** その月の第n <weekday>曜日（weekday: 0=日〜6=土）の「日」を返す */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 春分の日（1980〜2099年で有効な近似式） */
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

/** 秋分の日（1980〜2099年で有効な近似式） */
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

export function computeJapaneseHolidays(year: number): JapaneseHoliday[] {
  const list: { date: Date; name: string }[] = [];
  const add = (month: number, day: number, name: string) => list.push({ date: new Date(year, month - 1, day), name });

  add(1, 1, '元日');
  add(1, nthWeekdayOfMonth(year, 1, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  add(3, vernalEquinoxDay(year), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthWeekdayOfMonth(year, 7, 1, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthWeekdayOfMonth(year, 9, 1, 3), '敬老の日');
  add(9, autumnalEquinoxDay(year), '秋分の日');
  add(10, nthWeekdayOfMonth(year, 10, 1, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  list.sort((a, b) => a.date.getTime() - b.date.getTime());

  // 国民の休日: 祝日と祝日に挟まれた（間が1日だけの）平日で、日曜でも既存の祝日でもない日
  const dateKeys = new Set(list.map(x => x.date.toDateString()));
  const nationalHolidays: { date: Date; name: string }[] = [];
  for (let i = 0; i < list.length - 1; i++) {
    const diffDays = Math.round((list[i + 1].date.getTime() - list[i].date.getTime()) / 86400000);
    if (diffDays === 2) {
      const between = new Date(list[i].date);
      between.setDate(between.getDate() + 1);
      if (between.getDay() !== 0 && !dateKeys.has(between.toDateString())) {
        nationalHolidays.push({ date: between, name: '国民の休日' });
        dateKeys.add(between.toDateString());
      }
    }
  }
  list.push(...nationalHolidays);
  list.sort((a, b) => a.date.getTime() - b.date.getTime());

  // 振替休日: 日曜の祝日の直後で、まだ祝日でない最初の日
  const finalKeys = new Set(list.map(x => x.date.toDateString()));
  const substitutes: { date: Date; name: string }[] = [];
  for (const h of [...list]) {
    if (h.date.getDay() === 0) {
      const next = new Date(h.date);
      do {
        next.setDate(next.getDate() + 1);
      } while (finalKeys.has(next.toDateString()));
      substitutes.push({ date: new Date(next), name: '振替休日' });
      finalKeys.add(next.toDateString());
    }
  }
  list.push(...substitutes);
  list.sort((a, b) => a.date.getTime() - b.date.getTime());

  return list.map(x => ({ date: formatDate(x.date), name: x.name }));
}
