/**
 * =========================================================
 * AppContext.tsx — アプリ全体の状態（データ）を管理する場所
 * =========================================================
 *
 * React の「Context」という機能を使って、アプリのどこからでも
 * スタッフの一覧やシフトの設定にアクセスできるようにしています。
 * ここでデータが更新されると、自動的に画面にも反映されます。
 */

import { createContext, useContext, useReducer, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useToast } from '../components/Toast';
import type { AppState, Staff, ShiftType, FloorConfig, PairSetting, ShiftAssignment, StaffDayComment, StaffTag, Floor, DutyType } from '../types';
import { ALL_DUTIES } from '../types';
import { DEFAULT_SHIFT_TYPES, DEFAULT_STAFF, DEFAULT_FLOOR_CONFIGS, DEFAULT_PAIR_SETTINGS } from '../lib/defaults';
import { loadData, saveData, saveAutoBackup, BACKUP_INTERVAL } from '../lib/storage';

const now = new Date();

function migrateShiftTypes(loaded: ShiftType[]): ShiftType[] {
  const defaultMap = new Map(DEFAULT_SHIFT_TYPES.map(st => [st.id, st]));
  const migrated = loaded.map(st => {
    const def = defaultMap.get(st.id);
    if (def && st.shortName !== def.shortName) {
      return { ...st, shortName: def.shortName };
    }
    return st;
  });
  const ids = new Set(migrated.map(st => st.id));
  const missing = DEFAULT_SHIFT_TYPES.filter(st => !ids.has(st.id));
  return missing.length > 0 ? [...migrated, ...missing] : migrated;
}

function migrateStaff(loaded: Staff[]): Staff[] {
  if (!Array.isArray(loaded)) return [];
  return loaded.map(s => {
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
    delete migrated.canLead;
    return migrated as Staff;
  });
}

