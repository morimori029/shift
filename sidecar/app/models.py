"""
リクエスト/レスポンスのスキーマ定義。
c:/app/shift/web/src/types/index.ts の型と1:1で対応させる
（フィールド名はNext.js側のドメイン型にそのまま合わせている）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Floor = Literal["1F", "2F", "非常勤"]
RoleType = Literal["正社員", "パート", "派遣"]
PairType = Literal["ng", "preferred"]
PairScope = Literal["night", "day", "all"]
DutyType = Literal["ld", "bathing", "floor", "toilet", "onef"]


class Staff(BaseModel):
    id: str
    name: str
    floor: Floor
    role: RoleType
    availableShiftTypes: list[str]
    availableDuties: list[DutyType]
    monthlyWorkDays: int | None = None
    weeklyWorkDays: int | None = None
    isNightOnly: bool | None = None
    nightShiftMin: int | None = None
    nightShiftMax: int | None = None
    isShortTime: bool | None = None
    excludeFromCount: bool | None = None
    unavailableDow: list[int] = Field(default_factory=list)
    unavailableOnHoliday: bool | None = None
    tags: list[str] = Field(default_factory=list)
    memo: str = ""
    highlightColor: str | None = None


class ShiftType(BaseModel):
    id: str
    name: str
    shortName: str
    startTime: str
    endTime: str
    color: str
    bgColor: str
    isDayShift: bool
    isNightShift: bool
    isAke: bool
    order: int


class FloorConfig(BaseModel):
    floor: Floor
    shiftRequirements: dict[str, list[int]]
    shiftRequirementsEnabled: dict[str, bool]
    holidayShiftRequirements: dict[str, int] | None = None
    useHolidayRequirements: bool | None = None
    dutyRequirements: dict[str, list[int]]
    holidayDutyRequirements: dict[str, int] | None = None
    leaderCountPerDay: int
    maxConsecutiveDays: int
    monthlyOffDays: int


class PairSetting(BaseModel):
    id: str
    staffId1: str
    staffId2: str
    type: PairType
    scope: PairScope
    memo: str = ""


class ShiftAssignment(BaseModel):
    staffId: str
    date: str
    shiftTypeId: str  # 'off' はセンチネル
    isLeader: bool = False
    isManual: bool | None = None
    duty: DutyType | None = None


class GenerateRequest(BaseModel):
    year: int
    month: int
    floor: Floor
    staff: list[Staff]
    shiftTypes: list[ShiftType]
    config: FloorConfig
    pairs: list[PairSetting] = Field(default_factory=list)
    holidays: list[str] = Field(default_factory=list)
    prevMonthAssignments: list[ShiftAssignment] = Field(default_factory=list)
    prefilled: list[ShiftAssignment] = Field(default_factory=list)
    timeLimitSeconds: float = 20.0


class GenerateResponse(BaseModel):
    status: Literal["optimal", "feasible", "infeasible", "error"]
    assignments: list[ShiftAssignment]
    solveTimeSeconds: float
    message: str | None = None
