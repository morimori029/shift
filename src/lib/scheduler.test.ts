import { describe, it, expect } from 'vitest';
import { generateShift } from './scheduler';
import type { Staff, ShiftType, FloorConfig, PairSetting, ShiftAssignment } from '../types';

// ─── テスト用ヘルパー ───────────────────────────────────────────────────────

const SHIFT_TYPES: ShiftType[] = [
    { id: 'early', name: '早番', shortName: 'L', startTime: '08:00', endTime: '16:30', color: '#1d4ed8', bgColor: '#dbeafe', isDayShift: true, isNightShift: false, isAke: false, order: 1 },
    { id: 'day', name: '日勤', shortName: 'B', startTime: '08:30', endTime: '17:00', color: '#15803d', bgColor: '#dcfce7', isDayShift: true, isNightShift: false, isAke: false, order: 2 },
    { id: 'late', name: '遅番', shortName: 'U', startTime: '10:30', endTime: '19:00', color: '#c2410c', bgColor: '#ffedd5', isDayShift: true, isNightShift: false, isAke: false, order: 3 },
    { id: 'night', name: '夜勤', shortName: '〇', startTime: '16:30', endTime: '09:00', color: '#7e22ce', bgColor: '#f3e8ff', isDayShift: false, isNightShift: true, isAke: false, order: 4 },
    { id: 'ake', name: '明け', shortName: '×', startTime: '', endTime: '', color: '#6b7280', bgColor: '#f1f5f9', isDayShift: false, isNightShift: false, isAke: true, order: 5 },
    { id: 'training', name: '研修', shortName: '研', startTime: '09:00', endTime: '17:00', color: '#0e7490', bgColor: '#cffafe', isDayShift: false, isNightShift: false, isAke: false, order: 6 },
];

const BASE_CONFIG: FloorConfig = {
    floor: '1F',
    shiftRequirements: {
        early: [0, 0, 0, 0, 0, 0, 0],
        day: [2, 2, 2, 2, 2, 2, 2],
        late: [1, 1, 1, 1, 1, 1, 1],
        night: [2, 2, 2, 2, 2, 2, 2],
    },
    shiftRequirementsEnabled: { early: true, day: true, late: true, night: true },
    dutyRequirements: { ld: [0, 0, 0, 0, 0, 0, 0], bathing: [0, 0, 0, 0, 0, 0, 0], floor: [0, 0, 0, 0, 0, 0, 0], toilet: [0, 0, 0, 0, 0, 0, 0] },
    leaderCountPerDay: 0,
    maxConsecutiveDays: 5,
    monthlyOffDays: 9,
};

function makeStaff(id: string, overrides: Partial<Staff> = {}): Staff {
    return {
        id,
        name: id,
        floor: '1F',
        role: '正社員',
        availableShiftTypes: ['early', 'day', 'late', 'night'],
        availableDuties: ['floor', 'toilet'],
        unavailableDow: [],
        memo: '',
        ...overrides,
    };
}

function runScheduler(staff: Staff[], config: FloorConfig = BASE_CONFIG, pairs: PairSetting[] = [], prefilled: ShiftAssignment[] = []) {
    return generateShift({
        year: 2026, month: 3, floor: '1F',
        staff, shiftTypes: SHIFT_TYPES, config, pairs,
        prefilled,
    });
}

// ─── テストケース ───────────────────────────────────────────────────────────

describe('scheduler - ハード制約', () => {

    it('夜勤の翌日は必ず明けになる (Phase 0)', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const result = runScheduler(staff);

        for (const a of result) {
            if (a.shiftTypeId === 'night') {
                const nightDate = new Date(a.date);
                nightDate.setDate(nightDate.getDate() + 1);
                const nextDateStr = nightDate.toISOString().slice(0, 10);
                const nextA = result.find(x => x.staffId === a.staffId && x.date === nextDateStr);
                if (nextA) {
                    expect(nextA.shiftTypeId, `${a.staffId} の ${a.date} 夜勤翌日 (${nextDateStr}) は明けであるべき`).toBe('ake');
                }
            }
        }
    });

    it('NGペアが同じ夜勤に入らない', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const pairs: PairSetting[] = [
            { id: 'p1', staffId1: 'A', staffId2: 'B', type: 'ng', memo: '' },
        ];
        const result = runScheduler(staff, BASE_CONFIG, pairs);

        for (let d = 1; d <= 31; d++) {
            const date = `2026-03-${String(d).padStart(2, '0')}`;
            const nightWorkers = result
                .filter(a => a.date === date && a.shiftTypeId === 'night')
                .map(a => a.staffId);
            const hasA = nightWorkers.includes('A');
            const hasB = nightWorkers.includes('B');
            expect(hasA && hasB, `${date}: NGペア A と B が同日夜勤に入っている`).toBe(false);
        }
    });

    it('連勤上限（maxConsecutiveDays）を超えない', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const config: FloorConfig = { ...BASE_CONFIG, maxConsecutiveDays: 3 };
        const result = runScheduler(staff, config);

        for (const s of staff) {
            // スケジューラーは「夜勤入り前」に連勤をチェックするため、
            // ake（明け）は強制割当なのでカウントから除外して検証する
            let consecutive = 0;
            for (let d = 1; d <= 31; d++) {
                const date = `2026-03-${String(d).padStart(2, '0')}`;
                const a = result.find(x => x.staffId === s.id && x.date === date);
                const isOff = !a || a.shiftTypeId === 'off' || a.shiftTypeId === 'paid';
                const isAke = a?.shiftTypeId === 'ake';
                if (isOff) {
                    consecutive = 0;
                } else if (!isAke) {
                    // 明け以外の勤務のみカウント
                    consecutive++;
                    expect(consecutive, `${s.id}: ${date} 時点で（明け除く）連勤 ${consecutive} 日、上限 ${config.maxConsecutiveDays} 日を超えている`).toBeLessThanOrEqual(config.maxConsecutiveDays);
                }
                // akeはリセットせずスキップ（夜勤が連続しない仕様）
            }
        }
    });

    it('明けの翌日は夜勤か休みのみ', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const result = runScheduler(staff);

        for (const a of result) {
            if (a.shiftTypeId === 'ake') {
                const akeDate = new Date(a.date);
                akeDate.setDate(akeDate.getDate() + 1);
                const nextDateStr = akeDate.toISOString().slice(0, 10);
                const nextA = result.find(x => x.staffId === a.staffId && x.date === nextDateStr);
                if (nextA) {
                    const allowed = nextA.shiftTypeId === 'off' || nextA.shiftTypeId === 'night' || nextA.shiftTypeId === 'paid';
                    expect(allowed, `${a.staffId}: 明け(${a.date})翌日(${nextDateStr})が ${nextA.shiftTypeId} になっている`).toBe(true);
                }
            }
        }
    });

});

