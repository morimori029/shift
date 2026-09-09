'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { createStaff, updateStaff, deleteStaff, reorderStaff } from '@/server/actions/staff';
import { createStaffTag, deleteStaffTag } from '@/server/actions/staffTags';
import type { StaffInput } from '@/server/mappers/staff';
import type { Staff, StaffTag, ShiftType, RoleType, DutyType, Floor } from '@/types';
import { DUTY_LABELS, ALL_DUTIES } from '@/types';

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

type EditingForm = StaffInput & { id: string | null };

function toForm(s: Staff): EditingForm {
  return {
    id: s.id,
    name: s.name,
    floor: s.floor,
    role: s.role,
    availableShiftTypeIds: s.availableShiftTypes,
    availableDuties: s.availableDuties,
    monthlyWorkDays: s.monthlyWorkDays,
    weeklyWorkDays: s.weeklyWorkDays,
    isNightOnly: s.isNightOnly,
    nightShiftMin: s.nightShiftMin,
    nightShiftMax: s.nightShiftMax,
    isShortTime: s.isShortTime,
    excludeFromCount: s.excludeFromCount,
    unavailableDow: s.unavailableDow,
    unavailableOnHoliday: s.unavailableOnHoliday,
    tagIds: s.tags,
    memo: s.memo,
    highlightColor: s.highlightColor,
  };
}

interface Props {
  floor: Floor;
  initialStaff: Staff[];
  initialTags: StaffTag[];
  shiftTypes: ShiftType[];
}

