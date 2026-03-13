/**
 * =========================================================
 * dataIO.ts — データの保存（エクスポート）と読み込み（インポート）
 * =========================================================
 *
 * アプリのデータを JSON ファイルとして保存したり、
 * 保存したファイルを読み込んで復元したりする機能を持ちます。
 *
 * 使い方:
 *   exportAppData(state) → ブラウザにダウンロードさせる
 *   importAppData(file)  → ファイルを読み込んで AppState を返す
 */

import type { AppState, Staff, DutyType } from '../types';
import { ALL_DUTIES } from '../types';

/** エクスポートする対象のデータキー（これ以外は保存しない） */
const EXPORT_KEYS = [
  'staffList', 'shiftTypes', 'floorConfigs', 'staffTags', 'pairSettings',
  'assignments', 'staffComments', 'holidays',
] as const;

/**
 * 必須ではなく省略可能なキー（旧バージョンのJSONには含まれていない場合がある）
 * これらが存在しない場合はデフォルト値で代替する
 */
const OPTIONAL_KEYS = new Set(['holidays', 'staffTags']);

/**
 * JSON ファイルに保存するデータの形式。
 * `_format` と `_version` は「このファイルがシフトアプリのものか」を判別するために使う。
 */
interface ExportData {
  _format: 'shift-app-backup';   // ファイルの種類を示す目印
  _version: 1;                   // データフォーマットのバージョン
  _exportedAt: string;           // 書き出した日時（ISO 形式）
  staffList: AppState['staffList'];
  shiftTypes: AppState['shiftTypes'];
  floorConfigs: AppState['floorConfigs'];
  staffTags?: AppState['staffTags'];
  pairSettings: AppState['pairSettings'];
  assignments: AppState['assignments'];
  staffComments: AppState['staffComments'];
}

/**
 * アプリのデータを JSON ファイルとしてダウンロードする。
 *
 * 仕組み:
 * 1. state からデータを取り出して JSON 文字列にする
 * 2. それを「Blob（バイナリデータの塊）」に変換
 * 3. 一時的な URL を作ってリンクをクリックするように動かし、ダウンロードを発生させる
 */
export function exportAppData(state: AppState): void {
  const data: ExportData = {
    _format: 'shift-app-backup',
    _version: 1,
    _exportedAt: new Date().toISOString(), // 現在の日時
    staffList: state.staffList,
    shiftTypes: state.shiftTypes,
    floorConfigs: state.floorConfigs,
    staffTags: state.staffTags,
    pairSettings: state.pairSettings,
    assignments: state.assignments,
    staffComments: state.staffComments,
  };

  // JSON 文字列に変換（見やすく 2スペースインデント）
  const json = JSON.stringify(data, null, 2);

  // ブラウザにファイルをダウンロードさせる
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);           // 一時 URL を作る
  const a = document.createElement('a');           // 仮のリンク要素を作る
  a.href = url;

  // ファイル名に今日の日付を入れる（例: シフトデータ_20260225.json）
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  a.download = `シフトデータ_${ts}.json`;
  a.click();                   // リンクをプログラムからクリックしてダウンロード開始
  URL.revokeObjectURL(url);    // 一時 URL を解放（メモリ節約）
}

/**
 * インポートデータの形状を検証する。
 * 不正なデータがそのまま state に入ることでアプリがクラッシュするのを防ぐ。
 * エラーがあれば理由メッセージを返し、問題なければ null を返す。
 */