describe('scheduler - 夜勤ペア選出ロジック (#14)', () => {

    it('推奨ペアは同じ夜勤に組まれやすい（推奨ペアが一緒になった日が少なくとも1日ある）', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const pairs: PairSetting[] = [
            { id: 'p1', staffId1: 'A', staffId2: 'B', type: 'preferred', memo: '' },
        ];
        const result = runScheduler(staff, BASE_CONFIG, pairs);

        let togetherCount = 0;
        for (let d = 1; d <= 31; d++) {
            const date = `2026-03-${String(d).padStart(2, '0')}`;
            const nightWorkers = result
                .filter(a => a.date === date && a.shiftTypeId === 'night')
                .map(a => a.staffId);
            if (nightWorkers.includes('A') && nightWorkers.includes('B')) {
                togetherCount++;
            }
        }
        // 推奨ペアなので少なくとも1日以上は一緒になるはず
        expect(togetherCount, `推奨ペア A-B が一度も同じ夜勤に入っていない`).toBeGreaterThan(0);
    });

    it('NG ペアは同一夜勤に入らない（全日チェック）', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
        ];
        const pairs: PairSetting[] = [
            { id: 'p1', staffId1: 'A', staffId2: 'B', type: 'ng', memo: '' },
            { id: 'p2', staffId1: 'C', staffId2: 'D', type: 'ng', memo: '' },
        ];
        const result = runScheduler(staff, BASE_CONFIG, pairs);

        for (let d = 1; d <= 31; d++) {
            const date = `2026-03-${String(d).padStart(2, '0')}`;
            const nightWorkers = result
                .filter(a => a.date === date && a.shiftTypeId === 'night')
                .map(a => a.staffId);
            expect(nightWorkers.includes('A') && nightWorkers.includes('B'), `${date}: NG ペア A-B が同日夜勤`).toBe(false);
            expect(nightWorkers.includes('C') && nightWorkers.includes('D'), `${date}: NG ペア C-D が同日夜勤`).toBe(false);
        }
    });

    it('夜勤専従スタッフが月最低回数に達する', () => {
        const nightOnlyMin = 5;
        const staff = [
            makeStaff('NIGHT1', { isNightOnly: true, nightShiftMin: nightOnlyMin, nightShiftMax: 12, availableShiftTypes: ['night'] }),
            makeStaff('NIGHT2', { isNightOnly: true, nightShiftMin: nightOnlyMin, nightShiftMax: 12, availableShiftTypes: ['night'] }),
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
        ];
        const result = runScheduler(staff);

        const night1Count = result.filter(a => a.staffId === 'NIGHT1' && a.shiftTypeId === 'night').length;
        const night2Count = result.filter(a => a.staffId === 'NIGHT2' && a.shiftTypeId === 'night').length;
        expect(night1Count, `夜勤専従 NIGHT1 の夜勤回数 ${night1Count} が最低回数 ${nightOnlyMin} を下回っている`).toBeGreaterThanOrEqual(nightOnlyMin);
        expect(night2Count, `夜勤専従 NIGHT2 の夜勤回数 ${night2Count} が最低回数 ${nightOnlyMin} を下回っている`).toBeGreaterThanOrEqual(nightOnlyMin);
    });

});


describe('scheduler - ソフト制約', () => {

    it('公休日数が概ね monthlyOffDays に近い値になる（±3日以内）', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
            makeStaff('F'),
        ];
        const result = runScheduler(staff);
        const targetOff = BASE_CONFIG.monthlyOffDays;

        for (const s of staff) {
            const offCount = result.filter(a =>
                a.staffId === s.id && (a.shiftTypeId === 'off' || a.shiftTypeId === 'paid')
            ).length;
            expect(Math.abs(offCount - targetOff), `${s.id}: 公休 ${offCount}日（目標 ${targetOff}日）、差が3日を超えている`).toBeLessThanOrEqual(3);
        }
    });

    it('夜勤回数が均等に分散される（最大-最小が3回以内）', () => {
        const staff = [
            makeStaff('A'),
            makeStaff('B'),
            makeStaff('C'),
            makeStaff('D'),
            makeStaff('E'),
            makeStaff('F'),
        ];
        const result = runScheduler(staff);

        const nightCounts = staff.map(s => ({
            id: s.id,
            count: result.filter(a => a.staffId === s.id && a.shiftTypeId === 'night').length,
        }));
        const counts = nightCounts.map(x => x.count);
        const diff = Math.max(...counts) - Math.min(...counts);
        expect(diff, `夜勤回数の最大-最小が ${diff} 回（3回以内が期待値）\n${JSON.stringify(nightCounts)}`).toBeLessThanOrEqual(3);
    });

});
