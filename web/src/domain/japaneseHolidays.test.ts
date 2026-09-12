import { describe, it, expect } from 'vitest';
import { computeJapaneseHolidays } from './japaneseHolidays';

function find(holidays: ReturnType<typeof computeJapaneseHolidays>, name: string) {
  return holidays.filter(h => h.name === name);
}

describe('computeJapaneseHolidays', () => {
  it('固定日の祝日が正しい日付になる', () => {
    const holidays = computeJapaneseHolidays(2026);
    expect(find(holidays, '元日')[0]?.date).toBe('2026-01-01');
    expect(find(holidays, '建国記念の日')[0]?.date).toBe('2026-02-11');
    expect(find(holidays, '天皇誕生日')[0]?.date).toBe('2026-02-23');
    expect(find(holidays, '昭和の日')[0]?.date).toBe('2026-04-29');
    expect(find(holidays, '憲法記念日')[0]?.date).toBe('2026-05-03');
    expect(find(holidays, 'みどりの日')[0]?.date).toBe('2026-05-04');
    expect(find(holidays, 'こどもの日')[0]?.date).toBe('2026-05-05');
    expect(find(holidays, '山の日')[0]?.date).toBe('2026-08-11');
    expect(find(holidays, '文化の日')[0]?.date).toBe('2026-11-03');
    expect(find(holidays, '勤労感謝の日')[0]?.date).toBe('2026-11-23');
  });

  it('2020年より前は天皇誕生日を含まない', () => {
    const holidays = computeJapaneseHolidays(2019);
    expect(find(holidays, '天皇誕生日').length).toBe(0);
  });

  it('ハッピーマンデーの祝日は必ず月曜日になる', () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const holidays = computeJapaneseHolidays(year);
      for (const name of ['成人の日', '海の日', '敬老の日', 'スポーツの日']) {
        const h = find(holidays, name)[0];
        expect(h, `${year}年 ${name}`).toBeDefined();
        const dow = new Date(h.date + 'T00:00:00').getDay();
        expect(dow, `${year}年 ${name} (${h.date}) は月曜日のはず`).toBe(1);
      }
    }
  });

  it('春分の日・秋分の日が妥当な範囲に収まる（3/19〜3/21、9/22〜9/24）', () => {
    for (const year of [2020, 2022, 2024, 2026, 2030]) {
      const holidays = computeJapaneseHolidays(year);
      const vernal = find(holidays, '春分の日')[0];
      const autumnal = find(holidays, '秋分の日')[0];
      const vernalDay = Number(vernal.date.split('-')[2]);
      const autumnalDay = Number(autumnal.date.split('-')[2]);
      expect(vernalDay, `${year}年春分の日`).toBeGreaterThanOrEqual(19);
      expect(vernalDay, `${year}年春分の日`).toBeLessThanOrEqual(21);
      expect(autumnalDay, `${year}年秋分の日`).toBeGreaterThanOrEqual(22);
      expect(autumnalDay, `${year}年秋分の日`).toBeLessThanOrEqual(24);
    }
  });

  it('日曜の祝日には振替休日が翌日以降の非祝日に設定される', () => {
    const holidays = computeJapaneseHolidays(2024);
    // 2024年は建国記念の日(2/11)・山の日(8/11)・文化の日(11/3)が日曜
    const dateSet = new Set(holidays.map(h => h.date));
    expect(dateSet.has('2024-02-12')).toBe(true);
    expect(dateSet.has('2024-08-12')).toBe(true);
    expect(dateSet.has('2024-11-04')).toBe(true);
    expect(find(holidays, '振替休日').length).toBeGreaterThanOrEqual(3);
  });

  it('重複する日付がない', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const holidays = computeJapaneseHolidays(year);
      const dates = holidays.map(h => h.date);
      expect(new Set(dates).size, `${year}年に重複あり: ${JSON.stringify(holidays)}`).toBe(dates.length);
    }
  });
});
