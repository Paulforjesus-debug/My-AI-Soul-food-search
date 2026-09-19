import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED 또는 DATABASE_URL이 필요합니다.");

const migrationsDir = join(process.cwd(), "migrations");
const migrationFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  for (const id of migrationFiles) {
    const applied = await pool.query("select 1 from schema_migrations where id = $1", [id]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationsDir, id), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (id) values ($1)", [id]);
      await client.query("commit");
      console.log(`Applied ${id}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
