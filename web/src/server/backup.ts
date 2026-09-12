/**
 * DBファイル（SQLite）のバックアップ。
 * データベース化したので、旧アプリのJSONエクスポート/インポートに代わり、
 * DBファイルそのものを安全にコピーする方式にした。
 * better-sqlite3 の .backup() を使い、書き込み中でも安全なオンラインバックアップを取る
 * （単純な fs.copyFile だと書き込み中の一貫性が保証されない）。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveDbPath } from './dbPath';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- better-sqlite3 はCJS、Prismaのアダプタ経由で既にインストール済みのものをそのまま使う
const Database = require('better-sqlite3');

const DB_PATH = resolveDbPath();
// バックアップ先はDBファイルと同じ場所を既定にする（DATABASE_URLがデータ専用ディレクトリを
// 指していれば、コードを再配置してもバックアップはデータと一緒に残る）。
// BACKUP_DIR環境変数で明示的に上書きも可能。
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(path.dirname(DB_PATH), 'backups');
const MAX_BACKUPS = 30;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export interface BackupResult {
  filename: string;
  path: string;
  sizeBytes: number;
}

/** 今すぐバックアップを1件作成する（自動バックアップ・手動ダウンロードの両方から呼ぶ） */
export async function createBackup(): Promise<BackupResult> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const filename = `shift-backup_${timestamp()}.db`;
  const destPath = path.join(BACKUP_DIR, filename);

  const source = new Database(DB_PATH, { readonly: true });
  try {
    await source.backup(destPath);
  } finally {
    source.close();
  }

  await rotateBackups();

  const stat = await fs.stat(destPath);
  return { filename, path: destPath, sizeBytes: stat.size };
}

/** 古いバックアップを削除し、直近 MAX_BACKUPS 件だけ残す */
async function rotateBackups(): Promise<void> {
  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const backups = files.filter(f => f.startsWith('shift-backup_') && f.endsWith('.db')).sort();
  const excess = backups.length - MAX_BACKUPS;
  if (excess > 0) {
    for (const f of backups.slice(0, excess)) {
      await fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
    }
  }
}

export interface BackupInfo {
  filename: string;
  createdAt: string;
  sizeBytes: number;
}

/** バックアップ一覧（新しい順）を返す。UIでの「最終バックアップ時刻」表示用 */
export async function listBackups(): Promise<BackupInfo[]> {
  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const backups = files.filter(f => f.startsWith('shift-backup_') && f.endsWith('.db'));
  const infos = await Promise.all(
    backups.map(async f => {
      const stat = await fs.stat(path.join(BACKUP_DIR, f));
      return { filename: f, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size };
    })
  );
  return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readBackupFile(filename: string): Promise<Buffer> {
  const safeName = path.basename(filename); // パストラバーサル対策
  return fs.readFile(path.join(BACKUP_DIR, safeName));
}