export default function StaffPageClient({ floor, initialStaff: floorStaff, initialTags: tags, shiftTypes: allShiftTypes }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<EditingForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 勤務可能種別は早番・日勤・遅番・夜勤のみ選択可能にする（研修・短時間・有給・午前休・午後休は対象外）
  const SELECTABLE_SHIFT_IDS = new Set(['early', 'day', 'late', 'night']);
  const shiftTypes = allShiftTypes.filter(st => SELECTABLE_SHIFT_IDS.has(st.id));

  const openNew = () => {
    setIsNew(true);
    setEditing({
      id: null,
      name: '',
      floor,
      role: '正社員',
      availableShiftTypeIds: shiftTypes.map(s => s.id),
      availableDuties: [...ALL_DUTIES],
      unavailableDow: [],
      tagIds: [],
      memo: '',
    });
  };

  const openEdit = (s: Staff) => {
    setIsNew(false);
    setEditing(toForm(s));
  };

  const addTagMaster = async () => {
    const name = newTagName.trim();
    if (!name) return;
    if (tags.some(t => t.name === name)) { setNewTagName(''); return; }
    const res = await createStaffTag(name);
    if (!res.ok) { toast.show(res.error, 'error'); return; }
    setNewTagName('');
    router.refresh();
  };

  const removeTagMaster = async (tagId: string) => {
    await deleteStaffTag(tagId);
    router.refresh();
  };

  const toggleTag = (tagId: string) => {
    if (!editing) return;
    const has = editing.tagIds.includes(tagId);
    setEditing({ ...editing, tagIds: has ? editing.tagIds.filter(id => id !== tagId) : [...editing.tagIds, tagId] });
  };

  const toggleShiftType = (stId: string) => {
    if (!editing) return;
    const has = editing.availableShiftTypeIds.includes(stId);
    setEditing({
      ...editing,
      availableShiftTypeIds: has
        ? editing.availableShiftTypeIds.filter(x => x !== stId)
        : [...editing.availableShiftTypeIds, stId],
    });
  };

  const toggleDuty = (duty: DutyType) => {
    if (!editing) return;
    const has = editing.availableDuties.includes(duty);
    setEditing({
      ...editing,
      availableDuties: has ? editing.availableDuties.filter(x => x !== duty) : [...editing.availableDuties, duty],
    });
  };

  const toggleDow = (dow: number) => {
    if (!editing) return;
    const has = editing.unavailableDow.includes(dow);
    setEditing({
      ...editing,
      unavailableDow: has ? editing.unavailableDow.filter(x => x !== dow) : [...editing.unavailableDow, dow],
    });
  };

  const save = async () => {
    if (!editing) return;
    if (editing.monthlyWorkDays !== undefined && editing.monthlyWorkDays < 1) {
      toast.show('月の勤務上限は1以上で入力してください', 'error');
      return;
    }
    setSaving(true);
    const res = editing.id ? await updateStaff(editing.id, editing) : await createStaff(editing);
    setSaving(false);
    if (!res.ok) { toast.show(res.error, 'error'); return; }
    setEditing(null);
    toast.show(isNew ? `${editing.name} を追加しました` : `${editing.name} を更新しました`);
    router.refresh();
  };

  const remove = async (s: Staff) => {
    if (!confirm(`${s.name} を削除しますか？\n関連するシフト・相性設定・コメントも削除されます。`)) return;
    await deleteStaff(s.id);
    toast.show(`${s.name} を削除しました`);
    router.refresh();
  };

  const applyReorder = async (orderedIds: string[]) => {
    await reorderStaff(floor, orderedIds);
    router.refresh();
  };

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
    const ids = floorStaff.map(s => s.id);
    const srcIdx = ids.indexOf(srcId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    const [removed] = ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, removed);
    void applyReorder(ids);
  };

  const moveStaff = (id: string, direction: -1 | 1) => {
    const ids = floorStaff.map(s => s.id);
    const pos = ids.indexOf(id);
    const targetPos = pos + direction;
    if (targetPos < 0 || targetPos >= ids.length) return;
    [ids[pos], ids[targetPos]] = [ids[targetPos], ids[pos]];
    void applyReorder(ids);
  };

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4">
        <p className="text-xs font-semibold text-slate-500 mb-2">タグ管理</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {tags.map(tag => (
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
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addTagMaster(); } }}
            />
            <button onClick={() => void addTagMaster()} className="px-2.5 py-1 text-xs bg-slate-100 rounded-lg hover:bg-slate-200">追加</button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{floor}に配属されているスタッフ一覧</p>
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
                className={`border-t border-slate-100 hover:bg-slate-50/50 cursor-grab active:cursor-grabbing transition-colors ${dragOverId === s.id ? 'bg-blue-50 border-blue-300' : ''}`}
                draggable
                onDragStart={e => handleDragStart(e, s.id)}
                onDragOver={e => handleDragOver(e, s.id)}
                onDragLeave={() => setDragOverId(null)}
                onDrop={e => handleDrop(e, s.id)}
              >
                <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                <td className="px-3 py-2.5 font-medium">
                  <div>{s.name}</div>
                  {s.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {s.tags.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
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
                        <span key={st.id} className="inline-block px-1.5 py-0 rounded text-xs font-bold" style={{ background: st.bgColor, color: st.color }}>{st.shortName}</span>
                      ) : null
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {ALL_DUTIES.map(d => (
                      s.availableDuties.includes(d) ? (
                        <span key={d} className={`px-1.5 py-0 rounded text-[10px] font-bold border ${DUTY_COLORS[d]}`}>{DUTY_LABELS[d]}</span>
                      ) : null
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {s.unavailableDow.length > 0 || s.unavailableOnHoliday
                    ? [...s.unavailableDow.map(d => DOW[d]), ...(s.unavailableOnHoliday ? ['祝'] : [])].join('・')
                    : '-'}
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{s.memo || '-'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveStaff(s.id, -1)} disabled={i === 0} className="px-1 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-default" title="上へ">▲</button>
                    <button onClick={() => moveStaff(s.id, 1)} disabled={i === floorStaff.length - 1} className="px-1 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-default" title="下へ">▼</button>
                    <button onClick={() => openEdit(s)} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">編集</button>
                    <button onClick={() => void remove(s)} className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button>
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
          <div className="bg-white rounded-2xl p-7 w-[520px] max-w-[90vw] max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
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
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">所属フロア</label>
                <select className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" value={editing.floor} onChange={e => setEditing({ ...editing, floor: e.target.value as Floor })}>
                  <option value="1F">1F</option>
                  <option value="2F">2F</option>
                  <option value="非常勤">非常勤</option>
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
                      style={editing.availableShiftTypeIds.includes(st.id)
                        ? { borderColor: st.color, background: st.bgColor, color: st.color }
                        : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#94a3b8' }}
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
                      className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.availableDuties.includes(d) ? DUTY_COLORS[d] : 'border-slate-200 bg-slate-50 text-slate-400'}`}
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
                      className={`w-9 h-9 rounded-md text-xs font-bold border-2 transition-colors ${editing.unavailableDow.includes(i) ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    onClick={() => setEditing({ ...editing, unavailableOnHoliday: !editing.unavailableOnHoliday })}
                    className={`px-2 h-9 rounded-md text-xs font-bold border-2 transition-colors ${editing.unavailableOnHoliday ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                  >
                    祝
                  </button>
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
              {!editing.isNightOnly && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">夜勤回数</label>
                  <input
                    type="number" min="0" max="20" placeholder="未設定"
                    className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-sm text-center"
                    value={editing.nightShiftMin ?? ''}
                    onChange={e => setEditing({ ...editing, nightShiftMin: e.target.value ? Number(e.target.value) : undefined })}
                  />
                  <span className="text-sm text-slate-500">〜</span>
                  <input
                    type="number" min="0" max="20" placeholder="未設定"
                    className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-sm text-center"
                    value={editing.nightShiftMax ?? ''}
                    onChange={e => setEditing({ ...editing, nightShiftMax: e.target.value ? Number(e.target.value) : undefined })}
                  />
                  <span className="text-sm text-slate-500">回/月（空欄=制限なし）</span>
                </div>
              )}
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
                    className={`px-4 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.isNightOnly ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
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
                  className={`px-4 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.isShortTime ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                >
                  {editing.isShortTime ? 'ON' : 'OFF'}
                </button>
                <span className="text-xs text-slate-500">シフト表で I（短時間）として表示</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">人数除外</label>
                <button
                  onClick={() => setEditing({ ...editing, excludeFromCount: !editing.excludeFromCount })}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.excludeFromCount ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                >
                  {editing.excludeFromCount ? 'ON' : 'OFF'}
                </button>
                <span className="text-xs text-slate-500">出勤しても必要人数にカウントしない</span>
              </div>
              {tags.length > 0 && (
                <div className="flex items-start gap-3">
                  <label className="text-sm font-semibold text-slate-600 w-28 shrink-0 pt-1">タグ</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {tags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.tagIds.includes(tag.id) ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">行の色付け</label>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setEditing({ ...editing, highlightColor: undefined })}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${!editing.highlightColor ? 'border-slate-400 bg-slate-100 text-slate-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                  >
                    なし
                  </button>
                  <button
                    onClick={() => setEditing({ ...editing, highlightColor: 'color1' })}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.highlightColor === 'color1' ? 'border-sky-400 bg-sky-100 text-sky-700' : 'border-slate-200 bg-sky-50 text-sky-300'}`}
                  >
                    色1
                  </button>
                  <button
                    onClick={() => setEditing({ ...editing, highlightColor: 'color2' })}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition-colors ${editing.highlightColor === 'color2' ? 'border-pink-400 bg-pink-100 text-pink-700' : 'border-slate-200 bg-pink-50 text-pink-300'}`}
                  >
                    色2
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-600 w-28 shrink-0">メモ</label>
                <input className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="備考" value={editing.memo} onChange={e => setEditing({ ...editing, memo: e.target.value })} />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
              <button onClick={() => void save()} disabled={saving} className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
