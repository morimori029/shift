/**
 * =========================================================
 * StaffPage.tsx — スタッフ一覧・登録・編集画面
 * =========================================================
 *
 * 管理者がスタッフの情報を入力する画面です。
 * ここで登録した「できるシフト」「できる業務」「出勤できない曜日」などが、
 * シフト自動作成のときのルール（条件）として使われます。
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';
import type { Staff, StaffTag, RoleType, DutyType } from '../types';
import { DUTY_LABELS, ALL_DUTIES } from '../types';
import { uid } from '../lib/defaults';

const ROLE_COLORS: Record<RoleType, string> = {
  '正社員': 'bg-blue-100 text-blue-800',
  'パート': 'bg-amber-100 text-amber-800',
  '派遣': 'bg-indigo-100 text-indigo-800',
};

const DUTY_COLORS: Record<DutyType, string> = {
  ld: 'border-amber-400 bg-amber-50 text-amber-700',
  bathing: 'border-cyan-400 bg-cyan-50 text-cyan-700',
  floor: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  toilet: 'border-violet-400 bg-violet-50 text-violet-700',
  onef: 'border-slate-400 bg-slate-100 text-slate-700',
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export default function StaffPage() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  // #4: DnD 並び替え用の state
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragSrcId = useState<string | null>(null);

  const floorStaff = state.staffList.filter(s => s.floor === state.currentFloor);
  const shiftTypes = state.shiftTypes.filter(st => !st.isAke);

  const openNew = () => {
    setIsNew(true);
    setEditing({
      id: uid(), name: '', floor: state.currentFloor, role: '正社員',
      availableShiftTypes: shiftTypes.map(s => s.id),
      availableDuties: [...ALL_DUTIES],
      monthlyWorkDays: undefined, unavailableDow: [], tags: [], memo: '',
    });
  };

  const openEdit = (s: Staff) => {
    setIsNew(false);
    setEditing({ ...s });
  };

  // タグマスター: 新規タグを追加
  const addTagMaster = () => {
    const name = newTagName.trim();
    if (!name) return;
    if (state.staffTags.some(t => t.name === name)) { setNewTagName(''); return; }
    const newTag: StaffTag = { id: uid(), name };
    dispatch({ type: 'SET_STAFF_TAGS', staffTags: [...state.staffTags, newTag] });
    setNewTagName('');
  };

  // タグマスター: タグを削除（スタッフへの紐づけも一括削除）
  const removeTagMaster = (tagId: string) => {
    dispatch({ type: 'SET_STAFF_TAGS', staffTags: state.staffTags.filter(t => t.id !== tagId) });
    dispatch({
      type: 'SET_STAFF_LIST',
      staffList: state.staffList.map(s => ({ ...s, tags: s.tags.filter(id => id !== tagId) })),
    });
  };

  // スタッフ編集モーダル: タグのトグル
  const toggleTag = (tagId: string) => {
    if (!editing) return;
    const has = editing.tags.includes(tagId);
    setEditing({ ...editing, tags: has ? editing.tags.filter(id => id !== tagId) : [...editing.tags, tagId] });
  };

  const save = () => {
    if (!editing || !editing.name.trim()) {
      toast.show('氏名を入力してください', 'error');
      return;
    }
    if (editing.availableShiftTypes.length === 0) {
      toast.show('勤務可能種別を1つ以上選択してください', 'error');
      return;
    }
    if (editing.monthlyWorkDays !== undefined && editing.monthlyWorkDays < 1) {
      toast.show('月の勤務上限は1以上で入力してください', 'error');
      return;
    }
    const list = isNew
      ? [...state.staffList, editing]
      : state.staffList.map(s => s.id === editing.id ? editing : s);
    dispatch({ type: 'SET_STAFF_LIST', staffList: list });
    setEditing(null);
    toast.show(isNew ? `${editing.name} を追加しました` : `${editing.name} を更新しました`);
  };

  const remove = (id: string) => {
    const target = state.staffList.find(s => s.id === id);
    if (!target || !confirm(`${target.name} を削除しますか？\n関連するシフト・相性設定・コメントも削除されます。`)) return;
    // DELETE_STAFF で スタッフ・割当・ペア設定・コメントを一括削除（原子的）
    dispatch({ type: 'DELETE_STAFF', staffId: id });
    toast.show(`${target.name} を削除しました`);
  };

  // #4: ドラッグ&ドロップで並び替えるハンドラ
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('staffId', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const srcId = e.dataTransfer.getData('staffId');
    if (!srcId || srcId === targetId) return;
    const list = [...state.staffList];
    const srcIdx = list.findIndex(s => s.id === srcId);
    const tgtIdx = list.findIndex(s => s.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    // srcを取り出してtgtの位置に挿入
    const [removed] = list.splice(srcIdx, 1);
    list.splice(tgtIdx, 0, removed);
    dispatch({ type: 'SET_STAFF_LIST', staffList: list });
  };

  const moveStaff = (id: string, direction: -1 | 1) => {
    const list = [...state.staffList];
    const floorIds = list.filter(s => s.floor === state.currentFloor).map(s => s.id);
    const posInFloor = floorIds.indexOf(id);
    const targetPosInFloor = posInFloor + direction;
    if (targetPosInFloor < 0 || targetPosInFloor >= floorIds.length) return;

    const globalIdx = list.findIndex(s => s.id === id);
    const swapId = floorIds[targetPosInFloor];
    const swapGlobalIdx = list.findIndex(s => s.id === swapId);

    [list[globalIdx], list[swapGlobalIdx]] = [list[swapGlobalIdx], list[globalIdx]];
    dispatch({ type: 'SET_STAFF_LIST', staffList: list });
  };

  const toggleShiftType = (stId: string) => {
    if (!editing) return;
    const has = editing.availableShiftTypes.includes(stId);
    setEditing({
      ...editing,
      availableShiftTypes: has
        ? editing.availableShiftTypes.filter(x => x !== stId)
        : [...editing.availableShiftTypes, stId],
    });
  };

  const toggleDuty = (duty: DutyType) => {
    if (!editing) return;
    const has = editing.availableDuties.includes(duty);
    setEditing({
      ...editing,
      availableDuties: has
        ? editing.availableDuties.filter(x => x !== duty)
        : [...editing.availableDuties, duty],
    });
  };

  const toggleDow = (dow: number) => {
    if (!editing) return;
    const has = editing.unavailableDow.includes(dow);
    setEditing({
      ...editing,
      unavailableDow: has
        ? editing.unavailableDow.filter(x => x !== dow)
        : [...editing.unavailableDow, dow],
    });
  };

  return (
    <div>
      {/* タグマスター管理セクション */}
      <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4">
        <p className="text-xs font-semibold text-slate-500 mb-2">タグ管理</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {state.staffTags.map(tag => (
            <span key={tag.id} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-violet-100 text-violet-700">
              {tag.name}
              <button onClick={() => removeTagMaster(tag.id)} className="text-violet-400 hover:text-red-500 leading-none">×</button>
            </span>
          ))}
          <div className="flex gap-1.5 items-center">
            <input
              className="px-2.5 py-1 border border-slate-200 rounded-lg text-xs w-28"
              placeholder="タグ名"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagMaster(); } }}
            />
            <button onClick={addTagMaster} className="px-2.5 py-1 text-xs bg-slate-100 rounded-lg hover:bg-slate-200">追加</button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{state.currentFloor}に配属されているスタッフ一覧</p>
        <button onClick={openNew} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600">
          + スタッフ追加
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs font-semibold">
              <th className="px-3 py-2.5 text-left w-10">#</th>
              <th className="px-3 py-2.5 text-left">氏名</th>
              <th className="px-3 py-2.5 text-left">役職</th>
              <th className="px-3 py-2.5 text-left">勤務可能種別</th>
              <th className="px-3 py-2.5 text-left">可能業務</th>
              <th className="px-3 py-2.5 text-left">不可曜日</th>
              <th className="px-3 py-2.5 text-left">メモ</th>
              <th className="px-3 py-2.5 text-left w-36">操作</th>
            </tr>
          </thead>
          <tbody>
            {floorStaff.map((s, i) => (
              <tr
                key={s.id}
                className={`border-t border-slate-100 hover:bg-slate-50/50 cursor-grab active:cursor-grabbing transition-colors ${dragOverId === s.id ? 'bg-blue-50 border-blue-300' : ''
                  }`}
                draggable
                onDragStart={e => handleDragStart(e, s.id)}
                onDragOver={e => handleDragOver(e, s.id)}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => handleDrop(e, s.id)}
              >
                <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                <td className="px-3 py-2.5 font-medium">
                  <div>{s.name}</div>
                  {(s.tags ?? []).length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {(s.tags ?? []).map(tagId => {
                        const tag = state.staffTags.find(t => t.id === tagId);
                        return tag ? (
                          <span key={tagId} className="px-1.5 rounded-full text-[10px] bg-violet-100 text-violet-600">{tag.name}</span>
                        ) : null;
                      })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[s.role]}`}>{s.role}</span>
                    {s.isNightOnly && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">夜専</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {shiftTypes.map(st => (
                      s.availableShiftTypes.includes(st.id) ? (
                        <span key={st.id} className="shift-tag" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                      ) : null
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {ALL_DUTIES.map(d => (
                      (s.availableDuties ?? []).includes(d) ? (
                        <span key={d} className={`px-1.5 py-0 rounded text-[10px] font-bold border ${DUTY_COLORS[d]}`}>{DUTY_LABELS[d]}</span>
                      ) : null
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {s.unavailableDow.length > 0 ? s.unavailableDow.map(d => DOW[d]).join('・') : '-'}
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{s.memo || '-'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveStaff(s.id, -1)} disabled={i === 0} className="px-1 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-default" title="上へ">▲</button>
                    <button onClick={() => moveStaff(s.id, 1)} disabled={i === floorStaff.length - 1} className="px-1 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-default" title="下へ">▼</button>
                    <button onClick={() => openEdit(s)} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">編集</button>
                    <button onClick={() => remove(s.id)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button>
                  </div>
                </td>
              </tr>
            ))}
            {floorStaff.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">スタッフが登録されていません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl p-7 w-[520px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-5">{isNew ? 'スタッフ追加' : 'スタッフ編集'}</h3>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">氏名</label>
                <input className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">役職</label>
                <select className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as RoleType })}>
                  <option>正社員</option>
                  <option>パート</option>
                  <option>派遣</option>
                </select>
              </div>
              <div className="flex items-start gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-1">勤務可能種別</label>
                <div className="flex gap-1.5 flex-wrap">
                  {shiftTypes.map(st => (
                    <button
                      key={st.id}
                      onClick={() => toggleShiftType(st.id)}
                      className="px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors"
                      style={editing.availableShiftTypes.includes(st.id)
                        ? { borderColor: st.color, background: st.bgColor, color: st.color }
                        : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#94a3b8' }
                      }
                    >
                      {st.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-1">可能業務</label>
                <div className="flex gap-1.5 flex-wrap">
                  {ALL_DUTIES.map(d => (
                    <button
                      key={d}
                      onClick={() => toggleDuty(d)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.availableDuties.includes(d)
                        ? DUTY_COLORS[d]
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                    >
                      {DUTY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-1">出勤不可曜日</label>
                <div className="flex gap-1.5">
                  {DOW.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => toggleDow(i)}
                      className={`w-9 h-9 rounded-md text-xs font-bold border-2 transition-colors ${editing.unavailableDow.includes(i)
                        ? 'border-red-400 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">月の勤務上限</label>
                <input
                  type="number" min="1" max="31" placeholder="未設定"
                  className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  value={editing.monthlyWorkDays ?? ''}
                  onChange={e => setEditing({ ...editing, monthlyWorkDays: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-sm text-slate-500">日/月（空欄=制限なし）</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">週の出勤上限</label>
                <input
                  type="number" min="1" max="7" placeholder="未設定"
                  className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  value={editing.weeklyWorkDays ?? ''}
                  onChange={e => setEditing({ ...editing, weeklyWorkDays: e.target.value ? Number(e.target.value) : undefined })}
                />
                <span className="text-sm text-slate-500">日/週（空欄=制限なし）</span>
              </div>
              <div className="flex items-start gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-2">夜勤専門</label>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setEditing({
                      ...editing,
                      isNightOnly: !editing.isNightOnly,
                      nightShiftMin: !editing.isNightOnly ? (editing.nightShiftMin ?? 9) : undefined,
                      nightShiftMax: !editing.isNightOnly ? (editing.nightShiftMax ?? 10) : undefined,
                    })}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.isNightOnly
                      ? 'border-purple-400 bg-purple-50 text-purple-700'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                  >
                    {editing.isNightOnly ? 'ON' : 'OFF'}
                  </button>
                  {editing.isNightOnly && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500">月</span>
                      <input
                        type="number" min="1" max="20"
                        className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center"
                        value={editing.nightShiftMin ?? 9}
                        onChange={e => setEditing({ ...editing, nightShiftMin: Number(e.target.value) })}
                      />
                      <span className="text-slate-500">〜</span>
                      <input
                        type="number" min="1" max="20"
                        className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center"
                        value={editing.nightShiftMax ?? 10}
                        onChange={e => setEditing({ ...editing, nightShiftMax: Number(e.target.value) })}
                      />
                      <span className="text-slate-500">回/月</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">短時間</label>
                <button
                  onClick={() => setEditing({ ...editing, isShortTime: !editing.isShortTime })}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.isShortTime
                    ? 'border-teal-400 bg-teal-50 text-teal-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                >
                  {editing.isShortTime ? 'ON' : 'OFF'}
                </button>
                <span className="text-xs text-slate-500">シフト表で I（短時間）として表示</span>
              </div>
              {state.staffTags.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-1">タグ</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {state.staffTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${
                          editing.tags.includes(tag.id)
                            ? 'border-violet-400 bg-violet-50 text-violet-700'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">メモ</label>
                <input className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="備考" value={editing.memo} onChange={e => setEditing({ ...editing, memo: e.target.value })} />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