function validateImportData(data: Record<string, unknown>): string | null {
  // staffList: 配列で各要素に id/name/floor が必要
  if (!Array.isArray(data.staffList)) return 'staffList が配列ではありません';
  for (const s of data.staffList) {
    if (typeof s !== 'object' || s === null) return 'staffList の要素がオブジェクトではありません';
    const staff = s as Record<string, unknown>;
    if (typeof staff.id !== 'string') return 'スタッフに id がありません';
    if (typeof staff.name !== 'string') return 'スタッフに name がありません';
    if (typeof staff.floor !== 'string') return 'スタッフに floor がありません';
  }

  // shiftTypes: 配列で各要素に id/name が必要
  if (!Array.isArray(data.shiftTypes)) return 'shiftTypes が配列ではありません';
  for (const st of data.shiftTypes) {
    if (typeof st !== 'object' || st === null) return 'shiftTypes の要素がオブジェクトではありません';
    const shiftType = st as Record<string, unknown>;
    if (typeof shiftType.id !== 'string') return 'シフト種別に id がありません';
    if (typeof shiftType.name !== 'string') return 'シフト種別に name がありません';
  }

  // floorConfigs: 配列で各要素に floor/shiftRequirements が必要
  if (!Array.isArray(data.floorConfigs)) return 'floorConfigs が配列ではありません';
  for (const fc of data.floorConfigs) {
    if (typeof fc !== 'object' || fc === null) return 'floorConfigs の要素がオブジェクトではありません';
    const config = fc as Record<string, unknown>;
    if (typeof config.floor !== 'string') return 'フロア設定に floor がありません';
    if (typeof config.shiftRequirements !== 'object' || config.shiftRequirements === null) {
      return 'フロア設定に shiftRequirements がありません';
    }
  }

  // pairSettings: 配列であること
  if (!Array.isArray(data.pairSettings)) return 'pairSettings が配列ではありません';

  // assignments: 配列で各要素に staffId/date/shiftTypeId が必要
  if (!Array.isArray(data.assignments)) return 'assignments が配列ではありません';
  for (const a of data.assignments) {
    if (typeof a !== 'object' || a === null) return 'assignments の要素がオブジェクトではありません';
    const assignment = a as Record<string, unknown>;
    if (typeof assignment.staffId !== 'string') return 'シフト割当に staffId がありません';
    if (typeof assignment.date !== 'string') return 'シフト割当に date がありません';
    if (typeof assignment.shiftTypeId !== 'string') return 'シフト割当に shiftTypeId がありません';
  }

  // staffComments: 配列であること
  if (!Array.isArray(data.staffComments)) return 'staffComments が配列ではありません';

  // holidays: 配列であること（存在しない場合は空配列扱いで許可）
  if ('holidays' in data && !Array.isArray(data.holidays)) return 'holidays が配列ではありません';

  return null;
}

/**
 * クロスリファレンスの整合性をチェックする（警告レベル）。
 * 不整合のあるデータを除去して返す。
 */
function sanitizeCrossReferences(
  result: Omit<AppState, 'currentFloor' | 'currentYear' | 'currentMonth'>
): { data: typeof result; warnings: string[] } {
  const warnings: string[] = [];
  const staffIds = new Set(result.staffList.map(s => s.id));
  const shiftTypeIds = new Set(result.shiftTypes.map(st => st.id));
  const specialShiftIds = new Set(['off', 'paid']);

  // assignments: 存在しないスタッフ/シフト種別を除去
  const validAssignments = result.assignments.filter(a => {
    if (!staffIds.has(a.staffId)) {
      warnings.push(`割当: 存在しないスタッフID "${a.staffId}" を除去`);
      return false;
    }
    if (!specialShiftIds.has(a.shiftTypeId) && !shiftTypeIds.has(a.shiftTypeId)) {
      warnings.push(`割当: 存在しないシフト種別 "${a.shiftTypeId}" を除去`);
      return false;
    }
    return true;
  });

  // pairSettings: 存在しないスタッフを参照するペア設定を除去
  const validPairs = result.pairSettings.filter(p => {
    if (!staffIds.has(p.staffId1) || !staffIds.has(p.staffId2)) {
      warnings.push(`ペア設定: 存在しないスタッフを参照するペアを除去`);
      return false;
    }
    return true;
  });

  // staffComments: 存在しないスタッフのコメントを除去
  const validComments = result.staffComments.filter(c => {
    if (!staffIds.has(c.staffId)) return false;
    return true;
  });

  return {
    data: { ...result, assignments: validAssignments, pairSettings: validPairs, staffComments: validComments },
    warnings,
  };
}

/**
 * インポートされたスタッフデータに不足フィールドを補完する（マイグレーション）。
 */
function migrateImportedStaff(staffList: AppState['staffList']): AppState['staffList'] {
  return staffList.map(s => {
    const migrated = { ...s } as Staff & { canLead?: boolean };
    if (!Array.isArray(migrated.availableDuties)) {
      const duties: DutyType[] = migrated.canLead ? ['ld', 'floor', 'toilet'] : ['floor', 'toilet'];
      migrated.availableDuties = duties;
    }
    if (!Array.isArray(migrated.availableShiftTypes)) {
      migrated.availableShiftTypes = [];
    }
    if (!Array.isArray(migrated.unavailableDow)) {
      migrated.unavailableDow = [];
    }
    if (!Array.isArray((migrated as Staff & { tags?: string[] }).tags)) {
      (migrated as Staff & { tags: string[] }).tags = [];
    }
    if (typeof migrated.memo !== 'string') {
      (migrated as Staff).memo = '';
    }
    delete migrated.canLead;
    return migrated as Staff;
  });
}

