-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "monthlyWorkDays" INTEGER,
    "weeklyWorkDays" INTEGER,
    "isNightOnly" BOOLEAN NOT NULL DEFAULT false,
    "nightShiftMin" INTEGER,
    "nightShiftMax" INTEGER,
    "isShortTime" BOOLEAN NOT NULL DEFAULT false,
    "excludeFromCount" BOOLEAN NOT NULL DEFAULT false,
    "unavailableDow" JSONB NOT NULL,
    "unavailableOnHoliday" BOOLEAN,
    "memo" TEXT NOT NULL DEFAULT '',
    "highlightColor" TEXT,
    "availableDuties" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "ShiftType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "isDayShift" BOOLEAN NOT NULL,
    "isNightShift" BOOLEAN NOT NULL,
    "isAke" BOOLEAN NOT NULL,
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "StaffTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PairSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staff1Id" TEXT NOT NULL,
    "staff2Id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PairSetting_staff1Id_fkey" FOREIGN KEY ("staff1Id") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PairSetting_staff2Id_fkey" FOREIGN KEY ("staff2Id") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TagPairSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tag1Id" TEXT NOT NULL,
    "tag2Id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "TagPairSetting_tag1Id_fkey" FOREIGN KEY ("tag1Id") REFERENCES "StaffTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TagPairSetting_tag2Id_fkey" FOREIGN KEY ("tag2Id") REFERENCES "StaffTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftTypeId" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "duty" TEXT,
    CONSTRAINT "ShiftAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShiftAssignment_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "ShiftType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FloorConfig" (
    "floor" TEXT NOT NULL PRIMARY KEY,
    "shiftRequirements" JSONB NOT NULL,
    "shiftRequirementsEnabled" JSONB NOT NULL,
    "holidayShiftRequirements" JSONB,
    "useHolidayRequirements" BOOLEAN NOT NULL DEFAULT false,
    "dutyRequirements" JSONB NOT NULL,
    "holidayDutyRequirements" JSONB,
    "leaderCountPerDay" INTEGER NOT NULL,
    "maxConsecutiveDays" INTEGER NOT NULL,
    "monthlyOffDays" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "StaffDayComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    CONSTRAINT "StaffDayComment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holiday" (
    "date" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "staffId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_StaffTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_StaffTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_StaffTags_B_fkey" FOREIGN KEY ("B") REFERENCES "StaffTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_StaffAvailableShiftTypes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_StaffAvailableShiftTypes_A_fkey" FOREIGN KEY ("A") REFERENCES "ShiftType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_StaffAvailableShiftTypes_B_fkey" FOREIGN KEY ("B") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Staff_floor_idx" ON "Staff"("floor");

-- CreateIndex
CREATE INDEX "PairSetting_staff1Id_idx" ON "PairSetting"("staff1Id");

-- CreateIndex
CREATE INDEX "PairSetting_staff2Id_idx" ON "PairSetting"("staff2Id");

-- CreateIndex
CREATE INDEX "TagPairSetting_tag1Id_idx" ON "TagPairSetting"("tag1Id");

-- CreateIndex
CREATE INDEX "TagPairSetting_tag2Id_idx" ON "TagPairSetting"("tag2Id");

-- CreateIndex
CREATE INDEX "ShiftAssignment_date_idx" ON "ShiftAssignment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_staffId_date_key" ON "ShiftAssignment"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDayComment_staffId_date_key" ON "StaffDayComment"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_staffId_key" ON "User"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "_StaffTags_AB_unique" ON "_StaffTags"("A", "B");

-- CreateIndex
CREATE INDEX "_StaffTags_B_index" ON "_StaffTags"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_StaffAvailableShiftTypes_AB_unique" ON "_StaffAvailableShiftTypes"("A", "B");

-- CreateIndex
CREATE INDEX "_StaffAvailableShiftTypes_B_index" ON "_StaffAvailableShiftTypes"("B");
