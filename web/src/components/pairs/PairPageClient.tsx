'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { createPairSetting, deletePairSetting, createTagPairSetting, deleteTagPairSetting } from '@/server/actions/pairs';
import type { Staff, StaffTag, PairSetting, TagPairSetting, PairType, PairScope } from '@/types';

interface Props {
  staff: Staff[];
  tags: StaffTag[];
  initialPairs: PairSetting[];
  initialTagPairs: TagPairSetting[];
}

export default function PairPageClient({ staff: floorStaff, tags, initialPairs: floorPairs, initialTagPairs: tagPairSettings }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<'staff' | 'tag'>('staff');

  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [pairType, setPairType] = useState<PairType>('ng');
  const [scope, setScope] = useState<PairScope>('night');
  const [memo, setMemo] = useState('');

  const [t1, setT1] = useState('');
  const [t2, setT2] = useState('');
  const [tagPairType, setTagPairType] = useState<PairType>('ng');
  const [tagScope, setTagScope] = useState<PairScope>('night');
  const [tagMemo, setTagMemo] = useState('');

  const nightStaff = floorStaff.filter(s => s.availableShiftTypes.includes('night'));
  const scopeStaff = scope === 'night' ? nightStaff : scope === 'day' ? floorStaff.filter(s => s.availableShiftTypes.some(id => id !== 'night')) : floorStaff;

  const getName = (id: string) => floorStaff.find(s => s.id === id)?.name ?? '不明';
  const getTagName = (id: string) => tags.find(t => t.id === id)?.name ?? '不明';

  const addPair = async () => {
    const res = await createPairSetting({ staffId1: s1, staffId2: s2, type: pairType, scope, memo });
    if (!res.ok) { toast.show(res.error, 'error'); return; }
    setS1(''); setS2(''); setMemo(''); setScope('night');
    toast.show('ペア設定を追加しました');
    router.refresh();
  };

  const removePair = async (id: string) => {
    await deletePairSetting(id);
    router.refresh();
  };

  const addTagPair = async () => {
    const res = await createTagPairSetting({ tagId1: t1, tagId2: t2, type: tagPairType, scope: tagScope, memo: tagMemo });
    if (!res.ok) { toast.show(res.error, 'error'); return; }
    setT1(''); setT2(''); setTagMemo(''); setTagScope('night');
    toast.show('タグペア設定を追加しました');
    router.refresh();
  };

  const removeTagPair = async (id: string) => {
    await deleteTagPairSetting(id);
    router.refresh();
  };

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-slate-500 mb-4">
        夜勤・日勤のペア相性を設定します。NGペアは同じシフトに配置しません。推奨ペアは優先的に組みます。
      </p>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('staff')} className={`px-4 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${tab === 'staff' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>個別ペア</button>
        <button onClick={() => setTab('tag')} className={`px-4 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${tab === 'tag' ? 'bg-violet-500 text-white border-violet-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>タグペア</button>
      </div>

      {tab === 'tag' ? (
        <>
          <p className="text-sm text-slate-500 mb-4">タグ単位で相性を設定します。両タグに属する全スタッフの組み合わせに展開して適用されます（フロアを問わず全体に適用）。</p>
          <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
            <h3 className="text-sm font-bold mb-4">タグペア追加</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">対象</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm" value={tagScope} onChange={e => setTagScope(e.target.value as PairScope)}>
                  <option value="night">夜勤</option>
                  <option value="day">日勤</option>
                  <option value="all">両方</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">タグ1</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={t1} onChange={e => setT1(e.target.value)}>
                  <option value="">選択...</option>
                  {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="text-lg text-slate-400 pb-2">&times;</div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">タグ2</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={t2} onChange={e => setT2(e.target.value)}>
                  <option value="">選択...</option>
                  {tags.filter(t => t.id !== t1).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">種別</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm" value={tagPairType} onChange={e => setTagPairType(e.target.value as PairType)}>
                  <option value="ng">NG（組ませない）</option>
                  <option value="preferred">推奨（優先的に組む）</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">メモ</label>
                <input className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-36" placeholder="理由等" value={tagMemo} onChange={e => setTagMemo(e.target.value)} />
              </div>
              <button onClick={() => void addTagPair()} className="px-4 py-2 bg-violet-500 text-white rounded-lg text-sm font-semibold hover:bg-violet-600">追加</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 font-semibold">
                  <th className="px-4 py-2.5 text-left">タグ1</th>
                  <th className="px-4 py-2.5 text-center w-10"></th>
                  <th className="px-4 py-2.5 text-left">タグ2</th>
                  <th className="px-4 py-2.5 text-left">対象</th>
                  <th className="px-4 py-2.5 text-left">種別</th>
                  <th className="px-4 py-2.5 text-left">メモ</th>
                  <th className="px-4 py-2.5 text-left w-16">操作</th>
                </tr>
              </thead>
              <tbody>
                {tagPairSettings.map(p => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-medium">{getTagName(p.tagId1)}</td>
                    <td className="px-4 py-2.5 text-center text-slate-400">&times;</td>
                    <td className="px-4 py-2.5 font-medium">{getTagName(p.tagId2)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{p.scope === 'night' ? '夜勤' : p.scope === 'day' ? '日勤' : '両方'}</td>
                    <td className="px-4 py-2.5">
                      {p.type === 'ng' ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">NG</span> : <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">推奨</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{p.memo || '-'}</td>
                    <td className="px-4 py-2.5"><button onClick={() => void removeTagPair(p.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button></td>
                  </tr>
                ))}
                {tagPairSettings.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">タグペア設定がありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
            <h3 className="text-sm font-bold mb-4">ペア追加</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">対象</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm" value={scope} onChange={e => { setScope(e.target.value as PairScope); setS1(''); setS2(''); }}>
                  <option value="night">夜勤</option>
                  <option value="day">日勤</option>
                  <option value="all">両方</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">スタッフ1</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={s1} onChange={e => setS1(e.target.value)}>
                  <option value="">選択...</option>
                  {scopeStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="text-lg text-slate-400 pb-2">&times;</div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">スタッフ2</label>
                <select className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-40" value={s2} onChange={e => setS2(e.target.value)}>
                  <option value="">選択...</option>
                  {scopeStaff.filter(s => s.id !== s1).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
              <button onClick={() => void addPair()} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">追加</button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 font-semibold">
                  <th className="px-4 py-2.5 text-left">スタッフ1</th>
                  <th className="px-4 py-2.5 text-center w-10"></th>
                  <th className="px-4 py-2.5 text-left">スタッフ2</th>
                  <th className="px-4 py-2.5 text-left">対象</th>
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
                    <td className="px-4 py-2.5 text-xs text-slate-500">{(p.scope ?? 'night') === 'night' ? '夜勤' : p.scope === 'day' ? '日勤' : '両方'}</td>
                    <td className="px-4 py-2.5">
                      {p.type === 'ng' ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">NG</span> : <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">推奨</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{p.memo || '-'}</td>
                    <td className="px-4 py-2.5"><button onClick={() => void removePair(p.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button></td>
                  </tr>
                ))}
                {floorPairs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">ペア設定がありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
