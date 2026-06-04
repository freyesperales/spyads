import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let _db: Database.Database | null = null;

function dbPath(): string {
  const raw = process.env.DATABASE_PATH || "./data/spyads.db";
  return resolve(raw);
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const p = dbPath();
  mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      countries TEXT NOT NULL DEFAULT '[]',
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      results_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS scans_email ON scans(email);
    CREATE INDEX IF NOT EXISTS scans_created ON scans(created_at);
  `);
  // Migration: existing DBs from before the per-source status column.
  // Adding a column with a default is non-destructive; skip if already there.
  try {
    db.exec(`ALTER TABLE scans ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists — fine.
  }
  _db = db;
  return db;
}

export interface ScanRow {
  id: string;
  brand: string;
  email: string;
  company: string | null;
  countries: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: "running" | "done" | "error";
  error: string | null;
  result_count: number;
  results_json: string;
  sources_json: string;
  created_at: number;
  completed_at: number | null;
}

export function insertScan(row: {
  id: string;
  brand: string;
  email: string;
  company?: string;
  countries: string[];
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO scans (id, brand, email, company, countries, utm_source, utm_medium, utm_campaign, status, created_at)
     VALUES (@id, @brand, @email, @company, @countries, @utm_source, @utm_medium, @utm_campaign, 'running', @created_at)`,
  ).run({
    id: row.id,
    brand: row.brand,
    email: row.email,
    company: row.company ?? null,
    countries: JSON.stringify(row.countries),
    utm_source: row.utmSource ?? null,
    utm_medium: row.utmMedium ?? null,
    utm_campaign: row.utmCampaign ?? null,
    created_at: Date.now(),
  });
}

export function completeScan(
  id: string,
  resultsJson: string,
  count: number,
  sourcesJson: string = "[]",
): void {
  getDb()
    .prepare(
      `UPDATE scans SET status='done', results_json=?, result_count=?, sources_json=?, completed_at=? WHERE id=?`,
    )
    .run(resultsJson, count, sourcesJson, Date.now(), id);
}

export function failScan(id: string, error: string): void {
  getDb()
    .prepare(
      `UPDATE scans SET status='error', error=?, completed_at=? WHERE id=?`,
    )
    .run(error, Date.now(), id);
}

export function getScan(id: string): ScanRow | undefined {
  return getDb().prepare(`SELECT * FROM scans WHERE id=?`).get(id) as
    | ScanRow
    | undefined;
}

export function listScans(): ScanRow[] {
  return getDb()
    .prepare(`SELECT * FROM scans ORDER BY created_at DESC LIMIT 1000`)
    .all() as ScanRow[];
}
