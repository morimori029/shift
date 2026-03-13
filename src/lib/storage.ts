const STORAGE_KEY = 'shift-app-data';
const BACKUP_KEY = 'shift-app-backup';
const BACKUP_TIME_KEY = 'shift-app-backup-time';
const BACKUP_INTERVAL = 5 * 60 * 1000; // 5分間隔

export function loadData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveData<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${key}`, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`localStorage save failed for key "${key}":`, e);
    return false;
  }
}

/** 自動バックアップ: state全体をlocalStorageの別キーに保存 */
export function saveAutoBackup(state: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
    const now = new Date().toISOString();
    localStorage.setItem(BACKUP_TIME_KEY, now);
    return true;
  } catch {
    return false;
  }
}

/** 最終バックアップ時刻を取得 */
export function getLastBackupTime(): string | null {
  return localStorage.getItem(BACKUP_TIME_KEY);
}

/** バックアップをJSONファイルとしてダウンロード */
export function downloadBackup(): boolean {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return false;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    a.download = `シフト自動バックアップ_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export { BACKUP_INTERVAL };
