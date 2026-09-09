import type { Staff, ShiftType, FloorConfig, PairSetting, TagPairSetting, ShiftAssignment, Floor, DutyType } from '../types';
import { ALL_DUTIES } from '../types';

type AutoDutyType = Exclude<DutyType, 'onef'>;

/**
 * ===============================================================
 * scheduler.ts — シフト自動作成エンジン
 * ===============================================================
 *
 * 「誰に、いつ、何のシフトを割り当てるか」を自動で決めるプログラムです。
 *
 * 処理の流れ（1日ずつ繰り返す）:
 *  Phase 0   : 前日が夜勤のスタッフは必ず「明け」にする
 *  Phase 0.5 : 手で入力済みのシフトをそのまま使う
 *  Phase 1   : 出勤できない曜日のスタッフを休みにする
 *  Phase 2   : 夜勤に入るスタッフを決める
 *  Phase 3   : 日勤・早番・遅番を必要人数分配置する
 *  Phase 4   : リーダーを決める
 *  Phase 5   : まだ割り当てられていないスタッフに休み or 出勤を割り当てる
 *  Phase 6   : 日勤スタッフに「LD・入浴・排泄・フロア」などの業務を振り分ける
 */

/**
 * generateShift に渡す「設定のまとめ」。
 * この情報をもとにシフトを作ります。
 */
export interface Context {
  year: number;                          // 対象年
  month: number;                         // 対象月
  floor: Floor;                          // 対象フロア（1F or 2F）
  staff: Staff[];                        // スタッフリスト
  shiftTypes: ShiftType[];              // シフト種別リスト（日勤・夜勤など）
  config: FloorConfig;                   // フロアごとのルール（連勤上限・公休数など）
  pairs: PairSetting[];                 // 夜勤ペアの相性設定（NGペア・推奨ペア）
  holidays?: string[];                   // 祝日リスト（'YYYY-MM-DD'形式。祝日は曜日=0に日曜扱いする）
  prevMonthAssignments?: ShiftAssignment[]; // 前月のシフト（月末連勤を引き継ぐために使用）
  prefilled?: ShiftAssignment[];         // 手動で入力済みのシフト（自動生成でも消さない）
  seed?: number;                         // 乱数シード（複数パターン生成用）
}

