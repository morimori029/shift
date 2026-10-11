/*
  Warnings:

  - Added the required column `floor` to the `ShiftAssignment` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShiftAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "shiftTypeId" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "duty" TEXT,
    CONSTRAINT "ShiftAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShiftAssignment_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "ShiftType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- floorは、移行時点のStaff.floor（今のフロア）で埋める。これは過去の実際の
-- 勤務フロアの近似値でしかないが、現状で手に入る最良の情報のため採用する。
-- この移行以降に作成・更新される行は、各Server Actionがその時点の正しいfloorを明示的に設定する。
INSERT INTO "new_ShiftAssignment" ("id", "staffId", "date", "floor", "shiftTypeId", "isLeader", "isManual", "duty")
SELECT sa."id", sa."staffId", sa."date", COALESCE(st."floor", '1F'), sa."shiftTypeId", sa."isLeader", sa."isManual", sa."duty"
FROM "ShiftAssignment" sa
LEFT JOIN "Staff" st ON st."id" = sa."staffId";
DROP TABLE "ShiftAssignment";
ALTER TABLE "new_ShiftAssignment" RENAME TO "ShiftAssignment";
CREATE INDEX "ShiftAssignment_date_idx" ON "ShiftAssignment"("date");
CREATE INDEX "ShiftAssignment_date_floor_idx" ON "ShiftAssignment"("date", "floor");
CREATE UNIQUE INDEX "ShiftAssignment_staffId_date_key" ON "ShiftAssignment"("staffId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
