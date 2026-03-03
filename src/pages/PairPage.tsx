/**
 * =========================================================
 * PairPage.tsx — 夜勤ペアの相性設定画面
 * =========================================================
 *
 * 管理者が「あの人とあの人を夜勤で一緒にしない（NG）」や、
 * 「新人なのでベテランと組ませる（推奨）」を指定する画面です。
 * ここで設定したルールは、シフト自動作成で考慮されます。
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';
import type { PairSetting, PairType } from '../types';
import { uid } from '../lib/defaults';

export default function PairPage() {
  const { state, dispatch } = useApp();
  const floorStaff = state.staffList.filter(s => s.floor === state.currentFloor);
  const nightStaff = floorStaff.filter(s =>
    s.availableShiftTypes.includes('night')
  );
  const floorPairs = state.pairSettings.filter(p => {
    const s1 = state.staffList.find(s => s.id === p.staffId1);
    return s1?.floor === state.currentFloor;
  });

  const toast = useToast();
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [pairType, setPairType] = useState<PairType>('ng');
  const [memo, setMemo] = useState('');

  const addPair = () => {
    if (!s1 || !s2 || s1 === s2) {
      toast.show('スタッフを正しく選択してください', 'error');
      return;
    }
    const exists = floorPairs.some(
      p => (p.staffId1 === s1 && p.staffId2 === s2) || (p.staffId1 === s2 && p.staffId2 === s1)
    );
    if (exists) { toast.show('この組み合わせは既に登録されています', 'error'); return; }
    const newPair: PairSetting = { id: uid(), staffId1: s1, staffId2: s2, type: pairType, memo };
    dispatch({ type: 'SET_PAIR_SETTINGS', pairSettings: [...state.pairSettings, newPair] });
    setS1(''); setS2(''); setMemo('');
    toast.show('ペア設定を追加しました');
  };

  const removePair = (id: string) => {
    dispatch({ type: 'SET_PAIR_SETTINGS', pairSettings: state.pairSettings.filter(p => p.id !== id) });
  };

  const getName = (id: string) => state.staffList.find(s => s.id === id)?.name ?? '不明';

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-slate-500 mb-4">
        夜勤でのペア相性を設定します。NGペアは同じ夜勤に配置しません。推奨ペアは優先的に組みます。
      </p>

      {/* Add form */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
        <h3 className="text-sm font-bold mb-4">ペア追加</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">スタッフ1</label>
            <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={s1} onChange={e => setS1(e.target.value)}>
              <option value="">選択...</option>
              {nightStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="text-lg text-slate-400 pb-2">&times;</div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">スタッフ2</label>
            <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={s2} onChange={e => setS2(e.target.value)}>
              <option value="">選択...</option>
              {nightStaff.filter(s => s.id !== s1).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">種別</label>
            <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm" value={pairType} onChange={e => setPairType(e.target.value as PairType)}>
              <option value="ng">NG（組ませない）</option>
              <option value="preferred">推奨（優先的に組む）</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">メモ</label>
            <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-36" placeholder="理由等" value={memo} onChange={e => setMemo(e.target.value)} />
          </div>
          <button onClick={addPair} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">追加</button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-500 font-semibold">
              <th className="px-4 py-2.5 text-left">スタッフ1</th>
              <th className="px-4 py-2.5 text-center w-10"></th>
              <th className="px-4 py-2.5 text-left">スタッフ2</th>
              <th className="px-4 py-2.5 text-left">種別</th>
              <th className="px-4 py-2.5 text-left">メモ</th>
              <th className="px-4 py-2.5 text-left w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {floorPairs.map(p => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium">{getName(p.staffId1)}</td>
                <td className="px-4 py-2.5 text-center text-slate-400">&times;</td>
                <td className="px-4 py-2.5 font-medium">{getName(p.staffId2)}</td>
                <td className="px-4 py-2.5">
                  {p.type === 'ng' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">NG</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">推奨</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{p.memo || '-'}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => removePair(p.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button>
                </td>
              </tr>
            ))}
            {floorPairs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">ペア設定がありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