/** 年・月・日を「2026-02-25」のような文字列に変換するヘルパー */
function dateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 年・月・日から曜日（0=日曜〜6=土曜）を取得するヘルパー */
function getDow(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

/** 業務を割り当てる対象シフト（早番・日勤のみ対象） */
const DUTY_ELIGIBLE_SHIFTS = new Set(['early', 'day']);

// 午前休・午後休・短時間は「必要勤務日数」のカウントに含めない
// （半日しか働かない扱いなのでフルカウントしない）
const PARTIAL_SHIFT_IDS = new Set(['half_am', 'half_pm', 'short']);

/** シンプルなシード付き疑似乱数生成器 (mulberry32) */
function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * タグ単位の相性設定を、該当する全スタッフの組み合わせに展開して
 * 個別ペア（PairSetting）の配列に変換する。
 * 同一タグ内のスタッフ同士（同じタグが両方に指定された場合）も展開対象に含む。
 */
export function expandTagPairs(tagPairs: TagPairSetting[], staff: Staff[]): PairSetting[] {
  const expanded: PairSetting[] = [];
  for (const tp of tagPairs) {
    const group1 = staff.filter(s => s.tags.includes(tp.tagId1));
    const group2 = staff.filter(s => s.tags.includes(tp.tagId2));
    for (const s1 of group1) {
      for (const s2 of group2) {
        if (s1.id === s2.id) continue;
        expanded.push({
          id: `tagpair-${tp.id}-${s1.id}-${s2.id}`,
          staffId1: s1.id,
          staffId2: s2.id,
          type: tp.type,
          scope: tp.scope,
          memo: tp.memo,
        });
      }
    }
  }
  return expanded;
}

export function generateShift(ctx: Context): ShiftAssignment[] {
  const { year, month, floor, staff, shiftTypes, config, pairs, holidays, prevMonthAssignments, prefilled, seed } = ctx;
  const rng = createRng(seed ?? 0);
  // 祝日セット（高速检索用）
  const holidaySet = new Set(holidays ?? []);

  /**
   * 実効曜日を返すヘルパー。
   * 祝日専用設定が有効な場合は -1（祝日フラグ）を返し、getEffectiveReqで専用値を使う。
   * 祝日専用設定が無効な場合は従来どおり 0（日曜扱い）を返す。
   */
  const getEffectiveDow = (date: string, dow: number): number => {
    if (!holidaySet.has(date)) return dow;
    // 祝日専用設定が有効なら -1（専用フラグ）、無効なら 0（日曜流用）
    return config.useHolidayRequirements ? -1 : dow;
  };

  /**
   * 平常の effectiveDow で shiftRequirements を引き、
   * そのシフトが「無効（shiftRequirementsEnabled[id] === false）」なら 0 を返す。
   * effectiveDow が -1（祝日専用モード）なら holidayShiftRequirements を参照する。
   */
  const getEffectiveReq = (shiftId: string, effectiveDow: number): number => {
    if (config.shiftRequirementsEnabled?.[shiftId] === false) return 0;
    if (effectiveDow === -1) {
      // 祝日専用必要人数（設定がなければ日曜=0 の値で代用）
      const holidayReq = config.holidayShiftRequirements?.[shiftId];
      if (holidayReq !== undefined) return holidayReq;
      const arr = config.shiftRequirements[shiftId];
      return arr ? arr[0] ?? 0 : 0; // フォールバック: 日曜の値
    }
    const arr = config.shiftRequirements[shiftId];
    return arr ? arr[effectiveDow] ?? 0 : 0;
  };

  // その月が何日あるか（28〜31日）
  const daysInMonth = new Date(year, month, 0).getDate();

  // シフト種別の中から「夜勤」「明け」「日勤帯シフト」を取り出しておく
  const nightType = shiftTypes.find(st => st.isNightShift);
  const akeType = shiftTypes.find(st => st.isAke);
  const dayShiftTypes = shiftTypes.filter(st => st.isDayShift).sort((a, b) => a.order - b.order);

  if (staff.length === 0) return []; // スタッフが0人なら何もしない

  // 人数カウント除外スタッフのIDセット（出勤しても必要人数にカウントしない）
  const excludedIds = new Set(staff.filter(s => s.excludeFromCount).map(s => s.id));

  // ================================================================
  // 【非常勤専用】軽量スケジューラー
  // 非常勤フロアはシフト必要人数の制約がないため、
  // 個々のスタッフの monthlyWorkDays をもとに出勤日を均等配置する。
  // ================================================================
  if (floor === '非常勤') {
    const result: ShiftAssignment[] = [];
    // 手動入力済みは保護
    const prefilledMap = new Map<string, ShiftAssignment>();
    (prefilled ?? []).forEach(a => prefilledMap.set(`${a.staffId}:${a.date}`, a));

    for (const s of staff) {
      // ① 各日の「出勤可否」フラグを計算（出勤不可曜日を除く）
      const availableDays: number[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = getDow(year, month, d);
        // 手動入力済みは除外
        const date = dateStr(year, month, d);
        if (prefilledMap.has(`${s.id}:${date}`)) continue;
        if (s.unavailableDow.includes(dow)) continue; // 出勤不可曜日はスキップ
        availableDays.push(d);
      }

      // ② 出勤日の選定（monthlyWorkDays が設定されている場合）
      const workDays = new Set<number>();
      if (s.monthlyWorkDays && s.monthlyWorkDays > 0) {
        const target = Math.min(s.monthlyWorkDays, availableDays.length);
        // 均等に散らすため、等間隔でピックアップ
        for (let i = 0; i < target; i++) {
          const idx = Math.round((i / target) * availableDays.length);
          workDays.add(availableDays[Math.min(idx, availableDays.length - 1)]);
        }
        // 数が合わない場合の補正（重複除去の余剰を補う）
        let avIdx = 0;
        while (workDays.size < target && avIdx < availableDays.length) {
          workDays.add(availableDays[avIdx++]);
        }
      }

      // ③ シフト種別の選択（利用可能な日勤系シフトの先頭 or フォールバック）
      const primaryShift =
        dayShiftTypes.find(st => s.availableShiftTypes.includes(st.id)) ??
        shiftTypes.find(st => s.availableShiftTypes.includes(st.id));

      // ④ 各日に割り当てる
      for (let d = 1; d <= daysInMonth; d++) {
        const date = dateStr(year, month, d);
        if (prefilledMap.has(`${s.id}:${date}`)) {
          // 手動入力済みはそのまま引き継ぐ
          result.push(prefilledMap.get(`${s.id}:${date}`)!);
          continue;
        }

        const dow = getDow(year, month, d);
        if (s.unavailableDow.includes(dow)) {
          // 出勤不可曜日 → 休み
          result.push({ staffId: s.id, date, shiftTypeId: 'off', isLeader: false, isManual: false });
        } else if (s.monthlyWorkDays !== undefined && s.monthlyWorkDays > 0) {
          // monthlyWorkDays 設定あり → 出勤日は出勤、それ以外は休み
          const shiftId = workDays.has(d) && primaryShift ? primaryShift.id : 'off';
          result.push({ staffId: s.id, date, shiftTypeId: shiftId, isLeader: false, isManual: false });
        }
        // monthlyWorkDays 未設定 → 空欄のまま（何も push しない）
      }
    }
    return result;
  }

  // ================================================================
  // 以下、1F・2F 向けの通常スケジューラー（変更なし）
  // ================================================================

  // ---- カウンター類の準備 ----
  const assignments: ShiftAssignment[] = [];               // 作成したシフトの一覧
  const staffNightCount: Record<string, number> = {};      // 各スタッフの今月の夜勤回数
  const staffWorkDays: Record<string, number> = {};        // 各スタッフの今月の出勤日数
  const staffOffDays: Record<string, number> = {};         // 各スタッフの今月の公休日数
  const staffLeaderCount: Record<string, number> = {};     // 各スタッフの今月のリーダー回数
  const staffConsecutive: Record<string, number> = {};     // 現在の連続出勤日数

  // 手動入力済みシフトを staffId:日付 をキーとしたマップに変換（高速検索のため）
  const prefilledMap = new Map<string, ShiftAssignment>();
  if (prefilled) {
    for (const a of prefilled) {
      prefilledMap.set(`${a.staffId}:${a.date}`, a);
    }
  }

  const isPrefilled = (staffId: string, date: string) => prefilledMap.has(`${staffId}:${date}`);
  const getPrefilled = (staffId: string, date: string) => prefilledMap.get(`${staffId}:${date}`);

  // 全スタッフのカウンターを 0 に初期化
  staff.forEach(s => {
    staffNightCount[s.id] = 0;
    staffWorkDays[s.id] = 0;
    staffOffDays[s.id] = 0;
    staffLeaderCount[s.id] = 0;
    staffConsecutive[s.id] = 0;
  });

  // 前月末の連続勤務日数を staffConsecutive の初期値として引き継ぐ
  if (prevMonthAssignments && prevMonthAssignments.length > 0) {
    const py = month === 1 ? year - 1 : year;
    const pm = month === 1 ? 12 : month - 1;
    const prevDaysInMonth = new Date(py, pm, 0).getDate();

    staff.forEach(s => {
      let consecutive = 0;
      // 前月の末日から逆順にスキャンして連続勤務日数を数える
      for (let d = prevDaysInMonth; d >= 1; d--) {
        const ds = dateStr(py, pm, d);
        const a = prevMonthAssignments.find(x => x.staffId === s.id && x.date === ds);
        if (!a) break; // 記録なし = 休み扱い（連続途切れ）
        const isOff = a.shiftTypeId === 'off' || a.shiftTypeId === 'paid';
        if (isOff) break; // 休み・有給で連続途切れ
        consecutive++;
      }
      staffConsecutive[s.id] = consecutive;
    });
  }

  /** 前月最終日の日付文字列（例: 「2026-01-31」）を計算する */
  const prevLastDate = (() => {
    const py = month === 1 ? year - 1 : year;
    const pm = month === 1 ? 12 : month - 1;
    const pd = new Date(py, pm, 0).getDate();
    return dateStr(py, pm, pd);
  })();

  /** 前月最終日の特定スタッフのシフトを取得する */
  const getPrevMonthAssignment = (staffId: string) =>
    prevMonthAssignments?.find(a => a.staffId === staffId && a.date === prevLastDate);

  /** 今月の中で、すでに確定済みのシフトを取得する */
  const getAssignment = (staffId: string, date: string) =>
    assignments.find(a => a.staffId === staffId && a.date === date);

  /** その週の出勤済み日数を数える（週あたり出勤上限チェックに使用） */
  const getWeekWorkDays = (staffId: string, day: number): number => {
    const d = new Date(year, month - 1, day);
    const dow = d.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow; // 月曜日を週の始まりとする
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const wd = day + mondayOffset + i;
      if (wd < 1 || wd > daysInMonth || wd === day) continue;
      const wDate = dateStr(year, month, wd);
      const a = assignments.find(x => x.staffId === staffId && x.date === wDate);
      if (a && a.shiftTypeId !== 'off' && a.shiftTypeId !== 'paid') count++;
    }
    return count;
  };

  /** 週出勤上限を超えているかチェックする（超えていたら true）*/
  const hitWeeklyLimit = (s: Staff, day: number): boolean => {
    if (!s.weeklyWorkDays) return false;
    return getWeekWorkDays(s.id, day) >= s.weeklyWorkDays;
  };

  /** 連続夜勤は最大2回（夜勤→明け→夜勤→明けで上限）*/
  const MAX_CONSECUTIVE_NIGHTS = 2;

  /**
   * 連続夜勤数を数える（直近で何回連続して夜勤に入ったか）
   * パターン: ○ × ○ × [今日] → 夜勤＋明けのペアを1ブロックとしてカウント
   */
  const getConsecutiveNights = (staffId: string, day: number): number => {
    let count = 0;
    let d = day - 1;
    while (d >= 1) {
      const date1 = dateStr(year, month, d);
      const a1 = getAssignment(staffId, date1);
      if (a1 && akeType && a1.shiftTypeId === akeType.id) {
        d--;
        if (d >= 1) {
          const date2 = dateStr(year, month, d);
          const a2 = getAssignment(staffId, date2);
          if (a2 && nightType && a2.shiftTypeId === nightType.id) {
            count++;
            d--;
            continue;
          }
        }
        break;
      } else if (a1 && nightType && a1.shiftTypeId === nightType.id) {
        count++;
        d--;
        continue;
      } else {
        break;
      }
    }
    // Also check previous month last days if at month start
    if (d < 1 && prevMonthAssignments && count > 0) {
      const prevA = getPrevMonthAssignment(staffId);
      if (prevA && nightType && prevA.shiftTypeId === nightType.id) count++;
    }
    return count;
  };

  const getRequest = (_staffId: string, _date: string) => undefined;

  /** ある日付に割り当て済みのシフト一覧を返す */
  const getDayAssignments = (date: string) =>
    assignments.filter(a => a.date === date);

  /** 新しいシフトを assignments リストに追加する */
  const assign = (staffId: string, date: string, shiftTypeId: string, isLeader = false) => {
    assignments.push({ staffId, date, shiftTypeId, isLeader });
  };

  // ====================================================================
  // 日ごとの必要人数合計を事前計算（少ない日を優先的に休み割当に使う）
  // ====================================================================
  const dayTotalReq: number[] = new Array(daysInMonth + 1).fill(0);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = dateStr(year, month, d);
    const dw = getDow(year, month, d);
    const edw = getEffectiveDow(dt, dw);
    let total = 0;
    for (const st of dayShiftTypes) {
      total += getEffectiveReq(st.id, edw);
    }
    if (nightType) total += getEffectiveReq(nightType.id, edw);
    dayTotalReq[d] = total;
  }

  // ====================================================================
  // メインループ: 1日ずつ全スタッフのシフトを埋めていく
  // ====================================================================
  for (let day = 1; day <= daysInMonth; day++) {
    const date = dateStr(year, month, day);
    const prevDate = day > 1 ? dateStr(year, month, day - 1) : null; // 前日の日付
    const dow = getDow(year, month, day);           // 今日の曜日（0=日〜6=土）
    const effectiveDow = getEffectiveDow(date, dow); // 祝日なら 0（日曜扯い）
    const assigned = new Set<string>();       // 今日すでにシフトが決まったスタッフID
    const postAkeStaff = new Set<string>();  // 今日「明け後」のスタッフ（次は夜勤か休みのみ）

    // ----------------------------------------------------------------
    // Phase 0: ハード制約 — 前日が夜勤なら今日は必ず「明け」
    // 手動入力より優先されるルールです
    // ----------------------------------------------------------------
    staff.forEach(s => {
      if (akeType && nightType) {
        const prevA = prevDate ? getAssignment(s.id, prevDate) : getPrevMonthAssignment(s.id);
        if (prevA && prevA.shiftTypeId === nightType.id) {
          assign(s.id, date, akeType.id);
          assigned.add(s.id);
          staffWorkDays[s.id]++;
          staffConsecutive[s.id]++;
          return;
        }
      }
      if (akeType) {
        const prevA = prevDate ? getAssignment(s.id, prevDate) : getPrevMonthAssignment(s.id);
        if (prevA && prevA.shiftTypeId === akeType.id) {
          postAkeStaff.add(s.id);
        }
      }
    });

    // ----------------------------------------------------------------
    // Phase 0.5: 手動入力済みのシフトをそのまま使う
    // 「明け後」のスタッフに夜勤以外の手動入力があったら無視（後で Phase 5 に委ねる）
    // ----------------------------------------------------------------
    staff.forEach(s => {
      if (assigned.has(s.id)) return;
      const pf = getPrefilled(s.id, date);
      if (pf) {
        // Post-ake staff: only night or off allowed
        if (postAkeStaff.has(s.id)) {
          const stObj = shiftTypes.find(st => st.id === pf.shiftTypeId);
          if (pf.shiftTypeId !== 'off' && !stObj?.isNightShift) {
            return; // reject invalid prefill — will be handled later
          }
        }
        assign(s.id, date, pf.shiftTypeId, pf.isLeader);
        assigned.add(s.id);
        postAkeStaff.delete(s.id);
        const stObj = shiftTypes.find(st => st.id === pf.shiftTypeId);
        if (pf.shiftTypeId === 'off') {
          staffOffDays[s.id]++;
          staffConsecutive[s.id] = 0;
        } else if (pf.shiftTypeId === 'paid') {
          // 有給は休み扱い（連勤リセット）だが公休としてはカウントしない
          staffConsecutive[s.id] = 0;
        } else {
          // 午前休・午後休・短時間は勤務日数カウント対象外
          if (!PARTIAL_SHIFT_IDS.has(pf.shiftTypeId)) staffWorkDays[s.id]++;
          staffConsecutive[s.id]++;
          if (stObj?.isNightShift) staffNightCount[s.id]++;
        }
        if (pf.isLeader) staffLeaderCount[s.id]++;
      }
    });

    // ----------------------------------------------------------------
    // Phase 1: 出勤不可曜日のスタッフを休みにする
    // 「自分は火曜は出勤できない」と設定した曜日のスタッフは自動休みになる
    // ----------------------------------------------------------------
    staff.forEach(s => {
      if (assigned.has(s.id) || postAkeStaff.has(s.id)) return;

      const req = getRequest(s.id, date);
      if (req) {
        assign(s.id, date, 'off');
        assigned.add(s.id);
        staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
        return;
      }

      if (s.unavailableDow.includes(dow) || (s.unavailableOnHoliday && holidaySet.has(date))) {
        assign(s.id, date, 'off');
        assigned.add(s.id);
        staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
        return;
      }
    });

    // ----------------------------------------------------------------
    // Phase 2: 夜勤に入るスタッフを決める
    // 夜勤専従スタッフは最低回数まで優先配置・夜勤が多すぎるスタッフはクールダウンで後まわし
    // ----------------------------------------------------------------
    if (nightType) {
      const nightReq = getEffectiveReq(nightType.id, effectiveDow);
      const alreadyNight = getDayAssignments(date).filter(a => a.shiftTypeId === nightType.id && !excludedIds.has(a.staffId)).length;
      const nightNeeded = nightReq - alreadyNight;

      if (nightNeeded > 0) {
        // 日勤後の連続夜勤チェック: 2回目の連続夜勤の場合、
        // 現在の連勤ストリーク内に日勤帯シフトがあれば不可
        // ○×○× は可、B○×○× は不可、BBB○× は可
        const hasDayShiftBeforeNightStreak = (staffId: string): boolean => {
          if (getConsecutiveNights(staffId, day) < 1) return false; // 1回目の夜勤なら制約なし
          // 連続夜勤ペア(○×)を遡り、その手前に日勤帯があるか確認
          let d = day - 1;
          while (d >= 1) {
            const ds = dateStr(year, month, d);
            const a = getAssignment(staffId, ds);
            if (!a || a.shiftTypeId === 'off' || a.shiftTypeId === 'paid') break;
            if (akeType && a.shiftTypeId === akeType.id) { d--; continue; }
            if (nightType && a.shiftTypeId === nightType.id) { d--; continue; }
            // 夜勤・明け以外のシフトが見つかった → 日勤帯がストリーク内にある
            return true;
          }
          return false;
        };

        // ペース先行チェック: 上限に対して現時点で期待値より多い場合は候補除外
        // 例: nightShiftMax=4, day=10, daysInMonth=31 → 期待1.3回。2回済なら先行→除外
        const isAheadOfNightPace = (s: Staff): boolean => {
          if (!s.nightShiftMax || s.nightShiftMax <= 0) return false;
          const expected = s.nightShiftMax * day / daysInMonth;
          return staffNightCount[s.id] >= expected;
        };

        // 夜勤できる条件：連勤上限・月出勤上限・連続夜勤制限・ペース先行を満たしているスタッフのみ候補
        const canDoNight = (s: Staff) =>
          s.availableShiftTypes.includes(nightType!.id) &&
          staffConsecutive[s.id] < config.maxConsecutiveDays &&
          !(s.monthlyWorkDays && staffWorkDays[s.id] >= s.monthlyWorkDays) &&
          !hitWeeklyLimit(s, day) &&
          !(s.nightShiftMax && staffNightCount[s.id] >= s.nightShiftMax) &&
          getConsecutiveNights(s.id, day) < MAX_CONSECUTIVE_NIGHTS &&
          !isAheadOfNightPace(s);

        // ペース制約を除いた基本条件
        const canDoNightBase = (s: Staff) =>
          s.availableShiftTypes.includes(nightType!.id) &&
          staffConsecutive[s.id] < config.maxConsecutiveDays &&
          !(s.monthlyWorkDays && staffWorkDays[s.id] >= s.monthlyWorkDays) &&
          !hitWeeklyLimit(s, day) &&
          !(s.nightShiftMax && staffNightCount[s.id] >= s.nightShiftMax) &&
          getConsecutiveNights(s.id, day) < MAX_CONSECUTIVE_NIGHTS;

        const normalCandidates = staff.filter(s =>
          !assigned.has(s.id) && !postAkeStaff.has(s.id) && canDoNight(s)
        );
        const akeCandidates = staff.filter(s =>
          postAkeStaff.has(s.id) && canDoNight(s)
        );
        // ペース先行中だが基本条件は満たすスタッフ（最終フォールバック用）
        const aheadCandidates = staff.filter(s =>
          !assigned.has(s.id) && !postAkeStaff.has(s.id) && canDoNightBase(s) && isAheadOfNightPace(s)
        );

        // 夜勤専従の最低回数強制: 残り日数が足りなくなる時のみクールダウンを無視して強制
        // （通常はクールダウンによる自然分散に任せる）
        const isNightOnlyForced = (s: Staff): boolean => {
          if (!(s.isNightOnly && s.nightShiftMin && staffNightCount[s.id] < s.nightShiftMin)) return false;
          const nightsNeeded = s.nightShiftMin - staffNightCount[s.id];
          const daysLeft = daysInMonth - day + 1;
          return daysLeft <= nightsNeeded * 2 + 1;
        };
        const nightOnlyBelowMin = normalCandidates.filter(isNightOnlyForced);
        const nightOnlyBelowMinAke = akeCandidates.filter(isNightOnlyForced);
        const forcedNightOnly = [...nightOnlyBelowMin, ...nightOnlyBelowMinAke];

        // クールダウン判定: 理想インターバル内に夜勤した場合は後回しにする
        // day-1 から検索（明けの日も含めて正確にチェック）
        const isOnNightCooldown = (s: Staff): boolean => {
          const recentNight = (interval: number) => {
            for (let d = day - 1; d >= Math.max(1, day - interval); d--) {
              const ds = dateStr(year, month, d);
              const a = assignments.find(x => x.staffId === s.id && x.date === ds);
              if (a && nightType && a.shiftTypeId === nightType.id) return true;
            }
            return false;
          };
          if (s.isNightOnly) {
            if (!s.nightShiftMin) return false;
            const idealInterval = Math.floor(daysInMonth / s.nightShiftMin);
            return recentNight(idealInterval);
          }
          if (s.nightShiftMax && s.nightShiftMax > 0) {
            const idealInterval = Math.floor(daysInMonth / s.nightShiftMax);
            return recentNight(idealInterval);
          }
          // 上限設定なし: デフォルトインターバル
          return recentNight(Math.ceil(daysInMonth / 4));
        };

        const nightPairs = pairs.filter(p => !p.scope || p.scope === 'night' || p.scope === 'all');
        let nightWorkers: Staff[];
        if (forcedNightOnly.length >= nightNeeded) {
          // Enough night-only staff below minimum — pick them
          nightWorkers = selectNightWorkers(forcedNightOnly, nightNeeded, staffNightCount, nightPairs, date, day, daysInMonth, rng);
        } else {
          const reservedIds = new Set(forcedNightOnly.map(s => s.id));
          const allRemaining = [...normalCandidates, ...akeCandidates].filter(s => !reservedIds.has(s.id));
          // ソフト制約: 日勤後の連続夜勤はできれば避ける（候補が足りなければ許可）
          const preferredRemaining = allRemaining.filter(s => !hasDayShiftBeforeNightStreak(s.id));
          const dayBeforeNightRemaining = allRemaining.filter(s => hasDayShiftBeforeNightStreak(s.id));
          // プライマリ候補: クールダウン中でないスタッフ（日勤後連夜なし優先）
          const primaryRemaining = preferredRemaining.filter(s => !isOnNightCooldown(s));
          // フォールバック1: クールダウン中だが日勤後連夜なし
          const cooldownRemaining = preferredRemaining.filter(s => isOnNightCooldown(s));
          // フォールバック2: 日勤後連夜あり（クールダウンなし優先）
          const dayBeforeNightPrimary = dayBeforeNightRemaining.filter(s => !isOnNightCooldown(s));
          const dayBeforeNightCooldown = dayBeforeNightRemaining.filter(s => isOnNightCooldown(s));
          const needed = nightNeeded - forcedNightOnly.length;
          // 優先順: ①日勤後連夜なし＋クールダウンなし → ②日勤後連夜なし＋クールダウン中
          //       → ③日勤後連夜あり＋クールダウンなし → ④日勤後連夜あり＋クールダウン中
          //       → ⑤ペース先行中
          const pools = [
            primaryRemaining,
            cooldownRemaining,
            dayBeforeNightPrimary,
            dayBeforeNightCooldown,
            aheadCandidates,
          ];
          let pool: Staff[] = [];
          for (const p of pools) {
            pool = [...pool, ...p];
            if (pool.length >= needed) break;
          }
          const extraWorkers = selectNightWorkers(pool, needed, staffNightCount, nightPairs, date, day, daysInMonth, rng);
          nightWorkers = [...forcedNightOnly, ...extraWorkers];
        }

        nightWorkers.forEach(s => {
          assign(s.id, date, nightType!.id);
          assigned.add(s.id);
          postAkeStaff.delete(s.id);
          staffNightCount[s.id]++;
          staffWorkDays[s.id]++;
          staffConsecutive[s.id]++;
        });
      }
    }

    // 明け後だが夜勤に入らなかったスタッフは「休み」にする
    // 明け後の休みは公休（staffOffDays）としてカウントする
    postAkeStaff.forEach(sid => {
      if (assigned.has(sid)) return;
      assign(sid, date, 'off');
      assigned.add(sid);
      staffOffDays[sid]++;
      staffConsecutive[sid] = 0;
    });

    // ----------------------------------------------------------------
    // Phase 3: 日勤・早番・遅番の必要人数分を埋める
    // 不足しているシフトを優先して、業務を担当できるスタッフを優先選ぶ
    // ----------------------------------------------------------------
    const getTargetOffDays = (s: Staff) => {
      if (s.monthlyWorkDays) return Math.max(config.monthlyOffDays, daysInMonth - s.monthlyWorkDays);
      if (s.weeklyWorkDays) {
        // 週あたりの休日数から月公休を計算（端数切り上げで安定化）
        const weeklyOffDays = 7 - s.weeklyWorkDays;
        const targetOff = Math.ceil(weeklyOffDays * daysInMonth / 7);
        return Math.max(config.monthlyOffDays, targetOff);
      }
      return config.monthlyOffDays;
    };
    const idealOffPace = (s: Staff) => day * (getTargetOffDays(s) / daysInMonth);
    const offDeficit = (s: Staff) => idealOffPace(s) - staffOffDays[s.id];

    let filling = true;
    while (filling) {
      filling = false;
      const dayAs = getDayAssignments(date);

      const shiftsByDeficit = dayShiftTypes
        .map(st => {
          return {
            st,
            filled: dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef' && !excludedIds.has(a.staffId)).length,
            req: getEffectiveReq(st.id, effectiveDow),
          };
        })
        .filter(x => x.filled < x.req)
        .sort((a, b) => (a.filled - a.req) - (b.filled - b.req));

      if (shiftsByDeficit.length === 0) break;

      // Compute unfilled duty needs for this day (only early/day shifts carry duties)
      const dutyReqs = config.dutyRequirements ?? {} as Record<AutoDutyType, number[]>;
      const currentDutyCapable: Record<string, number> = {};
      for (const d of ALL_DUTIES) {
        const req = dutyReqs[d as AutoDutyType]?.[effectiveDow] ?? 0;
        if (req <= 0) continue;
        const alreadyCapable = dayAs
          .filter(a => DUTY_ELIGIBLE_SHIFTS.has(a.shiftTypeId) && !excludedIds.has(a.staffId))
          .filter(a => {
            const s = staff.find(x => x.id === a.staffId);
            return (s?.availableDuties ?? []).includes(d as DutyType);
          }).length;
        currentDutyCapable[d] = req - alreadyCapable;
      }

      for (const { st } of shiftsByDeficit) {
        const remainingDaysP3 = daysInMonth - day + 1;
        const candidates = staff.filter(s => {
          const tOff = getTargetOffDays(s);
          const nOff = tOff - staffOffDays[s.id];
          const isCritical = nOff > 0 && nOff >= remainingDaysP3 * 0.65;
          return (
            !assigned.has(s.id) &&
            !s.isNightOnly &&
            s.availableShiftTypes.includes(st.id) &&
            staffConsecutive[s.id] < config.maxConsecutiveDays &&
            !(s.monthlyWorkDays && staffWorkDays[s.id] >= s.monthlyWorkDays) &&
            !hitWeeklyLimit(s, day) &&
            !isCritical  // 公休が切迫しているスタッフは除外
          );
        });

        if (candidates.length === 0) continue;

        const isDutyShift = DUTY_ELIGIBLE_SHIFTS.has(st.id);
        const dayPairs = pairs.filter(p => p.scope === 'day' || p.scope === 'all');
        const assignedDayIds = dayAs.map(a => a.staffId);
        const hasDayNg = (s: Staff) => assignedDayIds.some(id =>
          dayPairs.some(p => p.type === 'ng' &&
            ((p.staffId1 === s.id && p.staffId2 === id) || (p.staffId1 === id && p.staffId2 === s.id))
          )
        );
        const dayPreferredScore = (s: Staff) => assignedDayIds.reduce((sum, id) =>
          sum + (dayPairs.some(p => p.type === 'preferred' &&
            ((p.staffId1 === s.id && p.staffId2 === id) || (p.staffId1 === id && p.staffId2 === s.id))
          ) ? 1 : 0), 0
        );

        candidates.sort((a, b) => {
          // 日勤NGペアは後回し
          const aNg = hasDayNg(a) ? 1 : 0;
          const bNg = hasDayNg(b) ? 1 : 0;
          if (aNg !== bNg) return aNg - bNg;
          // 日勤推奨ペアは優先
          const aPref = dayPreferredScore(a);
          const bPref = dayPreferredScore(b);
          if (aPref !== bPref) return bPref - aPref;
          // For early/day shifts, prefer staff who can fill unfulfilled duty needs
          if (isDutyShift) {
            const aDutyScore = Object.entries(currentDutyCapable)
              .filter(([, deficit]) => deficit > 0)
              .reduce((sum, [d]) => sum + ((a.availableDuties ?? []).includes(d as DutyType) ? 1 : 0), 0);
            const bDutyScore = Object.entries(currentDutyCapable)
              .filter(([, deficit]) => deficit > 0)
              .reduce((sum, [d]) => sum + ((b.availableDuties ?? []).includes(d as DutyType) ? 1 : 0), 0);
            if (aDutyScore !== bDutyScore) return bDutyScore - aDutyScore;
          }

          const aTarget = getTargetOffDays(a);
          const bTarget = getTargetOffDays(b);
          const aOffOk = staffOffDays[a.id] >= aTarget ? 1 : 0;
          const bOffOk = staffOffDays[b.id] >= bTarget ? 1 : 0;
          if (aOffOk !== bOffOk) return bOffOk - aOffOk;

          const aDeficit = offDeficit(a);
          const bDeficit = offDeficit(b);
          if (Math.abs(aDeficit - bDeficit) > 0.5) return aDeficit - bDeficit;

          const workDiff = staffWorkDays[a.id] - staffWorkDays[b.id];
          if (workDiff !== 0) return workDiff;
          // シード乱数によるタイブレーク（パターンバリエーション生成用）
          return rng() - 0.5;
        });
        const picked = candidates[0];
        assign(picked.id, date, st.id);
        assigned.add(picked.id);
        staffWorkDays[picked.id]++;
        staffConsecutive[picked.id]++;
        filling = true;
        break;
      }
    }

    // ----------------------------------------------------------------
    // Phase 4: リーダーを決める
    // 日勤中のリーダー対応スタッフの中から、リーダー回数が少ない人を優先選ぶ（均等化）
    // ----------------------------------------------------------------
    if (config.leaderCountPerDay > 0) {
      const existingLeaders = assignments.filter(a => a.date === date && a.isLeader).length;
      const needLeaders = config.leaderCountPerDay - existingLeaders;
      if (needLeaders > 0) {
        const leaderCandidateIds = assignments
          .filter(a => a.date === date && a.shiftTypeId === 'day' && !a.isLeader && (staff.find(x => x.id === a.staffId)?.availableDuties ?? []).includes('ld'))
          .map(a => a.staffId)
          .sort((a, b) => (staffLeaderCount[a] ?? 0) - (staffLeaderCount[b] ?? 0));

        const leaderSet = new Set(leaderCandidateIds.slice(0, needLeaders));
        for (let i = 0; i < assignments.length; i++) {
          if (assignments[i].date === date && leaderSet.has(assignments[i].staffId) && assignments[i].shiftTypeId === 'day' && !assignments[i].isLeader) {
            assignments[i] = { ...assignments[i], isLeader: true };
            staffLeaderCount[assignments[i].staffId]++;
            leaderSet.delete(assignments[i].staffId);
          }
        }
      }
    }

    // ----------------------------------------------------------------
    // Phase 5: まだ割り当てられていないスタッフに「出勤」 or 「休み」を割り当てる
    // 公休日数・出勤日数のペースを見ながら判断する。
    // 「残り日数の 80%以上が公休必要」なら強制休㤯（救済ロジック）
    // ----------------------------------------------------------------
    staff.forEach(s => {
      if (assigned.has(s.id)) return;

      // 夜勤専従スタッフは Phase 2 で夜勤が決まらなかったら休み
      // （日勤に入れるのは彼らにとってまったく違うシフトなので休みだけにする）
      if (s.isNightOnly) {
        const nightOnlyTargetOff = getTargetOffDays(s);
        const nightOnlyOffQuotaMet = staffOffDays[s.id] >= nightOnlyTargetOff;
        assign(s.id, date, 'off');
        if (!nightOnlyOffQuotaMet) staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
        assigned.add(s.id);
        return;
      }

      const targetOff = getTargetOffDays(s);
      const remainingDays = daysInMonth - day + 1;
      const neededOff = targetOff - staffOffDays[s.id];
      const hitConsecutiveLimit = staffConsecutive[s.id] >= config.maxConsecutiveDays;
      const hitWorkLimit = s.monthlyWorkDays ? staffWorkDays[s.id] >= s.monthlyWorkDays : false;
      const hitWeekLimit = hitWeeklyLimit(s, day);

      const targetWork = s.monthlyWorkDays ?? (daysInMonth - targetOff);
      const neededWork = Math.max(0, targetWork - staffWorkDays[s.id]);

      // 将来の手動入力を先読み（今日以降の prefilled entries を考慮）
      let futurePrefilledOff = 0, futurePrefilledWork = 0;
      for (let fd = day + 1; fd <= daysInMonth; fd++) {
        const fDate = dateStr(year, month, fd);
        const fp = getPrefilled(s.id, fDate);
        if (fp) {
          if (fp.shiftTypeId === 'off') futurePrefilledOff++;
          else if (!PARTIAL_SHIFT_IDS.has(fp.shiftTypeId)) futurePrefilledWork++;
        }
      }
      // 自動割当が埋めるべき残り（将来の手動入力分を差し引く）
      const autoNeededOff = Math.max(0, neededOff - futurePrefilledOff);
      const autoNeededWork = Math.max(0, neededWork - futurePrefilledWork);
      const freeRemainingDays = Math.max(1, remainingDays - futurePrefilledOff - futurePrefilledWork);

      // 救済ロジック: 残りの自由日で公休を確保できなくなる前に強制休み
      const criticallyBehindOnOff = autoNeededOff > 0 && autoNeededOff >= freeRemainingDays * 0.65;
      const offQuotaMet = autoNeededOff <= 0;
      // 出勤逼迫: 残り必要出勤が残り自由日の80%以上
      const criticallyBehindOnWork = !hitWorkLimit && autoNeededWork > 0 && autoNeededWork >= freeRemainingDays * 0.8;

      const dayAs = getDayAssignments(date);

      // 必要人数が不足しているシフトを探す（不足しているシフトがあればそこに優先配置）
      const strictUnfilled = dayShiftTypes.find(st => {
        const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef' && !excludedIds.has(a.staffId)).length;
        const req = getEffectiveReq(st.id, effectiveDow);
        return filled < req && s.availableShiftTypes.includes(st.id);
      });

      // 人数不足のシフトがある場合は、連勤上限・公休不足などハード制約がない限り強制出勤させる
      if (strictUnfilled && !hitConsecutiveLimit && !hitWorkLimit && !hitWeekLimit && !criticallyBehindOnOff && autoNeededOff < freeRemainingDays) {
        assign(s.id, date, strictUnfilled.id);
        if (!PARTIAL_SHIFT_IDS.has(strictUnfilled.id)) staffWorkDays[s.id]++;
        staffConsecutive[s.id]++;
        assigned.add(s.id);
        return;
      }

      // 出勤逼迫（criticallyBehindOnWork）は週上限・公休逼迫よりも優先して出勤させる
      // （連勤上限・月出勤上限は絶対制約なので上書き不可）
      const mustRest = hitConsecutiveLimit || hitWorkLimit ||
        (!criticallyBehindOnWork && (hitWeekLimit || criticallyBehindOnOff));

      const assignWork = () => {
        const softUnfilled = dayShiftTypes.find(st => {
          const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef' && !excludedIds.has(a.staffId)).length;
          const req = getEffectiveReq(st.id, effectiveDow);
          return filled < req && s.availableShiftTypes.includes(st.id);
        });
        if (softUnfilled) {
          assign(s.id, date, softUnfilled.id);
          if (!PARTIAL_SHIFT_IDS.has(softUnfilled.id)) staffWorkDays[s.id]++;
          staffConsecutive[s.id]++;
        } else if (offQuotaMet) {
          // 公休達成済みで全シフト充足 → B勤で余剰配置（公休超過を防ぐ）
          const dayShiftType = shiftTypes.find(st => st.id === 'day');
          if (dayShiftType && !s.isNightOnly && s.availableShiftTypes.includes('day')) {
            assign(s.id, date, dayShiftType.id);
            staffWorkDays[s.id]++;
            staffConsecutive[s.id]++;
          } else {
            assign(s.id, date, 'off');
            staffConsecutive[s.id] = 0;
          }
        } else {
          // 公休未達成で全シフト充足 → 休み
          assign(s.id, date, 'off');
          if (autoNeededOff > 0) staffOffDays[s.id]++;
          staffConsecutive[s.id] = 0;
        }
      };

      if (mustRest) {
        assign(s.id, date, 'off');
        // 公休目標達成後の強制休みは公休としてカウントしない（超過防止）
        if (!offQuotaMet) staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
      } else if (offQuotaMet || criticallyBehindOnWork) {
        // 公休目標達成済み、または残り出勤が逼迫 → 強制出勤
        assignWork();
      } else {
        const offRatio = autoNeededOff / freeRemainingDays;
        const workRatio = autoNeededWork / freeRemainingDays;

        // 前日が休みかどうか＋現在の連続休み日数を算出
        let consecOffNow = 0;
        for (let dd = day - 1; dd >= 1; dd--) {
          const ds = dateStr(year, month, dd);
          const a = getAssignment(s.id, ds);
          if (a && (a.shiftTypeId === 'off' || a.shiftTypeId === 'paid')) {
            consecOffNow++;
          } else {
            break;
          }
        }
        const prevWasOff = consecOffNow > 0;

        // 今月すでに連休（2日以上連続休み）を取得済みか判定
        let hasConsecOff = false;
        let streak = 0;
        for (let dd = 1; dd < day; dd++) {
          const ds = dateStr(year, month, dd);
          const a = getAssignment(s.id, ds);
          if (a && (a.shiftTypeId === 'off' || a.shiftTypeId === 'paid')) {
            streak++;
            if (streak >= 2) { hasConsecOff = true; break; }
          } else {
            streak = 0;
          }
        }

        // 連続性ボーナス: 前日が休みで連休がまだ少ない場合は強くバイアス
        const STREAK_BIAS = 0.15;
        const CONSEC_OFF_BONUS = 0.20; // 連休未取得＋前日休みの場合の追加ボーナス
        let offBonus = prevWasOff ? STREAK_BIAS : -STREAK_BIAS;
        if (prevWasOff && consecOffNow === 1 && !hasConsecOff) {
          // 前日が1日だけ休み＋まだ連休なし → 強く連休を促進
          offBonus += CONSEC_OFF_BONUS;
        }

        // 必要人数少ない日バイアス: 必要人数が少ない日に休みを取りやすくする
        // → 必要人数が多い日に出勤を温存 → 月末偏り防止
        const avgReq = dayTotalReq.slice(1).reduce((a, b) => a + b, 0) / daysInMonth;
        const todayReq = dayTotalReq[day];
        if (todayReq < avgReq) {
          // 必要人数が平均未満 → 休みバイアス（必要人数に対する要員余裕が大きい日）
          offBonus += 0.10;
        } else if (todayReq > avgReq) {
          // 必要人数が平均以上 → 出勤バイアス
          offBonus -= 0.05;
        }

        // シード乱数による微小揺らぎ（パターンバリエーション用）
        offBonus += (rng() - 0.5) * 0.08;
        const adjustedOffRatio = offRatio + offBonus;
        if (adjustedOffRatio >= workRatio) {
          assign(s.id, date, 'off');
          staffOffDays[s.id]++;
          staffConsecutive[s.id] = 0;
        } else {
          assignWork();
        }
      }
      assigned.add(s.id);
    });
  }

  // ====================================================================
  // バランス調整パス: 日ごとの出勤人数偏りを解消するスワップ最適化
  // 出勤者が多すぎる日の「余剰スタッフ」と、出勤者が少ない日の「休みスタッフ」を入れ替え
  // ====================================================================
  const MAX_SWAP_ITERATIONS = 3;
  for (let iter = 0; iter < MAX_SWAP_ITERATIONS; iter++) {
    let swapped = false;

    // 各日の充足状況を計算
    const dayStats: { day: number; date: string; surplus: number; effectiveDow: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = dateStr(year, month, d);
      const dw = getDow(year, month, d);
      const edw = getEffectiveDow(dt, dw);
      const dayAs = assignments.filter(a => a.date === dt);
      let totalFilled = 0, totalReq = 0;
      for (const st of dayShiftTypes) {
        totalFilled += dayAs.filter(a => a.shiftTypeId === st.id && !excludedIds.has(a.staffId)).length;
        totalReq += getEffectiveReq(st.id, edw);
      }
      dayStats.push({ day: d, date: dt, surplus: totalFilled - totalReq, effectiveDow: edw });
    }

    // 余剰が最大の日と不足が最大の日を見つけてスワップ
    const sortedBySurplus = [...dayStats].sort((a, b) => b.surplus - a.surplus);
    const surplusDay = sortedBySurplus[0];
    const deficitDay = sortedBySurplus[sortedBySurplus.length - 1];

    // 余剰が2以上かつ不足がある（surplus < 0）場合のみスワップ
    if (surplusDay.surplus < 2 || deficitDay.surplus >= 0) break;

    // 余剰日に日勤帯で出勤していて、不足日に休みのスタッフを探す
    const surplusDayAs = assignments.filter(a => a.date === surplusDay.date);
    const deficitDayAs = assignments.filter(a => a.date === deficitDay.date);

    for (const surplusA of surplusDayAs) {
      if (excludedIds.has(surplusA.staffId)) continue;
      const st = shiftTypes.find(x => x.id === surplusA.shiftTypeId);
      if (!st?.isDayShift) continue; // 日勤帯のみスワップ対象
      if (surplusA.isLeader) continue; // リーダーはスワップしない
      if (isPrefilled(surplusA.staffId, surplusDay.date)) continue; // 手動入力はスワップしない

      const deficitA = deficitDayAs.find(a => a.staffId === surplusA.staffId);
      if (!deficitA || deficitA.shiftTypeId !== 'off') continue; // 不足日に休みでないとスワップできない
      if (isPrefilled(surplusA.staffId, deficitDay.date)) continue;

      const s = staff.find(x => x.id === surplusA.staffId);
      if (!s) continue;
      if (s.isNightOnly) continue;

      // 不足日に出勤可能か確認（出勤不可曜日チェック）
      const deficitDow = getDow(year, month, deficitDay.day);
      if (s.unavailableDow.includes(deficitDow)) continue;
      if (s.unavailableOnHoliday && holidaySet.has(deficitDay.date)) continue;

      // 不足日の未充足シフトを探す
      const deficitShift = dayShiftTypes.find(dst => {
        const filled = deficitDayAs.filter(a => a.shiftTypeId === dst.id && !excludedIds.has(a.staffId)).length;
        const req = getEffectiveReq(dst.id, deficitDay.effectiveDow);
        return filled < req && s.availableShiftTypes.includes(dst.id);
      });
      if (!deficitShift) continue;

      // 前後の日に夜勤・明けが入っていないか確認（明け後に日勤はNG）
      const prevDeficitDate = deficitDay.day > 1 ? dateStr(year, month, deficitDay.day - 1) : null;
      const nextDeficitDate = deficitDay.day < daysInMonth ? dateStr(year, month, deficitDay.day + 1) : null;
      if (prevDeficitDate) {
        const prevA = assignments.find(a => a.staffId === s.id && a.date === prevDeficitDate);
        if (prevA && akeType && prevA.shiftTypeId === akeType.id) continue; // 明け後に日勤NG
        if (prevA && nightType && prevA.shiftTypeId === nightType.id) continue; // 夜勤の翌日は明け
      }
      if (nextDeficitDate) {
        const nextA = assignments.find(a => a.staffId === s.id && a.date === nextDeficitDate);
        if (nextA && akeType && nextA.shiftTypeId === akeType.id) continue; // 翌日が明けなら今日は夜勤のはず
      }

      // 余剰日を休みに、不足日を出勤にスワップ
      const surplusIdx = assignments.findIndex(a => a.staffId === surplusA.staffId && a.date === surplusDay.date);
      const deficitIdx = assignments.findIndex(a => a.staffId === surplusA.staffId && a.date === deficitDay.date);
      if (surplusIdx >= 0 && deficitIdx >= 0) {
        assignments[surplusIdx] = { ...assignments[surplusIdx], shiftTypeId: 'off', duty: undefined, isLeader: false };
        assignments[deficitIdx] = { ...assignments[deficitIdx], shiftTypeId: deficitShift.id };
        swapped = true;
        break; // 1回のイテレーションで1スワップのみ
      }
    }

    if (!swapped) break;
  }

  // Phase 6: Assign duties to day-shift staff
  assignDuties(assignments, staff, shiftTypes, config, year, month, daysInMonth, holidaySet);

  return assignments;
}

