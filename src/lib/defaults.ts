/**
 * =========================================================
 * defaults.ts — アプリの「初期データ」と「基本設定」
 * =========================================================
 *
 * アプリを初めて開いたときや、データをリセットしたときに
 * 使われる最初のデータ（スタッフ一覧、シフトの種類など）を定義しています。
 */

import type { ShiftType, Staff, FloorConfig, PairSetting, DutyType } from '../types';

let _counter = 0;
/** ランダムで重複しないIDを作る関数（例: スタッフを追加したときのIDになる） */
export function uid(): string {
  return `${Date.now()}-${++_counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 
 * 最初から用意されているシフトの種類 
 * （ここで色や時間も決めています）
 */
export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  { id: 'early', name: '早番', shortName: 'L', startTime: '08:00', endTime: '16:30', color: '#1d4ed8', bgColor: '#dbeafe', isDayShift: true, isNightShift: false, isAke: false, order: 1 },
  { id: 'day', name: '日勤', shortName: 'B', startTime: '08:30', endTime: '17:00', color: '#065f46', bgColor: '#d1fae5', isDayShift: true, isNightShift: false, isAke: false, order: 2 },
  { id: 'late', name: '遅番', shortName: 'U', startTime: '10:30', endTime: '19:00', color: '#c2410c', bgColor: '#ffedd5', isDayShift: true, isNightShift: false, isAke: false, order: 3 },
  { id: 'night', name: '夜勤', shortName: '○', startTime: '16:30', endTime: '09:00', color: '#7c3aed', bgColor: '#e9d5ff', isDayShift: false, isNightShift: true, isAke: false, order: 4 },
  { id: 'ake', name: '明け', shortName: '×', startTime: '', endTime: '', color: '#94a3b8', bgColor: '#f1f5f9', isDayShift: false, isNightShift: false, isAke: true, order: 5 },
  { id: 'training', name: '研修', shortName: '研', startTime: '09:00', endTime: '17:00', color: '#0891b2', bgColor: '#cffafe', isDayShift: false, isNightShift: false, isAke: false, order: 6 },
  { id: 'short', name: '短時間', shortName: 'I', startTime: '09:00', endTime: '16:00', color: '#0d9488', bgColor: '#ccfbf1', isDayShift: true, isNightShift: false, isAke: false, order: 7 },
  { id: 'paid', name: '有給', shortName: '有', startTime: '', endTime: '', color: '#4338ca', bgColor: '#e0e7ff', isDayShift: false, isNightShift: false, isAke: false, order: 8 },
  { id: 'half_am', name: '午前休', shortName: 'B2', startTime: '13:00', endTime: '17:00', color: '#be185d', bgColor: '#fce7f3', isDayShift: false, isNightShift: false, isAke: false, order: 9 },
  { id: 'half_pm', name: '午後休', shortName: 'B1', startTime: '08:30', endTime: '12:30', color: '#b45309', bgColor: '#fef9c3', isDayShift: false, isNightShift: false, isAke: false, order: 10 },
];

/** 業務のリスト（LD、入浴、フロア、排泄） */
const allDuties: DutyType[] = ['ld', 'bathing', 'floor', 'toilet'];
const noDuties: DutyType[] = [];

export const DEFAULT_STAFF: Staff[] = [
  { id: uid(), name: '山田 太郎', floor: '1F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '佐藤 花子', floor: '1F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: ['ld', 'floor', 'toilet'], monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '鈴木 一郎', floor: '1F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '田中 美咲', floor: '1F', role: 'パート', availableShiftTypes: ['day', 'late'], availableDuties: ['floor', 'toilet'], monthlyWorkDays: 12, unavailableDow: [0, 6], tags: [], memo: '週3日勤務' },
  { id: uid(), name: '高橋 健一', floor: '1F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '渡辺 あかり', floor: '1F', role: 'パート', availableShiftTypes: ['day'], availableDuties: ['floor'], monthlyWorkDays: undefined, unavailableDow: [0, 6], tags: [], memo: '土日不可' },
  { id: uid(), name: '伊藤 大輔', floor: '1F', role: '派遣', availableShiftTypes: ['early', 'day', 'night'], availableDuties: ['bathing', 'floor', 'toilet'], monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '小林 さくら', floor: '1F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: ['ld', 'floor', 'toilet'], monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '中村 健太', floor: '2F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '松本 由美', floor: '2F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '加藤 翔太', floor: '2F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: allDuties, monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '吉田 恵', floor: '2F', role: 'パート', availableShiftTypes: ['day', 'late'], availableDuties: ['floor', 'toilet'], monthlyWorkDays: 15, unavailableDow: [0], tags: [], memo: '日曜不可' },
  { id: uid(), name: '木村 浩二', floor: '2F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: ['bathing', 'floor', 'toilet'], monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
  { id: uid(), name: '林 真由美', floor: '2F', role: '正社員', availableShiftTypes: ['early', 'day', 'late', 'night'], availableDuties: ['ld', 'floor', 'toilet'], monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '' },
];

/** 7日間（日〜土）すべて同じ数字を入れた配列を作る便利関数 */
function allDays(n: number): number[] { return [n, n, n, n, n, n, n]; }

/** 業務ごとの「1日に必要な人数の初期値」 */
const defaultDutyReqs = (): FloorConfig['dutyRequirements'] => ({
  ld: allDays(1),
  bathing: allDays(1),
  floor: allDays(2),
  toilet: allDays(2),
});

/** 最初から用意されているフロア設定ルール（連勤上限、人数など） */
export const DEFAULT_FLOOR_CONFIGS: FloorConfig[] = [
  { floor: '1F', shiftRequirements: { early: allDays(0), day: allDays(3), late: allDays(1), night: allDays(2), short: allDays(0) }, shiftRequirementsEnabled: { early: true, day: true, late: true, night: true, short: true }, dutyRequirements: defaultDutyReqs(), leaderCountPerDay: 1, maxConsecutiveDays: 5, monthlyOffDays: 9 },
  { floor: '2F', shiftRequirements: { early: allDays(1), day: allDays(5), late: allDays(1), night: allDays(2), short: allDays(0) }, shiftRequirementsEnabled: { early: true, day: true, late: true, night: true, short: true }, dutyRequirements: defaultDutyReqs(), leaderCountPerDay: 1, maxConsecutiveDays: 5, monthlyOffDays: 9 },
  // 非常勤: 夜勤なし・短時間メイン・シフト要件は最小構成
  { floor: '非常勤', shiftRequirements: { early: allDays(0), day: allDays(1), late: allDays(0), night: allDays(0), short: allDays(0) }, shiftRequirementsEnabled: { early: true, day: true, late: true, night: true, short: true }, dutyRequirements: { ld: allDays(0), bathing: allDays(0), floor: allDays(0), toilet: allDays(0) }, leaderCountPerDay: 0, maxConsecutiveDays: 5, monthlyOffDays: 9 },
];

export const DEFAULT_PAIR_SETTINGS: PairSetting[] = [];
