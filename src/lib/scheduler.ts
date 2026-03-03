import type { Staff, ShiftType, FloorConfig, PairSetting, ShiftAssignment, Floor, DutyType } from '../types';
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
interface Context {
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

export function generateShift(ctx: Context): ShiftAssignment[] {
  const { year, month, floor, staff, shiftTypes, config, pairs, holidays, prevMonthAssignments, prefilled } = ctx;
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
      let workDays = new Set<number>();
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

  // 事前スキャン: 手動入力済みのシフトをチェックして、今後の判断に使う集計値を先取りする
  // （例: すでに有給が多いスタッフには休みを足さない、など）
  for (let day = 1; day <= daysInMonth; day++) {
    const date = dateStr(year, month, day);
    staff.forEach(s => {
      const pf = getPrefilled(s.id, date);
      if (!pf) return;
      const stObj = shiftTypes.find(st => st.id === pf.shiftTypeId);
      if (pf.shiftTypeId === 'off' || pf.shiftTypeId === 'paid') {
        staffOffDays[s.id]++;
      } else {
        staffWorkDays[s.id]++;
        if (stObj?.isNightShift) staffNightCount[s.id]++;
      }
      if (pf.isLeader) staffLeaderCount[s.id]++;
    });
  }

  // カウンターをリセット — 日ごとに処理しながら改めて積み上げていく
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
        if (pf.shiftTypeId === 'off' || pf.shiftTypeId === 'paid') {
          staffOffDays[s.id]++;
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

      if (s.unavailableDow.includes(dow)) {
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
      const alreadyNight = getDayAssignments(date).filter(a => a.shiftTypeId === nightType.id).length;
      const nightNeeded = nightReq - alreadyNight;

      if (nightNeeded > 0) {
        // 夜勤できる条件：連勤上限・月出勤上限・連続夜勤制限を満たしているスタッフのみ候補になれる
        const canDoNight = (s: Staff) =>
          s.availableShiftTypes.includes(nightType!.id) &&
          staffConsecutive[s.id] < config.maxConsecutiveDays &&
          !(s.monthlyWorkDays && staffWorkDays[s.id] >= s.monthlyWorkDays) &&
          !hitWeeklyLimit(s, day) &&
          !(s.isNightOnly && s.nightShiftMax && staffNightCount[s.id] >= s.nightShiftMax) &&
          getConsecutiveNights(s.id, day) < MAX_CONSECUTIVE_NIGHTS;

        const normalCandidates = staff.filter(s =>
          !assigned.has(s.id) && !postAkeStaff.has(s.id) && canDoNight(s)
        );
        const akeCandidates = staff.filter(s =>
          postAkeStaff.has(s.id) && canDoNight(s)
        );

        // 夜勤専従でまだ最低回数に達していないスタッフは必ず夜勤に入れる（強制優先）
        const nightOnlyBelowMin = normalCandidates
          .filter(s => s.isNightOnly && s.nightShiftMin && staffNightCount[s.id] < s.nightShiftMin);
        const nightOnlyBelowMinAke = akeCandidates
          .filter(s => s.isNightOnly && s.nightShiftMin && staffNightCount[s.id] < s.nightShiftMin);
        const forcedNightOnly = [...nightOnlyBelowMin, ...nightOnlyBelowMinAke];

        // クールダウン判定: 最低回数達成済みの夜勤専門スタッフが
        // 理想インターバル内に夜勤した場合は後回しにする
        const isOnNightCooldown = (s: Staff): boolean => {
          if (!s.isNightOnly || !s.nightShiftMin) return false;
          if (staffNightCount[s.id] < s.nightShiftMin) return false; // 未達なら常に優先
          const idealInterval = Math.ceil(daysInMonth / Math.max(s.nightShiftMin, 1));
          // 直近 idealInterval 日以内に夜勤があるか確認 (明けの前日が夜勤なので day-2 から)
          for (let d = day - 2; d >= Math.max(1, day - idealInterval); d--) {
            const ds = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const a = assignments.find(x => x.staffId === s.id && x.date === ds);
            if (a && nightType && a.shiftTypeId === nightType.id) return true;
          }
          return false;
        };

        let nightWorkers: Staff[];
        if (forcedNightOnly.length >= nightNeeded) {
          // Enough night-only staff below minimum — pick them
          nightWorkers = selectNightWorkers(forcedNightOnly, nightNeeded, staffNightCount, pairs, date);
        } else {
          const reservedIds = new Set(forcedNightOnly.map(s => s.id));
          const allRemaining = [...normalCandidates, ...akeCandidates].filter(s => !reservedIds.has(s.id));
          // プライマリ候補: クールダウン中でないスタッフ
          const primaryRemaining = allRemaining.filter(s => !isOnNightCooldown(s));
          // フォールバック: クールダウン中だが必要なら使う
          const cooldownRemaining = allRemaining.filter(s => isOnNightCooldown(s));
          const needed = nightNeeded - forcedNightOnly.length;
          const extraWorkers = primaryRemaining.length >= needed
            ? selectNightWorkers(primaryRemaining, needed, staffNightCount, pairs, date)
            : selectNightWorkers([...primaryRemaining, ...cooldownRemaining], needed, staffNightCount, pairs, date);
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
    // （明けの翌日に日勤に入れるのは禁止）
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
        const weeksInMonth = daysInMonth / 7;
        const targetWork = Math.round(s.weeklyWorkDays * weeksInMonth);
        return Math.max(config.monthlyOffDays, daysInMonth - targetWork);
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
            filled: dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef').length,
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
          .filter(a => DUTY_ELIGIBLE_SHIFTS.has(a.shiftTypeId))
          .filter(a => {
            const s = staff.find(x => x.id === a.staffId);
            return (s?.availableDuties ?? []).includes(d as DutyType);
          }).length;
        currentDutyCapable[d] = req - alreadyCapable;
      }

      for (const { st } of shiftsByDeficit) {
        const candidates = staff.filter(s =>
          !assigned.has(s.id) &&
          !s.isNightOnly &&
          s.availableShiftTypes.includes(st.id) &&
          staffConsecutive[s.id] < config.maxConsecutiveDays &&
          !(s.monthlyWorkDays && staffWorkDays[s.id] >= s.monthlyWorkDays) &&
          !hitWeeklyLimit(s, day)
        );

        if (candidates.length === 0) continue;

        const isDutyShift = DUTY_ELIGIBLE_SHIFTS.has(st.id);

        candidates.sort((a, b) => {
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

          return staffWorkDays[a.id] - staffWorkDays[b.id];
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
        assign(s.id, date, 'off');
        staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
        assigned.add(s.id);
        return;
      }

      const targetOff = getTargetOffDays(s);
      const remainingDays = daysInMonth - day + 1;
      const neededOff = targetOff - staffOffDays[s.id];
      // 救済ロジック: 残り日数で確実に公休を確保できなくなる前に強制休み
      const criticallyBehindOnOff = neededOff > 0 && neededOff >= remainingDays * 0.8;
      const hitConsecutiveLimit = staffConsecutive[s.id] >= config.maxConsecutiveDays;
      const hitWorkLimit = s.monthlyWorkDays ? staffWorkDays[s.id] >= s.monthlyWorkDays : false;
      const hitWeekLimit = hitWeeklyLimit(s, day);
      const offQuotaMet = neededOff <= 0;

      const targetWork = s.monthlyWorkDays ?? (daysInMonth - targetOff);
      const neededWork = Math.max(0, targetWork - staffWorkDays[s.id]);

      const dayAs = getDayAssignments(date);

      // 必要人数が不足しているシフトを探す（不足しているシフトがあればそこに優先配置）
      const strictUnfilled = dayShiftTypes.find(st => {
        const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef').length;
        const req = getEffectiveReq(st.id, effectiveDow);
        return filled < req && s.availableShiftTypes.includes(st.id);
      });

      // 人数不足のシフトがある場合は、連勤上限などハード制約がない限り強制出勤させる
      if (strictUnfilled && !hitConsecutiveLimit && !hitWorkLimit && !hitWeekLimit) {
        assign(s.id, date, strictUnfilled.id);
        if (!PARTIAL_SHIFT_IDS.has(strictUnfilled.id)) staffWorkDays[s.id]++;
        staffConsecutive[s.id]++;
        assigned.add(s.id);
        return;
      }

      const mustRest = hitConsecutiveLimit || hitWorkLimit || hitWeekLimit || criticallyBehindOnOff || neededOff >= remainingDays;
      const shouldWork = offQuotaMet && neededWork > 0;

      const assignWork = () => {
        const softUnfilled = dayShiftTypes.find(st => {
          const filled = dayAs.filter(a => a.shiftTypeId === st.id && a.duty !== 'onef').length;
          const req = getEffectiveReq(st.id, effectiveDow);
          return filled < req && s.availableShiftTypes.includes(st.id);
        });
        if (softUnfilled) {
          assign(s.id, date, softUnfilled.id);
          if (!PARTIAL_SHIFT_IDS.has(softUnfilled.id)) staffWorkDays[s.id]++;
          staffConsecutive[s.id]++;
        } else {
          assign(s.id, date, 'off');
          staffOffDays[s.id]++;
          staffConsecutive[s.id] = 0;
        }
      };

      if (mustRest) {
        assign(s.id, date, 'off');
        staffOffDays[s.id]++;
        staffConsecutive[s.id] = 0;
      } else if (shouldWork) {
        assignWork();
      } else {
        const offRatio = neededOff / remainingDays;
        const workRatio = neededWork / remainingDays;
        if (offRatio >= workRatio) {
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

  // Phase 6: Assign duties to day-shift staff
  assignDuties(assignments, staff, shiftTypes, config, year, month, daysInMonth);

  return assignments;
}

function assignDuties(
  assignments: ShiftAssignment[],
  staff: Staff[],
  _shiftTypes: ShiftType[],
  config: FloorConfig,
  year: number,
  month: number,
  daysInMonth: number,
) {
  const staffMap = new Map(staff.map(s => [s.id, s]));
  const dutyReqs = config.dutyRequirements ?? {} as Record<AutoDutyType, number[]>;
  const FALLBACK_DUTY: AutoDutyType = 'floor';

  // 月間スタッフ別業務担当回数（均等化のために月全体でトラッキング）
  const staffMonthlyDuty: Record<string, Record<DutyType, number>> = {};
  const initDutyRecord = (): Record<DutyType, number> => ({ ld: 0, bathing: 0, floor: 0, toilet: 0, onef: 0 });
  for (const s of staff) {
    staffMonthlyDuty[s.id] = initDutyRecord();
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = dateStr(year, month, day);
    const dow = getDow(year, month, day);

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
        unassignedIndices.push(i);
      }
    }

    if (unassignedIndices.length === 0) continue;

    const assigned = new Set<number>();

    // 候補ソート: ①その業務の月間担当回数が少ない順（均等化）、②担当可能業務数が少ない順（専門性）
    const sortCandidates = (indices: number[], duty: DutyType) =>
      [...indices].sort((a, b) => {
        const sa = staffMap.get(assignments[a].staffId);
        const sb = staffMap.get(assignments[b].staffId);
        const monthDiffA = (staffMonthlyDuty[assignments[a].staffId]?.[duty] ?? 0);
        const monthDiffB = (staffMonthlyDuty[assignments[b].staffId]?.[duty] ?? 0);
        if (monthDiffA !== monthDiffB) return monthDiffA - monthDiffB; // 少ない順
        return (sa?.availableDuties ?? []).length - (sb?.availableDuties ?? []).length;
      });

    // Step B: Assign duties in priority order (ALL_DUTIES: LD → 入浴 → 排泄 → フロア)
    for (const duty of ALL_DUTIES) {
      const req = dutyReqs[duty as AutoDutyType]?.[dow] ?? 0;
      const deficit = req - dutyCounts[duty];
      if (deficit <= 0) continue;

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

    // Step C: Assign remaining unassigned staff
    for (const idx of unassignedIndices) {
      if (assigned.has(idx)) continue;
      const s = staffMap.get(assignments[idx].staffId);
      const available = (s?.availableDuties ?? []).filter((d: DutyType) => ALL_DUTIES.includes(d));
      if (available.length === 0) continue;

      // 担当可能な業務の中で、①必要人数未達 かつ ②月間担当回数が少ないものを優先
      const underfilledDuty = available
        .filter(d => {
          const req = dutyReqs[d as AutoDutyType]?.[dow] ?? 0;
          return req > 0 && dutyCounts[d] < req;
        })
        .sort((a, b) => {
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

      // All capped duties are full — assign to the fallback duty with fewest monthly assignments
      if (available.includes(FALLBACK_DUTY)) {
        assignments[idx] = { ...assignments[idx], duty: FALLBACK_DUTY };
        dutyCounts[FALLBACK_DUTY]++;
        staffMonthlyDuty[assignments[idx].staffId] ??= initDutyRecord();
        staffMonthlyDuty[assignments[idx].staffId][FALLBACK_DUTY]++;
      } else {
        // フォールバック業務もできない場合は、月間担当回数が最少の担当可能な業務を選択
        const leastDuty = available
          .sort((a, b) => (staffMonthlyDuty[assignments[idx].staffId]?.[a as DutyType] ?? 0) - (staffMonthlyDuty[assignments[idx].staffId]?.[b as DutyType] ?? 0))[0] as DutyType;
        if (leastDuty) {
          assignments[idx] = { ...assignments[idx], duty: leastDuty };
          staffMonthlyDuty[assignments[idx].staffId] ??= initDutyRecord();
          staffMonthlyDuty[assignments[idx].staffId][leastDuty]++;
        }
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
): Staff[] {
  if (count === 0 || candidates.length === 0) return [];

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

    return nightCounts[a.id] - nightCounts[b.id];
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
      } else {
        score -= nightCounts[g.id] * 2;
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
