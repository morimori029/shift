"""
移行元: c:/app/shift/src/lib/scheduler.test.ts のハード制約テストをCP-SATソルバー向けに移植。
固定値の期待ではなく「制約が守られているか」を検証する点は同じ方針。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import FloorConfig, GenerateRequest, PairSetting, ShiftType, Staff  # noqa: E402
from app.solver import solve  # noqa: E402

SHIFT_TYPES = [
    ShiftType(id="early", name="早番", shortName="L", startTime="08:00", endTime="16:30", color="#1d4ed8", bgColor="#dbeafe", isDayShift=True, isNightShift=False, isAke=False, order=1),
    ShiftType(id="day", name="日勤", shortName="B", startTime="08:30", endTime="17:00", color="#15803d", bgColor="#dcfce7", isDayShift=True, isNightShift=False, isAke=False, order=2),
    ShiftType(id="late", name="遅番", shortName="U", startTime="10:30", endTime="19:00", color="#c2410c", bgColor="#ffedd5", isDayShift=True, isNightShift=False, isAke=False, order=3),
    ShiftType(id="night", name="夜勤", shortName="〇", startTime="16:30", endTime="09:00", color="#7e22ce", bgColor="#f3e8ff", isDayShift=False, isNightShift=True, isAke=False, order=4),
    ShiftType(id="ake", name="明け", shortName="×", startTime="", endTime="", color="#6b7280", bgColor="#f1f5f9", isDayShift=False, isNightShift=False, isAke=True, order=5),
]

BASE_CONFIG = FloorConfig(
    floor="1F",
    shiftRequirements={"early": [0] * 7, "day": [2] * 7, "late": [1] * 7, "night": [2] * 7},
    shiftRequirementsEnabled={"early": True, "day": True, "late": True, "night": True},
    dutyRequirements={"ld": [0] * 7, "bathing": [0] * 7, "floor": [0] * 7, "toilet": [0] * 7},
    leaderCountPerDay=0,
    maxConsecutiveDays=5,
    monthlyOffDays=9,
)


def make_staff(id_: str, **overrides) -> Staff:
    base = dict(
        id=id_,
        name=id_,
        floor="1F",
        role="正社員",
        availableShiftTypes=["early", "day", "late", "night"],
        availableDuties=["floor", "toilet"],
        unavailableDow=[],
        tags=[],
        memo="",
    )
    base.update(overrides)
    return Staff(**base)


def run_solver(staff: list[Staff], config: FloorConfig = BASE_CONFIG, pairs: list[PairSetting] | None = None, time_limit: float = 15.0):
    req = GenerateRequest(
        year=2026, month=3, floor="1F",
        staff=staff, shiftTypes=SHIFT_TYPES, config=config, pairs=pairs or [],
        timeLimitSeconds=time_limit,
    )
    status, assignments, _elapsed, message = solve(req)
    assert status in ("optimal", "feasible"), f"solve failed: {status} / {message}"
    return assignments


def find(assignments, staff_id, date):
    return next((a for a in assignments if a.staffId == staff_id and a.date == date), None)


def test_night_followed_by_ake():
    staff = [make_staff(x) for x in "ABCDE"]
    result = run_solver(staff)
    for a in result:
        if a.shiftTypeId == "night":
            y, m, d = map(int, a.date.split("-"))
            if d < 31:
                next_date = f"{y}-{m:02d}-{d + 1:02d}"
                next_a = find(result, a.staffId, next_date)
                assert next_a is not None and next_a.shiftTypeId == "ake", (
                    f"{a.staffId} の {a.date} 夜勤翌日 ({next_date}) は明けであるべき"
                )


def test_ng_pair_never_same_night():
    staff = [make_staff(x) for x in "ABCDE"]
    pairs = [PairSetting(id="p1", staffId1="A", staffId2="B", type="ng", scope="night", memo="")]
    result = run_solver(staff, pairs=pairs)
    for d in range(1, 32):
        date = f"2026-03-{d:02d}"
        night_workers = {a.staffId for a in result if a.date == date and a.shiftTypeId == "night"}
        assert not ({"A", "B"} <= night_workers), f"{date}: NGペアA-Bが同日夜勤"


def test_max_consecutive_days():
    staff = [make_staff(x) for x in "ABCDE"]
    config = BASE_CONFIG.model_copy(update={"maxConsecutiveDays": 3})
    result = run_solver(staff, config=config)
    for s in staff:
        consecutive = 0
        for d in range(1, 32):
            date = f"2026-03-{d:02d}"
            a = find(result, s.id, date)
            is_off = a is None or a.shiftTypeId in ("off", "paid")
            if is_off:
                consecutive = 0
            else:
                consecutive += 1
                assert consecutive <= 3, f"{s.id}: {date} 時点で連勤{consecutive}日"


def test_day_after_ake_is_night_or_off():
    staff = [make_staff(x) for x in "ABCDE"]
    result = run_solver(staff)
    for a in result:
        if a.shiftTypeId == "ake":
            y, m, d = map(int, a.date.split("-"))
            if d < 31:
                next_date = f"{y}-{m:02d}-{d + 1:02d}"
                next_a = find(result, a.staffId, next_date)
                if next_a:
                    assert next_a.shiftTypeId in ("off", "night", "paid"), (
                        f"{a.staffId}: 明け({a.date})翌日が{next_a.shiftTypeId}"
                    )


def test_ng_pairs_multiple():
    staff = [make_staff(x) for x in "ABCDE"]
    pairs = [
        PairSetting(id="p1", staffId1="A", staffId2="B", type="ng", scope="night", memo=""),
        PairSetting(id="p2", staffId1="C", staffId2="D", type="ng", scope="night", memo=""),
    ]
    result = run_solver(staff, pairs=pairs)
    for d in range(1, 32):
        date = f"2026-03-{d:02d}"
        night_workers = {a.staffId for a in result if a.date == date and a.shiftTypeId == "night"}
        assert not ({"A", "B"} <= night_workers)
        assert not ({"C", "D"} <= night_workers)


def test_night_only_staff_reaches_minimum():
    staff = [
        make_staff("NIGHT1", isNightOnly=True, nightShiftMin=5, nightShiftMax=12, availableShiftTypes=["night"]),
        make_staff("NIGHT2", isNightOnly=True, nightShiftMin=5, nightShiftMax=12, availableShiftTypes=["night"]),
        make_staff("A"), make_staff("B"), make_staff("C"), make_staff("D"),
    ]
    result = run_solver(staff)
    n1 = sum(1 for a in result if a.staffId == "NIGHT1" and a.shiftTypeId == "night")
    n2 = sum(1 for a in result if a.staffId == "NIGHT2" and a.shiftTypeId == "night")
    assert n1 >= 5, f"NIGHT1の夜勤回数{n1}が最低回数5を下回っている"
    assert n2 >= 5, f"NIGHT2の夜勤回数{n2}が最低回数5を下回っている"


def test_preferred_pair_shares_night_at_least_once():
    staff = [make_staff(x) for x in "ABCDE"]
    pairs = [PairSetting(id="p1", staffId1="A", staffId2="B", type="preferred", scope="night", memo="")]
    result = run_solver(staff, pairs=pairs)
    together = 0
    for d in range(1, 32):
        date = f"2026-03-{d:02d}"
        night_workers = {a.staffId for a in result if a.date == date and a.shiftTypeId == "night"}
        if {"A", "B"} <= night_workers:
            together += 1
    assert together > 0, "推奨ペアA-Bが一度も同じ夜勤に入っていない"


def test_off_days_close_to_target():
    staff = [make_staff(x) for x in "ABCDEF"]
    result = run_solver(staff)
    target = BASE_CONFIG.monthlyOffDays
    for s in staff:
        off_count = sum(1 for a in result if a.staffId == s.id and a.shiftTypeId in ("off", "paid"))
        assert abs(off_count - target) <= 3, f"{s.id}: 公休{off_count}日（目標{target}日）"


def test_night_counts_balanced():
    staff = [make_staff(x) for x in "ABCDEF"]
    result = run_solver(staff)
    counts = [sum(1 for a in result if a.staffId == s.id and a.shiftTypeId == "night") for s in staff]
    assert max(counts) - min(counts) <= 3, f"夜勤回数の最大-最小が{max(counts) - min(counts)}回: {counts}"
