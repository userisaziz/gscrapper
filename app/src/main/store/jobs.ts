import Database from "better-sqlite3";

export interface JobRecord {
  id: string;
  name: string;
  date: string;
  status: string;
  data: any;
}

/** Current jobs table schema. */
const CREATE_JOBS = `
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    data TEXT NOT NULL DEFAULT '{}'
  )
`;

export class JobStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  /**
   * Bring the jobs table up to the current schema, preserving existing rows.
   *
   * Older builds stored jobs with integer `created_at`/`updated_at` columns
   * and statuses like "ok". The current schema uses a `date` TEXT column and
   * "completed"/"failed" statuses. Without this migration, opening a database
   * created by an older build makes every query that references `date` throw
   * ("no such column: date"), which surfaces in the UI as "0 jobs".
   */
  private migrate(): void {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
      .get();

    if (!table) {
      this.db.exec(CREATE_JOBS);
      return;
    }

    const cols = this.db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));

    // Already on the current schema.
    if (names.has("date")) return;

    if (names.has("created_at")) {
      // Legacy schema — rebuild the table, carrying existing rows over.
      this.db.transaction(() => {
        this.db.exec(`ALTER TABLE jobs RENAME TO jobs_legacy`);
        this.db.exec(CREATE_JOBS);
        this.db.exec(`
          INSERT INTO jobs (id, name, date, status, data)
          SELECT
            id,
            name,
            strftime('%Y-%m-%dT%H:%M:%SZ', created_at, 'unixepoch'),
            CASE
              WHEN status IN ('ok', 'done', 'success', 'completed') THEN 'completed'
              WHEN status IN ('fail', 'failed', 'error') THEN 'failed'
              ELSE status
            END,
            data
          FROM jobs_legacy
        `);
        this.db.exec(`DROP TABLE jobs_legacy`);
      })();
    } else {
      // Unknown legacy schema — recreate empty rather than crash on every query.
      this.db.exec(`DROP TABLE jobs`);
      this.db.exec(CREATE_JOBS);
    }
  }

  create(job: JobRecord): void {
    this.db.prepare(
      "INSERT INTO jobs (id, name, date, status, data) VALUES (?, ?, ?, ?, ?)"
    ).run(job.id, job.name, job.date, job.status, JSON.stringify(job.data));
  }

  all(): JobRecord[] {
    const rows = this.db.prepare("SELECT * FROM jobs ORDER BY date DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      status: r.status,
      data: JSON.parse(r.data),
    }));
  }

  get(id: string): JobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return { id: row.id, name: row.name, date: row.date, status: row.status, data: JSON.parse(row.data) };
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }

  /**
   * Mark jobs left in a non-terminal state (pending/running) by a previous
   * session as failed. The scraper engine does not survive app restarts, so
   * such jobs will never complete and would otherwise show "pending" forever.
   */
  resetStaleJobs(): void {
    this.db
      .prepare("UPDATE jobs SET status = 'failed' WHERE status IN ('pending', 'running')")
      .run();
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