export function assignDuties(
  assignments: ShiftAssignment[],
  staff: Staff[],
  _shiftTypes: ShiftType[],
  config: FloorConfig,
  year: number,
  month: number,
  daysInMonth: number,
  holidaySet: Set<string>,
) {
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const dutyReqs = config.dutyRequirements ?? {} as Record<AutoDutyType, number[]>;

  // 月間スタッフ別業務担当回数（均等化のために月全体でトラッキング）
  const staffMonthlyDuty: Record<string, Record<DutyType, number>> = {};
  const initDutyRecord = (): Record<DutyType, number> => ({ ld: 0, bathing: 0, floor: 0, toilet: 0, onef: 0 });
  for (const s of staff) {
    staffMonthlyDuty[s.id] = initDutyRecord();
  }

  const holidayDutyReqs = config.holidayDutyRequirements ?? {};

  for (let day = 1; day <= daysInMonth; day++) {
    const date = dateStr(year, month, day);
    const dow = getDow(year, month, day);
    const isHoliday = holidaySet.has(date);

    // getDutyReq: 祝日設定があれば祝日要件、なければ曜日要件
    const getDutyReq = (duty: DutyType): number =>
      isHoliday && config.useHolidayRequirements && holidayDutyReqs[duty] !== undefined
        ? holidayDutyReqs[duty]
        : (dutyReqs[duty as AutoDutyType]?.[dow] ?? 0);

    // Step 0: req=0 の業務が残っていたらクリア（前回実行の残留を防ぐ）
    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i].date !== date) continue;
      if (!assignments[i].duty) continue;
      if (getDutyReq(assignments[i].duty!) === 0) {
        assignments[i] = { ...assignments[i], duty: undefined };
      }
    }

    // Step A: Count manually-assigned duties & collect unassigned indices
    const dutyCounts: Record<DutyType, number> = initDutyRecord();
    const unassignedIndices: number[] = [];

    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i].date !== date) continue;
      if (!DUTY_ELIGIBLE_SHIFTS.has(assignments[i].shiftTypeId)) continue;
      if (assignments[i].duty) {
        dutyCounts[assignments[i].duty!]++;
        // 手動設定分も月間カウントに加算
        staffMonthlyDuty[assignments[i].staffId] ??= initDutyRecord();
        staffMonthlyDuty[assignments[i].staffId][assignments[i].duty!]++;
      } else {
        // 人数除外スタッフには業務を割り振らない
        const st = staffMap.get(assignments[i].staffId);
        if (st?.excludeFromCount) continue;
        unassignedIndices.push(i);
      }
    }

    if (unassignedIndices.length === 0) continue;

    const assigned = new Set<number>();

    // 前日の業務マップ（連続同一業務回避用）
    const prevDate = day > 1 ? dateStr(year, month, day - 1) : null;
    const prevDayDuties = new Map<string, DutyType | undefined>();
    if (prevDate) {
      for (const a of assignments) {
        if (a.date === prevDate && a.duty) prevDayDuties.set(a.staffId, a.duty);
      }
    }

    // 候補ソート: ①前日同一業務は後回し、②月間担当回数が少ない順、③担当可能業務数が少ない順
    const sortCandidates = (indices: number[], duty: DutyType) =>
      [...indices].sort((a, b) => {
        const sa = staffMap.get(assignments[a].staffId);
        const sb = staffMap.get(assignments[b].staffId);
        // 前日同一業務ペナルティ（連続回避）
        const aConsec = prevDayDuties.get(assignments[a].staffId) === duty ? 1 : 0;
        const bConsec = prevDayDuties.get(assignments[b].staffId) === duty ? 1 : 0;
        if (aConsec !== bConsec) return aConsec - bConsec;
        const monthDiffA = (staffMonthlyDuty[assignments[a].staffId]?.[duty] ?? 0);
        const monthDiffB = (staffMonthlyDuty[assignments[b].staffId]?.[duty] ?? 0);
        if (monthDiffA !== monthDiffB) return monthDiffA - monthDiffB; // 少ない順
        return (sa?.availableDuties ?? []).length - (sb?.availableDuties ?? []).length;
      });

    // Step B: 必要人数の不足が大きい業務から順に割り当て（不足が同じなら ALL_DUTIES 順）
    // 候補が少ない業務にスタッフを先に確保し、「入浴0/2, 排泄3/1」のような偏りを防ぐ

    // 業務の優先順位: LD → 入浴 → フロア → 排泄（高→低）
    const DUTY_PRIORITY: Record<DutyType, number> = { ld: 0, bathing: 1, floor: 2, toilet: 3, onef: 4 };

    // 優先度順にソート（不足がある業務のみ）
    const dutiesByDeficit = ALL_DUTIES
      .map(duty => ({
        duty,
        req: getDutyReq(duty),
        deficit: getDutyReq(duty) - dutyCounts[duty],
      }))
      .filter(x => x.deficit > 0)
      .sort((a, b) => DUTY_PRIORITY[a.duty] - DUTY_PRIORITY[b.duty]);

    for (const { duty, deficit } of dutiesByDeficit) {
      const candidates = sortCandidates(
        unassignedIndices
          .filter(idx => !assigned.has(idx))
          .filter(idx => {
            const s = staffMap.get(assignments[idx].staffId);
            return (s?.availableDuties ?? []).includes(duty);
          }),
        duty,
      );

      let filled = 0;
      for (const idx of candidates) {
        if (filled >= deficit) break;
        assignments[idx] = { ...assignments[idx], duty };
        dutyCounts[duty]++;
        staffMonthlyDuty[assignments[idx].staffId] ??= initDutyRecord();
        staffMonthlyDuty[assignments[idx].staffId][duty]++;
        assigned.add(idx);
        filled++;
      }
    }

    // Step C: 残りのスタッフに業務を割り当て（まだ未充足の業務を優先）
    for (const idx of unassignedIndices) {
      if (assigned.has(idx)) continue;
      const s = staffMap.get(assignments[idx].staffId);
      const available = (s?.availableDuties ?? []).filter((d: DutyType) => ALL_DUTIES.includes(d));
      if (available.length === 0) continue;

      // まだ必要人数を満たしていない業務を優先度順に埋める（LD→入浴→フロア→排泄）
      const underfilledDuty = available
        .filter(d => {
          const req = getDutyReq(d);
          return req > 0 && dutyCounts[d] < req;
        })
        .sort((a, b) => {
          // 優先度順
          const priA = DUTY_PRIORITY[a] ?? 99;
          const priB = DUTY_PRIORITY[b] ?? 99;
          if (priA !== priB) return priA - priB;
          const cntA = staffMonthlyDuty[assignments[idx].staffId]?.[a] ?? 0;
          const cntB = staffMonthlyDuty[assignments[idx].staffId]?.[b] ?? 0;
          return cntA - cntB;
        })[0] as DutyType | undefined;

      if (underfilledDuty) {
        assignments[idx] = { ...assignments[idx], duty: underfilledDuty };
        dutyCounts[underfilledDuty]++;
        staffMonthlyDuty[assignments[idx].staffId] ??= initDutyRecord();
        staffMonthlyDuty[assignments[idx].staffId][underfilledDuty]++;
        continue;
      }

      // 全業務充足済み → 必要人数が設定されている業務のみ対象（req=0の業務には割り当てない）
      const availableWithReq = available.filter(d => getDutyReq(d) > 0);
      if (availableWithReq.length === 0) continue; // 割り当て可能な業務がなければスキップ
      const leastDuty = availableWithReq
        .sort((a, b) => {
          const reqA = getDutyReq(a);
          const reqB = getDutyReq(b);
          const ratioA = dutyCounts[a] / reqA;
          const ratioB = dutyCounts[b] / reqB;
          if (ratioA !== ratioB) return ratioA - ratioB;
          // 同率なら優先度順（LD→入浴→フロア→排泄）
          const priA = DUTY_PRIORITY[a as DutyType] ?? 99;
          const priB = DUTY_PRIORITY[b as DutyType] ?? 99;
          if (priA !== priB) return priA - priB;
          const cntA = staffMonthlyDuty[assignments[idx].staffId]?.[a as DutyType] ?? 0;
          const cntB = staffMonthlyDuty[assignments[idx].staffId]?.[b as DutyType] ?? 0;
          return cntA - cntB;
        })[0] as DutyType;
      if (leastDuty) {
        assignments[idx] = { ...assignments[idx], duty: leastDuty };
        dutyCounts[leastDuty]++;
        staffMonthlyDuty[assignments[idx].staffId] ??= initDutyRecord();
        staffMonthlyDuty[assignments[idx].staffId][leastDuty]++;
      }
    }
  }
}

