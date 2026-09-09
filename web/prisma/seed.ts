import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { DEFAULT_SHIFT_TYPES, DEFAULT_FLOOR_CONFIGS } from '../src/domain/defaults';

const rawUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const url = rawUrl.startsWith('file:') ? rawUrl.slice('file:'.length) : rawUrl;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

async function main() {
  for (const st of DEFAULT_SHIFT_TYPES) {
    await db.shiftType.upsert({
      where: { id: st.id },
      create: st,
      update: st,
    });
  }

  for (const fc of DEFAULT_FLOOR_CONFIGS) {
    await db.floorConfig.upsert({
      where: { floor: fc.floor },
      create: {
        floor: fc.floor,
        shiftRequirements: fc.shiftRequirements,
        shiftRequirementsEnabled: fc.shiftRequirementsEnabled,
        dutyRequirements: fc.dutyRequirements,
        leaderCountPerDay: fc.leaderCountPerDay,
        maxConsecutiveDays: fc.maxConsecutiveDays,
        monthlyOffDays: fc.monthlyOffDays,
      },
      update: {},
    });
  }

  console.log(`seeded: ${DEFAULT_SHIFT_TYPES.length} shift types, ${DEFAULT_FLOOR_CONFIGS.length} floor configs`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
