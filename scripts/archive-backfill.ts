import { backfillArchive } from "../src/lib/archive";

backfillArchive({ limit: process.argv[2] ? Number(process.argv[2]) : undefined })
  .then((count) => console.log(`Archive backfill attempted ${count} dumps`))
  .catch((error) => { console.error(error); process.exitCode = 1; });