/**
 * インポートされたフロア設定に不足フィールドを補完する（マイグレーション）。
 */
function migrateImportedFloorConfigs(configs: AppState['floorConfigs']): AppState['floorConfigs'] {
  return configs.map(fc => {
    const reqs = { ...fc.shiftRequirements } as Record<string, number | number[]>;
    for (const key of Object.keys(reqs)) {
      const val = reqs[key];
      if (typeof val === 'number') {
        reqs[key] = [val, val, val, val, val, val, val];
      }
    }
    const enabled = { ...(fc.shiftRequirementsEnabled ?? {}) } as Record<string, boolean>;
    for (const key of Object.keys(reqs)) {
      if (!(key in enabled)) enabled[key] = true;
    }
    const dutyReqs = { ...(fc.dutyRequirements ?? {}) } as Record<string, number | number[]>;
    for (const d of ALL_DUTIES) {
      if (!(d in dutyReqs)) {
        dutyReqs[d] = [0, 0, 0, 0, 0, 0, 0];
      } else if (typeof dutyReqs[d] === 'number') {
        const v = dutyReqs[d] as number;
        dutyReqs[d] = [v, v, v, v, v, v, v];
      }
    }
    return {
      ...fc,
      shiftRequirements: reqs as Record<string, number[]>,
      shiftRequirementsEnabled: enabled,
      dutyRequirements: dutyReqs as Record<Exclude<DutyType, 'onef'>, number[]>,
    };
  });
}

/**
 * JSON ファイルを読み込んでアプリのデータに変換する。
 *
 * Promise を返す非同期関数。
 * 読み込みに成功したら resolve(data)、失敗なら reject(error) が呼ばれる。
 *
 * チェック内容:
 * - `_format` が正しいか（シフトアプリのファイルかどうか）
 * - 必要なキーが全て含まれているか
 * - 各配列・オブジェクトの形状が正しいか
 */
type ImportResult = {
  data: Omit<AppState, 'currentFloor' | 'currentYear' | 'currentMonth'>;
  warnings: string[];
};

export function importAppData(file: File): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); // ブラウザ標準のファイル読み込み機能

    reader.onload = () => {
      try {
        // 読み込んだテキストを JavaScript オブジェクトに変換
        const data = JSON.parse(reader.result as string) as Record<string, unknown>;

        // シフトアプリのファイルかチェック
        if (data._format !== 'shift-app-backup') {
          reject(new Error('このファイルはシフトアプリのデータではありません'));
          return;
        }

        // 必要なデータキーが全て含まれているかチェック（省略可能キーはスキップ）
        for (const key of EXPORT_KEYS) {
          if (OPTIONAL_KEYS.has(key)) continue; // 省略可能キーはなくてもOK
          if (!(key in data)) {
            reject(new Error(`データに「${key}」が含まれていません`));
            return;
          }
        }

        // 各フィールドの形状を検証
        const validationError = validateImportData(data);
        if (validationError) {
          reject(new Error(`データの形式が正しくありません: ${validationError}`));
          return;
        }

        // マイグレーション適用（旧バージョンの不足フィールドを補完）
        const rawResult = {
          staffList: migrateImportedStaff(data.staffList as AppState['staffList']),
          shiftTypes: data.shiftTypes as AppState['shiftTypes'],
          floorConfigs: migrateImportedFloorConfigs(data.floorConfigs as AppState['floorConfigs']),
          staffTags: (Array.isArray(data.staffTags) ? data.staffTags : []) as AppState['staffTags'],
          pairSettings: data.pairSettings as AppState['pairSettings'],
          assignments: data.assignments as AppState['assignments'],
          staffComments: data.staffComments as AppState['staffComments'],
          holidays: (Array.isArray(data.holidays) ? data.holidays : []) as string[],
        };

        // クロスリファレンス検証（不整合データを除去して警告を返す）
        const { data: sanitized, warnings } = sanitizeCrossReferences(rawResult);
        resolve({ data: sanitized, warnings });
      } catch {
        reject(new Error('ファイルの読み込みに失敗しました'));
      }
    };

    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file); // ファイルをテキストとして読み始める
  });
}
