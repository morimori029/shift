'use server';

import { createBackup, listBackups, type BackupInfo } from '@/server/backup';

export async function getBackupStatus(): Promise<{ latest: BackupInfo | null; count: number }> {
  const backups = await listBackups();
  return { latest: backups[0] ?? null, count: backups.length };
}

/** 「今すぐバックアップ」ボタン用（ダウンロードはせず、サーバー上に1件作成するだけ） */
export async function runBackupNow(): Promise<BackupInfo> {
  const result = await createBackup();
  return { filename: result.filename, createdAt: new Date().toISOString(), sizeBytes: result.sizeBytes };
}
