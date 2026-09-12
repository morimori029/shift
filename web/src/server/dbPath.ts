import path from 'node:path';

/** DATABASE_URL（'file:./dev.db' 等）から実際のファイルパスを解決する。db.ts・backup.ts で共有 */
export function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? 'file:./dev.db';
  const rel = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  return path.isAbsolute(rel) ? rel : path.resolve(/* turbopackIgnore: true */ process.cwd(), rel);
}