function selectNightWorkers(
  candidates: Staff[],
  count: number,
  nightCounts: Record<string, number>,
  pairs: PairSetting[],
  date: string,
  day: number,
  daysInMonth: number,
  rng: () => number,
): Staff[] {
  if (count === 0 || candidates.length === 0) return [];

  // 月の進行ペースに対する消化率（0.0〜1.0）
  // 月半ばで上限の半分を消化していれば 1.0（ペース通り）。
  // 1.0未満=遅れ（優先）、1.0超=先行（後回し）
  const progress = day / daysInMonth; // 月の進行度（0〜1）
  const getNightPaceRatio = (s: Staff) => {
    const target = s.isNightOnly ? (s.nightShiftMin ?? 0) : (s.nightShiftMax ?? 0);
    if (target <= 0) return nightCounts[s.id] > 0 ? nightCounts[s.id] / 4 : 0; // 上限なしはゆるく均等化
    const expectedByNow = target * progress;
    if (expectedByNow <= 0) return nightCounts[s.id] > 0 ? 999 : 0;
    return nightCounts[s.id] / expectedByNow; // <1=遅れ, >1=先行
  };

  const sorted = [...candidates].sort((a, b) => {
    const aNightOnly = a.isNightOnly ? 0 : 1;
    const bNightOnly = b.isNightOnly ? 0 : 1;
    if (aNightOnly !== bNightOnly) return aNightOnly - bNightOnly;

    if (a.isNightOnly && b.isNightOnly) {
      const aMin = a.nightShiftMin ?? 0;
      const bMin = b.nightShiftMin ?? 0;
      const aDeficit = aMin - nightCounts[a.id];
      const bDeficit = bMin - nightCounts[b.id];
      if (aDeficit !== bDeficit) return bDeficit - aDeficit;
    }

    // 消化率が低い（遅れている）スタッフを優先
    const paceDiff = getNightPaceRatio(a) - getNightPaceRatio(b);
    if (Math.abs(paceDiff) > 0.1) return paceDiff;
    return rng() - 0.5;
  });

  if (count === 1) {
    return [sorted[0]];
  }

  let bestGroup: Staff[] = [];
  let bestScore = -Infinity;

  const tryGroup = (group: Staff[]) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (pairs.some(p => p.type === 'ng' &&
          ((p.staffId1 === group[i].id && p.staffId2 === group[j].id) ||
            (p.staffId1 === group[j].id && p.staffId2 === group[i].id))
        )) return -10000;
      }
    }

    let score = 0;
    for (const g of group) {
      if (g.isNightOnly) {
        const deficit = (g.nightShiftMin ?? 0) - nightCounts[g.id];
        score += deficit > 0 ? 100 + deficit * 10 : 20;
      } else if (g.nightShiftMin && nightCounts[g.id] < g.nightShiftMin) {
        // 非専従でも下限未達なら優先
        const deficit = g.nightShiftMin - nightCounts[g.id];
        score += 50 + deficit * 5;
      } else {
        // 消化率が低い（遅れている）ほどスコアが高い
        score -= getNightPaceRatio(g) * 10;
      }
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (pairs.some(p => p.type === 'preferred' &&
          ((p.staffId1 === group[i].id && p.staffId2 === group[j].id) ||
            (p.staffId1 === group[j].id && p.staffId2 === group[i].id))
        )) score += 10;
      }
    }
    return score;
  };

  const limit = Math.min(candidates.length, 12);
  const pool = sorted.slice(0, limit);

  if (count >= pool.length) return pool.slice(0, count);

  const combos = getCombinations(pool, count);
  for (const combo of combos) {
    const score = tryGroup(combo);
    if (score > bestScore) {
      bestScore = score;
      bestGroup = combo;
    }
  }

  return bestGroup.length > 0 ? bestGroup : sorted.slice(0, count);
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const results: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = getCombinations(arr.slice(i + 1), k - 1);
    rest.forEach(combo => results.push([arr[i], ...combo]));
  }
  return results;
}
