/**
 * Production migrations (DEPLOY.md 3, spec 13.6): applies pending forward-only migrations to the
 * PostgreSQL database in DATABASE_URL (Neon; run before `wrangler deploy`). Idempotent.
 *
 *   DATABASE_URL="postgres://…" pnpm db:migrate
 */
import { migrate } from '@chain-theorem/db';
import { postgresDb } from '@chain-theorem/db/node';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('db:migrate: set DATABASE_URL to the PostgreSQL connection string');
  process.exit(1);
}
const db = postgresDb(url, { max: 1 });
try {
  const applied = await migrate(db);
  console.log(
    applied.length === 0 ? 'db:migrate: up to date' : `db:migrate: applied ${applied.join(', ')}`,
  );
} finally {
  await db.destroy();
}
