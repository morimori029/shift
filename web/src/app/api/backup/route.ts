import { NextResponse } from 'next/server';
import { createBackup, readBackupFile } from '@/server/backup';

/** 今すぐバックアップを作成し、そのファイルをダウンロードさせる */
export async function GET() {
  const backup = await createBackup();
  const buffer = await readBackupFile(backup.filename);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(backup.filename)}`,
    },
  });
}
