'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importLegacyBackup, type ImportResult } from '@/server/actions/importData';

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (!confirm('現在のデータベースの内容は全て置き換えられます。続けますか？')) return;

    setBusy(true);
    setResult(null);
    const formData = new FormData();
    formData.set('file', file);
    const res = await importLegacyBackup(formData);
    setBusy(false);
    setResult(res);
    if (res.ok) router.refresh();
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-base font-bold mb-2">旧アプリのデータを取り込む</h3>
        <p className="text-sm text-slate-500 mb-4">
          旧シフト管理アプリ（ブラウザ版）の「データ保存（書き出し）」または「自動バックアップ」でダウンロードしたJSONファイルを選択してください。
          <br />
          <span className="text-red-600 font-semibold">取り込むと、現在このアプリに保存されているデータは全て置き換えられます。</span>
        </p>

        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".json" className="text-sm" />
          <button
            onClick={() => void handleImport()}
            disabled={busy}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '取り込み中...' : '取り込む'}
          </button>
        </div>

        {result && (
          <div className={`mt-5 p-4 rounded-lg text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {result.ok ? (
              <>
                <p className="font-semibold mb-2">取り込み完了</p>
                <ul className="space-y-0.5 text-xs">
                  <li>スタッフ: {result.counts.staff}件</li>
                  <li>シフト種別: {result.counts.shiftTypes}件</li>
                  <li>フロア設定: {result.counts.floorConfigs}件</li>
                  <li>シフト割当: {result.counts.assignments}件</li>
                  <li>ペア設定: {result.counts.pairSettings}件</li>
                  <li>祝日: {result.counts.holidays}件</li>
                </ul>
                {result.warnings.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-emerald-200">
                    <p className="font-semibold text-amber-700 mb-1">確認事項 {result.warnings.length}件</p>
                    <ul className="space-y-0.5 text-xs text-amber-700">
                      {result.warnings.map((w, i) => <li key={i}>・{w}</li>)}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
