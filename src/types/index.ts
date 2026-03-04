/**
 * =========================================================
 * types/index.ts — アプリ全体で使う「型の定義集」
 * =========================================================
 *
 * TypeScript の「型」とは、「この変数にはどんな値が入るか」を
 * コンピューターに教えるための宣言です。
 * ここに書いた型を import して、他のファイルで使います。
 */

/** フロア。1F・2F・非常勤のいずれか */
export type Floor = '1F' | '2F' | '非常勤';

/** 雇用形態。正社員・パート・派遣のどれか */
export type RoleType = '正社員' | 'パート' | '派遣';

/** 夜勤ペアの関係。NG（一緒に入れない）か preferred（できれば一緒に）か */
export type PairType = 'ng' | 'preferred';

/** 業務の種類。1F は手入力専用（自動割当対象外） */
export type DutyType = 'ld' | 'bathing' | 'floor' | 'toilet' | 'onef';

/** 業務の略称ラベル（画面表示用） */
export const DUTY_LABELS: Record<DutyType, string> = {
  ld: 'LD',
  bathing: '入浴',
  floor: 'フロア',
  toilet: '排泄',
  onef: '応援',
};

/** 業務の一覧（この順序で処理・表示する） */
export const ALL_DUTIES: DutyType[] = ['ld', 'bathing', 'floor', 'toilet'];

/**
 * スタッフ一人分の情報。
 * StaffPage で登録・編集する。
 */
export interface Staff {
  id: string;                    // 一意に識別するID（重複しない）
  name: string;                  // 氏名
  floor: Floor;                  // 所属フロア
  role: RoleType;                // 雇用形態
  availableShiftTypes: string[]; // 担当できるシフトのIDリスト
  availableDuties: DutyType[];   // 担当できる業務のリスト
  monthlyWorkDays?: number;      // 月の出勤日数上限（設定なしなら無制限）
  weeklyWorkDays?: number;       // 週の出勤日数上限（設定なしなら無制限）
  isNightOnly?: boolean;         // 夜勤専従フラグ（true なら日勤には入らない）
  nightShiftMin?: number;        // 月の夜勤最低回数（夜勤専従の場合）
  nightShiftMax?: number;        // 月の夜勤最高回数（夜勤専従の場合）
  isShortTime?: boolean;         // 短時間勤務フラグ（シフト表で I と表示）
  unavailableDow: number[];      // 出勤できない曜日（0=日曜〜6=土曜）
  tags: string[];                // 付与されたタグのIDリスト（StaffTag.id を参照）
  memo: string;                  // メモ（自由記述）
}

/**
 * シフトの種類（早番・日勤・夜勤など）の定義。
 * ShiftTypePage や defaults.ts で定義する。
 */
export interface ShiftType {
  id: string;          // 固定ID（例: 'day', 'night'）
  name: string;        // 名称（例: '日勤'）
  shortName: string;   // 略称（シフト表に表示。例: 'B'）
  startTime: string;   // 開始時刻（例: '08:30'）
  endTime: string;     // 終了時刻（例: '17:00'）
  color: string;       // 文字色（CSSカラーコード）
  bgColor: string;     // 背景色（CSSカラーコード）
  isDayShift: boolean;   // 日勤帯かどうか（true なら自動配置の対象になる）
  isNightShift: boolean; // 夜勤かどうか
  isAke: boolean;        // 明けかどうか（夜勤の翌日に自動挿入される）
  order: number;         // 表示順（小さい数が先頭）
}

/**
 * スタッフに付けるタグ（グループラベル）のマスターデータ。
 * 先にここでタグを作り、各スタッフに ID で紐づける。
 */
export interface StaffTag {
  id: string;   // 一意ID
  name: string; // タグ名（自由テキスト）
}

/**
 * ペアの相性設定。
 * 夜勤に一緒に入れたくない（NG）or 一緒に入れたい（preferred）ペアを登録する。
 */
export interface PairSetting {
  id: string;       // 一意ID
  staffId1: string; // スタッフ1のID
  staffId2: string; // スタッフ2のID
  type: PairType;   // NG か preferred か
  memo: string;     // メモ
}

/**
 * シフトの割り当て記録。
 * 「〇〇さんは2026-03-15に日勤」のような1件分のデータ。
 */
export interface ShiftAssignment {
  staffId: string;      // スタッフのID
  date: string;         // 日付（YYYY-MM-DD 形式）
  shiftTypeId: string;  // シフト種別のID（または 'off' で休み）
  isLeader: boolean;    // その日リーダーかどうか
  isManual?: boolean;   // 手動で入力したシフトか（true なら自動生成で上書きしない）
  duty?: DutyType;      // 担当業務（LD・入浴など）
}

/**
 * フロアごとのシフトルール設定。
 * SettingsPage で変更できる。
 */
export interface FloorConfig {
  floor: Floor;                                    // 対象フロア
  shiftRequirements: Record<string, number[]>;     // シフト別の曜日ごと最低必要人数（7要素の配列）
  shiftRequirementsEnabled: Record<string, boolean>; // シフト別の有効/無効フラグ（falseなら自動生成で0扱い）
  holidayShiftRequirements?: Record<string, number>; // 祝日専用の必要人数（曜日に依存しない1値）
  useHolidayRequirements?: boolean;                // 祝日専用必要人数を使うか（falseなら日曜の必要人数を流用）
  dutyRequirements: Record<Exclude<DutyType, 'onef'>, number[]>; // 業務別の曜日ごと必要人数（1Fは手入力専用で対象外）
  leaderCountPerDay: number;                       // 1日あたりのリーダー必要人数
  maxConsecutiveDays: number;                      // 最大連続出勤日数（これを超えたら休みにする）
  monthlyOffDays: number;                          // 月の公休日数の目標
}

/**
 * スタッフの特定の日へのコメント。
 * シフト表の各セルに表示できる。
 */
export interface StaffDayComment {
  staffId: string; // コメントを付けるスタッフのID
  date: string;    // 日付（YYYY-MM-DD）
  comment: string; // コメント内容
}

/**
 * アプリ全体の状態（State）。
 * AppContext.tsx で管理し、どの画面からでも参照できる。
 */
export interface AppState {
  staffList: Staff[];               // スタッフの一覧
  shiftTypes: ShiftType[];          // シフト種別の一覧
  floorConfigs: FloorConfig[];      // フロアごとの設定
  staffTags: StaffTag[];            // タグマスター一覧
  pairSettings: PairSetting[];      // ペア相性設定の一覧
  assignments: ShiftAssignment[];   // 全シフト割当データ
  staffComments: StaffDayComment[]; // スタッフへのコメント一覧
  holidays: string[];               // 祝日リスト（'YYYY-MM-DD' 形式。スケジューラーで日曜扱いにする）
  currentFloor: Floor;              // 現在表示中のフロア
  currentYear: number;              // 現在表示中の年
  currentMonth: number;             // 現在表示中の月
}