function migrateFloorConfigs(loaded: FloorConfig[]): FloorConfig[] {
  // DEFAULT_SHIFT_TYPES のうち isDayShift なシフトが shiftRequirements に存在しない場合は 0 で補完
  const defaultDayShiftIds = DEFAULT_SHIFT_TYPES.filter(st => st.isDayShift).map(st => st.id);

  const migrated = loaded.map(fc => {
    const reqs = { ...fc.shiftRequirements } as Record<string, number | number[]>;
    for (const key of Object.keys(reqs)) {
      const val = reqs[key];
      if (typeof val === 'number') {
        reqs[key] = [val, val, val, val, val, val, val];
      }
    }
    // 欠落している日勤シフトを 0 で補完
    for (const id of defaultDayShiftIds) {
      if (!(id in reqs)) {
        reqs[id] = [0, 0, 0, 0, 0, 0, 0];
      }
    }

    // shiftRequirementsEnabled: 未設定の場合は全シフトを有効（true）で補完
    const enabled = { ...(fc.shiftRequirementsEnabled ?? {}) } as Record<string, boolean>;
    for (const key of Object.keys(reqs)) {
      if (!(key in enabled)) {
        enabled[key] = true;
      }
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

  // 既存データに存在しないフロア設定を DEFAULT から補完（後方互換）
  const existingFloors = new Set(migrated.map(fc => fc.floor));
  for (const def of DEFAULT_FLOOR_CONFIGS) {
    if (!existingFloors.has(def.floor)) {
      migrated.push(def);
    }
  }

  return migrated;
}

/**
 * 初期状態を作る
 * ブラウザに保存されているデータ（loadData）があればそれを使い、
 * なければ defaults.ts の初期データ（DEFAULT_STAFFなど）を使う。
 */
const initialState: AppState = {
  staffList: migrateStaff(loadData('staffList', DEFAULT_STAFF)),
  shiftTypes: migrateShiftTypes(loadData('shiftTypes', DEFAULT_SHIFT_TYPES)),
  floorConfigs: migrateFloorConfigs(loadData('floorConfigs', DEFAULT_FLOOR_CONFIGS)),
  staffTags: loadData('staffTags', [] as StaffTag[]),
  pairSettings: loadData('pairSettings', DEFAULT_PAIR_SETTINGS),
  assignments: loadData('assignments', [] as ShiftAssignment[]),
  staffComments: loadData('staffComments', [] as StaffDayComment[]),
  holidays: loadData('holidays', [] as string[]),
  currentFloor: '1F',
  currentYear: now.getFullYear(),
  currentMonth: now.getMonth() + 1,
};

/**
 * データを変更するための「指示書（Action）」の一覧
 * 例: { type: 'SET_FLOOR', floor: '2F' } という指示を送ると、フロアが2Fに切り替わる
 */
type Action =
  | { type: 'SET_FLOOR'; floor: Floor }
  | { type: 'SET_MONTH'; year: number; month: number }
  | { type: 'SET_STAFF_LIST'; staffList: Staff[] }
  | { type: 'SET_SHIFT_TYPES'; shiftTypes: ShiftType[] }
  | { type: 'SET_FLOOR_CONFIGS'; floorConfigs: FloorConfig[] }
  | { type: 'SET_STAFF_TAGS'; staffTags: StaffTag[] }
  | { type: 'SET_PAIR_SETTINGS'; pairSettings: PairSetting[] }
  | { type: 'SET_ASSIGNMENTS'; assignments: ShiftAssignment[] }
  | { type: 'SET_STAFF_COMMENTS'; staffComments: StaffDayComment[] }
  | { type: 'SET_HOLIDAYS'; holidays: string[] }
  | { type: 'DELETE_SHIFT_TYPE'; shiftTypeId: string }
  /** スタッフ削除（割当・コメント・ペア設定を一括でカスケード削除） */
  | { type: 'DELETE_STAFF'; staffId: string }
  /** 古いシフトデータの剤除（24ヶ月前より古い assignments / staffComments） */
  | { type: 'PURGE_OLD_DATA'; cutoffYearMonth: string }
  | { type: 'RESTORE_ALL'; payload: Omit<AppState, 'currentFloor' | 'currentYear' | 'currentMonth'> };

/**
 * 指示（Action）を受け取って、実際にデータ（State）を新しく作り直す関数
 * React はここのデータが新しくなったことを検知して画面を書き換えます。
 */
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_FLOOR': return { ...state, currentFloor: action.floor };
    case 'SET_MONTH': return { ...state, currentYear: action.year, currentMonth: action.month };
    case 'SET_STAFF_LIST': return { ...state, staffList: action.staffList };
    case 'SET_SHIFT_TYPES': return { ...state, shiftTypes: action.shiftTypes };
    case 'SET_FLOOR_CONFIGS': return { ...state, floorConfigs: action.floorConfigs };
    case 'SET_STAFF_TAGS': return { ...state, staffTags: action.staffTags };
    case 'SET_PAIR_SETTINGS': return { ...state, pairSettings: action.pairSettings };
    case 'SET_ASSIGNMENTS': return { ...state, assignments: action.assignments };
    case 'SET_STAFF_COMMENTS': return { ...state, staffComments: action.staffComments };
    case 'SET_HOLIDAYS': return { ...state, holidays: action.holidays };
    case 'RESTORE_ALL': return { ...state, ...action.payload };
    // 古いデータ剤除: cutoffYearMonth（例:"2024-02"）より前のデータを削除
    case 'PURGE_OLD_DATA': {
      const cutoff = action.cutoffYearMonth;
      return {
        ...state,
        assignments: state.assignments.filter(a => a.date.slice(0, 7) >= cutoff),
        staffComments: state.staffComments.filter(c => c.date.slice(0, 7) >= cutoff),
      };
    }
    // スタッフ削除: 関連する全データを1ステップで削除する（原子的）
    case 'DELETE_STAFF': {
      const id = action.staffId;
      return {
        ...state,
        staffList: state.staffList.filter(s => s.id !== id),
        pairSettings: state.pairSettings.filter(p => p.staffId1 !== id && p.staffId2 !== id),
        assignments: state.assignments.filter(a => a.staffId !== id),
        staffComments: state.staffComments.filter(c => c.staffId !== id),
      };
    }
    case 'DELETE_SHIFT_TYPE': {
      const sid = action.shiftTypeId;
      // 削除後に勤務可能シフトが空になるスタッフがいる場合は削除を中止
      const affectedStaff = state.staffList.filter(
        s => s.availableShiftTypes.includes(sid) && s.availableShiftTypes.length === 1
      );
      if (affectedStaff.length > 0) {
        console.warn(`シフト種別削除を中止: ${affectedStaff.map(s => s.name).join(', ')} の勤務可能種別が空になります`);
        return state;
      }
      return {
        ...state,
        shiftTypes: state.shiftTypes.filter(st => st.id !== sid),
        staffList: state.staffList.map(s => ({
          ...s,
          availableShiftTypes: s.availableShiftTypes.filter(id => id !== sid),
        })),
        assignments: state.assignments.filter(a => a.shiftTypeId !== sid),
        floorConfigs: state.floorConfigs.map(fc => {
          const reqs = { ...fc.shiftRequirements };
          delete reqs[sid];
          return { ...fc, shiftRequirements: reqs };
        }),
      };
    }
    default: return state;
  }
}

/** Undo 対象外のアクション（画面切替はデータ変更ではないので戻さない） */
const NON_UNDOABLE_ACTIONS = new Set(['SET_FLOOR', 'SET_MONTH']);

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  undo: () => void;
  canUndo: boolean;
}

