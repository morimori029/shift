"""
CP-SAT（Google OR-Tools）によるシフト自動生成エンジン。

役割分担:
- このソルバーは「誰が・いつ・どのシフト種別か」だけを厳密に解く。
- 業務（LD・入浴・排泄・フロア）の割当はここでは行わない。
  Next.js側の既存 assignDuties()（scheduler.ts、テスト済み）を
  このソルバーの出力に対して後段で実行する想定（重複実装を避けるため）。
- ハード制約は基本的にCP-SATの制約として厳密に課す。ただし「必要人数の
  充足」「公休目標」は現場の人員状況次第では厳密に満たせないことが
  多いため、ハード制約にはせず、目的関数でのペナルティ（ソフト制約）
  として扱う（docs/constraints.md のH10も、厳密な等式にすると
  実運用でしばしば infeasible になりうるため、目的関数側で扱う設計とした）。
- 「手動入力(isManual)は自動生成で絶対に上書きしない」は等式制約として
  ハード固定する。既存の貪欲法エンジンは「夜勤→明けの強制」が手動入力
  より優先されて上書きすることがあるが、CP-SATでは全制約を同時に解くため
  そのような優先度上書きの概念がなく、矛盾する手動入力があれば
  infeasible として明示的に報告する（サイレントな上書きより安全な挙動）。
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date as Date

from ortools.sat.python import cp_model

from app.models import FloorConfig, GenerateRequest, PairSetting, ShiftAssignment, ShiftType, Staff

PARTIAL_SHIFT_IDS = {"half_am", "half_pm", "short"}
OFF_LIKE_IDS = {"off", "paid"}


def _date_str(year: int, month: int, day: int) -> str:
    return f"{year}-{month:02d}-{day:02d}"


def _dow(year: int, month: int, day: int) -> int:
    # Python: Monday=0 ... Sunday=6 / このアプリの規約は 日曜=0 ... 土曜=6 なので変換する
    py_dow = Date(year, month, day).weekday()
    return (py_dow + 1) % 7


def solve(req: GenerateRequest) -> tuple[str, list[ShiftAssignment], float, str | None]:
    start = time.monotonic()

    if req.floor == "非常勤":
        return "error", [], 0.0, "非常勤フロアはこのソルバーの対象外です（Node側の軽量ロジックを使用してください）"

    staff = req.staff
    if not staff:
        return "optimal", [], 0.0, None

    shift_types = req.shiftTypes
    config = req.config
    days_in_month = _days_in_month(req.year, req.month)
    holiday_set = set(req.holidays)

    night_type = next((st for st in shift_types if st.isNightShift), None)
    ake_type = next((st for st in shift_types if st.isAke), None)
    day_shift_ids = {st.id for st in shift_types if st.isDayShift}

    categories = [st.id for st in shift_types] + ["off"]

    model = cp_model.CpModel()

    # x[(staffId, day, category)] -> BoolVar
    x: dict[tuple[str, int, str], cp_model.IntVar] = {}
    for s in staff:
        for d in range(1, days_in_month + 1):
            for cat in categories:
                x[(s.id, d, cat)] = model.NewBoolVar(f"x_{s.id}_{d}_{cat}")

    # 1日1カテゴリのみ選択
    for s in staff:
        for d in range(1, days_in_month + 1):
            model.AddExactlyOne(x[(s.id, d, cat)] for cat in categories)

    # 担当可能シフトの制約（ake・offは対象外。availableShiftTypesに無いシフトは選べない）
    for s in staff:
        available = set(s.availableShiftTypes)
        for d in range(1, days_in_month + 1):
            for st in shift_types:
                if st.isAke:
                    continue
                if st.id not in available:
                    model.Add(x[(s.id, d, st.id)] == 0)

    # 手動入力(isManual)の固定
    prefilled_map: dict[tuple[str, str], ShiftAssignment] = {}
    for a in req.prefilled:
        if a.isManual:
            prefilled_map[(a.staffId, a.date)] = a
    for (staff_id, date_str), a in prefilled_map.items():
        d = int(date_str.split("-")[2])
        cat = "off" if a.shiftTypeId == "off" else a.shiftTypeId
        if (staff_id, d, cat) in x:
            model.Add(x[(staff_id, d, cat)] == 1)

    # H1: 夜勤の翌日は必ず明け（前月末からの引き継ぎも考慮）
    if night_type and ake_type:
        prev_last_date = _prev_month_last_date(req.year, req.month)
        prev_night_staff = {
            a.staffId
            for a in req.prevMonthAssignments
            if a.date == prev_last_date and a.shiftTypeId == night_type.id
        }
        for s in staff:
            if s.id in prev_night_staff and (s.id, 1, ake_type.id) in x:
                model.Add(x[(s.id, 1, ake_type.id)] == 1)
            for d in range(2, days_in_month + 1):
                model.Add(x[(s.id, d, ake_type.id)] == x[(s.id, d - 1, night_type.id)])
        # 明け自体はこの連動でのみ発生する（単独では選ばれない）
        if not prev_night_staff:
            for s in staff:
                if (s.id, 1, ake_type.id) in x:
                    model.Add(x[(s.id, 1, ake_type.id)] == 0)

        # 明けの翌日は夜勤 or 休み(有給含む)のみ。日勤帯シフトには入れない
        allowed_after_ake = {night_type.id, "off"}
        if any(st.id == "paid" for st in shift_types):
            allowed_after_ake.add("paid")
        for s in staff:
            for d in range(1, days_in_month):
                for cat in categories:
                    if cat in allowed_after_ake:
                        continue
                    model.Add(x[(s.id, d, ake_type.id)] + x[(s.id, d + 1, cat)] <= 1)

    # H3: 出勤不可曜日・祝日出勤不可 → 休み
    for s in staff:
        unavailable_dow = set(s.unavailableDow)
        for d in range(1, days_in_month + 1):
            date_str = _date_str(req.year, req.month, d)
            dow = _dow(req.year, req.month, d)
            is_holiday = date_str in holiday_set
            if dow in unavailable_dow or (is_holiday and s.unavailableOnHoliday):
                model.Add(x[(s.id, d, "off")] == 1)

    # H9: 夜勤専従は夜勤・明け・休み・有給以外に入れない
    for s in staff:
        if not s.isNightOnly:
            continue
        allowed = {"off"}
        if night_type:
            allowed.add(night_type.id)
        if ake_type:
            allowed.add(ake_type.id)
        if any(st.id == "paid" for st in shift_types):
            allowed.add("paid")
        for d in range(1, days_in_month + 1):
            for cat in categories:
                if cat not in allowed:
                    model.Add(x[(s.id, d, cat)] == 0)

    # H7: 夜勤上限
    if night_type:
        for s in staff:
            if s.nightShiftMax:
                night_sum = sum(x[(s.id, d, night_type.id)] for d in range(1, days_in_month + 1))
                model.Add(night_sum <= s.nightShiftMax)
            if s.nightShiftMin:
                night_sum = sum(x[(s.id, d, night_type.id)] for d in range(1, days_in_month + 1))
                model.Add(night_sum >= s.nightShiftMin)

    # H8: 連続夜勤は最大2回（同一スタッフでnight(d), night(d+2), night(d+4) が同時に立たない）
    if night_type:
        for s in staff:
            for d in range(1, days_in_month - 3):
                model.Add(
                    x[(s.id, d, night_type.id)]
                    + x[(s.id, d + 2, night_type.id)]
                    + x[(s.id, d + 4, night_type.id)]
                    <= 2
                )

    # H4: 連続出勤上限（休み・有給以外はすべて「勤務」扱い。前月末からの連勤を引き継ぐ）
    hard_work = {
        (s.id, d): sum(x[(s.id, d, cat)] for cat in categories if cat not in OFF_LIKE_IDS)
        for s in staff
        for d in range(1, days_in_month + 1)
    }
    for s in staff:
        carry_in = _consecutive_carry_in(s.id, req.prevMonthAssignments, req.year, req.month)
        limit = config.maxConsecutiveDays
        # 前月からの持ち越し分を含めたプレフィックス制約
        for m in range(1, min(limit, days_in_month) + 1):
            prefix = sum(hard_work[(s.id, d)] for d in range(1, m + 1))
            model.Add(carry_in + prefix <= limit)
        # 月内のスライディングウィンドウ
        window = limit + 1
        for d0 in range(1, days_in_month - window + 2):
            total = sum(hard_work[(s.id, d)] for d in range(d0, d0 + window))
            model.Add(total <= limit)

    # H5 / H6: 月・週の出勤日数上限（半日系シフトはカウント対象外）
    work_day = {
        (s.id, d): sum(x[(s.id, d, cat)] for cat in categories if cat not in OFF_LIKE_IDS and cat not in PARTIAL_SHIFT_IDS)
        for s in staff
        for d in range(1, days_in_month + 1)
    }
    for s in staff:
        if s.monthlyWorkDays:
            model.Add(sum(work_day[(s.id, d)] for d in range(1, days_in_month + 1)) <= s.monthlyWorkDays)
        if s.weeklyWorkDays:
            for week_days in _week_windows(req.year, req.month, days_in_month):
                model.Add(sum(work_day[(s.id, d)] for d in week_days) <= s.weeklyWorkDays)

    # NGペア（同一カテゴリ・同一日に同時に入らない）
    for p in req.pairs:
        if p.type != "ng":
            continue
        target_ids = _scope_shift_ids(p.scope, night_type, day_shift_ids)
        for d in range(1, days_in_month + 1):
            for cat in target_ids:
                if (p.staffId1, d, cat) in x and (p.staffId2, d, cat) in x:
                    model.Add(x[(p.staffId1, d, cat)] + x[(p.staffId2, d, cat)] <= 1)

    # ---- 目的関数（ソフト制約） ----
    objective_terms = []

    # 必要人数の不足はできるだけ避ける（不足数に大きなペナルティ）
    excluded_ids = {s.id for s in staff if s.excludeFromCount}
    for d in range(1, days_in_month + 1):
        date_str = _date_str(req.year, req.month, d)
        dow = _dow(req.year, req.month, d)
        is_holiday = date_str in holiday_set
        eff_dow = -1 if (is_holiday and config.useHolidayRequirements) else (0 if is_holiday else dow)
        for st in shift_types:
            if st.isAke:
                continue
            req_count = _effective_requirement(config, st.id, eff_dow)
            if req_count <= 0:
                continue
            filled = sum(x[(s.id, d, st.id)] for s in staff if s.id not in excluded_ids)
            shortfall = model.NewIntVar(0, req_count, f"short_{d}_{st.id}")
            model.Add(filled + shortfall >= req_count)
            objective_terms.append(shortfall * -1000)

    # 公休目標からのずれを抑える（多すぎても少なすぎてもペナルティ）。
    # ±3日程度までは軽いペナルティ、それを超えると急激に重くする（区分線形）ことで、
    # 「不足人数を埋めるために特定の1人だけ大きく公休が削られる」よりも
    # 「軽微な不足を許容してでも公休を全員で分かち合う」方を優先させる。
    DEV_SOFT_LIMIT = 3
    for s in staff:
        target_off = _target_off_days(s, config, days_in_month)
        off_count = sum(x[(s.id, d, "off")] for d in range(1, days_in_month + 1))
        over = model.NewIntVar(0, days_in_month, f"offover_{s.id}")
        under = model.NewIntVar(0, days_in_month, f"offunder_{s.id}")
        model.Add(off_count - target_off == over - under)
        dev_near = model.NewIntVar(0, DEV_SOFT_LIMIT, f"offdevnear_{s.id}")
        dev_far = model.NewIntVar(0, days_in_month, f"offdevfar_{s.id}")
        model.Add(dev_near + dev_far == over + under)
        objective_terms.append(dev_near * -20)
        objective_terms.append(dev_far * -1500)

    # 推奨ペアは同じ夜勤に入るとボーナス
    if night_type:
        for p in req.pairs:
            if p.type != "preferred":
                continue
            target_ids = _scope_shift_ids(p.scope, night_type, day_shift_ids)
            for d in range(1, days_in_month + 1):
                for cat in target_ids:
                    if (p.staffId1, d, cat) in x and (p.staffId2, d, cat) in x:
                        both = model.NewBoolVar(f"pref_{p.id}_{d}_{cat}")
                        model.AddMultiplicationEquality(both, [x[(p.staffId1, d, cat)], x[(p.staffId2, d, cat)]])
                        objective_terms.append(both * 5)

    # 夜勤回数の均等化（非専従スタッフの最大-最小を小さくする）
    if night_type:
        normal_staff = [s for s in staff if not s.isNightOnly and night_type.id in s.availableShiftTypes]
        if normal_staff:
            night_counts = [
                sum(x[(s.id, d, night_type.id)] for d in range(1, days_in_month + 1)) for s in normal_staff
            ]
            max_n = model.NewIntVar(0, days_in_month, "max_night")
            min_n = model.NewIntVar(0, days_in_month, "min_night")
            model.AddMaxEquality(max_n, night_counts)
            model.AddMinEquality(min_n, night_counts)
            objective_terms.append((max_n - min_n) * -10)

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.timeLimitSeconds
    solver.parameters.num_workers = 8
    status = solver.Solve(model)
    elapsed = time.monotonic() - start

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return "infeasible", [], elapsed, "制約を満たす解が見つかりませんでした（手動入力同士の矛盾や、人員に対して制約が厳しすぎる可能性があります）"

    assignments: list[ShiftAssignment] = []
    for s in staff:
        for d in range(1, days_in_month + 1):
            for cat in categories:
                if solver.Value(x[(s.id, d, cat)]) == 1:
                    assignments.append(
                        ShiftAssignment(
                            staffId=s.id,
                            date=_date_str(req.year, req.month, d),
                            shiftTypeId=cat,
                            isLeader=False,
                            isManual=(s.id, _date_str(req.year, req.month, d)) in prefilled_map,
                            duty=None,
                        )
                    )
                    break

    status_str = "optimal" if status == cp_model.OPTIMAL else "feasible"
    return status_str, assignments, elapsed, None


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return (Date(year + 1, 1, 1) - Date(year, 12, 1)).days
    return (Date(year, month + 1, 1) - Date(year, month, 1)).days


def _prev_month_last_date(year: int, month: int) -> str:
    if month == 1:
        py, pm = year - 1, 12
    else:
        py, pm = year, month - 1
    last_day = _days_in_month(py, pm)
    return _date_str(py, pm, last_day)


def _consecutive_carry_in(staff_id: str, prev_assignments: list[ShiftAssignment], year: int, month: int) -> int:
    """前月末からの連続勤務日数（休み・有給以外はすべて勤務扱い、当月H4と同じ定義）"""
    if not prev_assignments:
        return 0
    if month == 1:
        py, pm = year - 1, 12
    else:
        py, pm = year, month - 1
    prev_days = _days_in_month(py, pm)
    by_date = {a.date: a for a in prev_assignments if a.staffId == staff_id}
    consecutive = 0
    for d in range(prev_days, 0, -1):
        ds = _date_str(py, pm, d)
        a = by_date.get(ds)
        if a is None or a.shiftTypeId in OFF_LIKE_IDS:
            break
        consecutive += 1
    return consecutive


def _week_windows(year: int, month: int, days_in_month: int) -> list[list[int]]:
    """月内を月曜始まりの週に分割する（月をまたぐ週も月内の日数分だけ含める）"""
    weeks: dict[int, list[int]] = defaultdict(list)
    for d in range(1, days_in_month + 1):
        dow = _dow(year, month, d)  # 0=日..6=土
        # 月曜=0起点の週番号にするため、日曜だけ「前の週」扱いに寄せる
        iso_like = (d - ((dow - 1) % 7 + 1))
        week_idx = iso_like // 7
        weeks[week_idx].append(d)
    return list(weeks.values())


def _scope_shift_ids(scope: str, night_type: ShiftType | None, day_shift_ids: set[str]) -> set[str]:
    if scope == "night":
        return {night_type.id} if night_type else set()
    if scope == "day":
        return set(day_shift_ids)
    ids = set(day_shift_ids)
    if night_type:
        ids.add(night_type.id)
    return ids


def _effective_requirement(config: FloorConfig, shift_id: str, eff_dow: int) -> int:
    if config.shiftRequirementsEnabled.get(shift_id) is False:
        return 0
    if eff_dow == -1:
        holiday_req = (config.holidayShiftRequirements or {}).get(shift_id)
        if holiday_req is not None:
            return holiday_req
        arr = config.shiftRequirements.get(shift_id)
        return arr[0] if arr else 0
    arr = config.shiftRequirements.get(shift_id)
    if not arr or eff_dow >= len(arr):
        return 0
    return arr[eff_dow]


def _target_off_days(s: Staff, config: FloorConfig, days_in_month: int) -> int:
    if s.monthlyWorkDays:
        return max(config.monthlyOffDays, days_in_month - s.monthlyWorkDays)
    if s.weeklyWorkDays:
        weekly_off = 7 - s.weeklyWorkDays
        target = round(weekly_off * days_in_month / 7)
        return max(config.monthlyOffDays, target)
    return config.monthlyOffDays
