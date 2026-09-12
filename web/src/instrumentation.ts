/**
 * サーバー起動時に1回だけ呼ばれるNext.jsのフック。
 * ここでDBファイルの自動バックアップを定期実行するタイマーを仕込む
 * （旧アプリのブラウザ内3分毎バックアップに代わる、サーバー側の定期バックアップ）。
 */
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6時間ごと

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const g = globalThis as unknown as { __backupTimerStarted?: boolean };
  if (g.__backupTimerStarted) return; // 開発モードの再読み込み等での多重起動を防ぐ
  g.__backupTimerStarted = true;

  const { createBackup } = await import('@/server/backup');

  const runBackup = () => {
    createBackup().catch(err => console.error('[auto-backup] failed:', err));
  };

  // 起動直後にも1回実行しておく
  runBackup();
  setInterval(runBackup, BACKUP_INTERVAL_MS);
}