/** 実際にデータを配るための「管（パイプ）」のようなもの */
const AppContext = createContext<AppContextValue | null>(null);

/**
 * アプリ全体をこのコンポーネントで囲むことで、
 * 囲まれた中のすべての画面で state（データ）や dispatch（指示を出す関数）を使えるようにする。
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const toast = useToast();
  const saveErrorShown = useRef(false);
  const undoStack = useRef<AppState[]>([]);
  const MAX_UNDO = 10;

  /** dispatch をラップし、データ変更時のみ undo スタックに積む */
  const wrappedDispatch = useCallback((action: Action) => {
    if (!NON_UNDOABLE_ACTIONS.has(action.type)) {
      undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), state];
    }
    dispatch(action);
  }, [state]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    dispatch({ type: 'RESTORE_ALL', payload: prev });
    // RESTORE_ALL で currentFloor/Year/Month は上書きされないが、
    // undo 後は元の画面位置を保持したいのでそれで OK
    toast.show('操作を元に戻しました', 'info');
  }, [toast]);

  const canUndo = undoStack.current.length > 0;

  // データが変わるたびにブラウザ（LocalStorage）に自動保存する
  const safeSave = (key: string, data: unknown) => {
    if (!saveData(key, data) && !saveErrorShown.current) {
      saveErrorShown.current = true;
      toast.show('ストレージの保存に失敗しました。空き容量を確認してください', 'error');
      setTimeout(() => { saveErrorShown.current = false; }, 10000);
    }
  };
  useEffect(() => { safeSave('staffList', state.staffList); }, [state.staffList]);
  useEffect(() => { safeSave('shiftTypes', state.shiftTypes); }, [state.shiftTypes]);
  useEffect(() => { safeSave('floorConfigs', state.floorConfigs); }, [state.floorConfigs]);
  useEffect(() => { safeSave('staffTags', state.staffTags); }, [state.staffTags]);
  useEffect(() => { safeSave('pairSettings', state.pairSettings); }, [state.pairSettings]);
  useEffect(() => { safeSave('assignments', state.assignments); }, [state.assignments]);
  useEffect(() => { safeSave('staffComments', state.staffComments); }, [state.staffComments]);
  useEffect(() => { safeSave('holidays', state.holidays); }, [state.holidays]);

  // 定期自動バックアップ（5分ごと）
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      saveAutoBackup({
        _format: 'shift-app-backup',
        _version: 1,
        _exportedAt: new Date().toISOString(),
        staffList: s.staffList,
        shiftTypes: s.shiftTypes,
        floorConfigs: s.floorConfigs,
        staffTags: s.staffTags,
        pairSettings: s.pairSettings,
        assignments: s.assignments,
        staffComments: s.staffComments,
        holidays: s.holidays,
      });
    }, BACKUP_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return <AppContext.Provider value={{ state, dispatch: wrappedDispatch, undo, canUndo }}>{children}</AppContext.Provider>;
}

/**
 * 他のファイルからデータを使いたいときに呼ぶ便利な魔法のフック。
 * 使い方: const { state, dispatch } = useApp();
 */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
