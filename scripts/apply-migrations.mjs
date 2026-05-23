#!/usr/bin/env node
// 顺序应用 schema.sql + migrations/*.sql 到 D1。
// 用法：
//   node scripts/apply-migrations.mjs --db=<DB-NAME> [--local|--remote]
//
// 内部维护 schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT) 表来防重复执行。

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function parseArgs(argv) {
  const args = { db: null, target: '--local' };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--db=')) args.db = a.slice('--db='.length);
    else if (a === '--local' || a === '--remote') args.target = a;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage: node scripts/apply-migrations.mjs --db=<NAME> [--local|--remote]

Applies, in order:
  1. schema.sql (idempotent: uses CREATE TABLE IF NOT EXISTS)
  2. migrations/NNNN_*.sql (each tracked in schema_migrations table)

Requires wrangler in PATH and a binding configured in wrangler.toml.
`);
}

function runWranglerSql(dbName, target, sql) {
  const tmp = join(repoRoot, '.migration-tmp.sql');
  writeFileSync(tmp, sql);
  try {
    execFileSync('wrangler', ['d1', 'execute', dbName, target, `--file=${tmp}`], {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } finally {
    try { unlinkSync(tmp); } catch { /* noop */ }
  }
}

function listAppliedVersions(dbName, target) {
  try {
    const out = execFileSync(
      'wrangler',
      [
        'd1', 'execute', dbName, target,
        '--command', 'SELECT version FROM schema_migrations ORDER BY version',
        '--json',
      ],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    const parsed = JSON.parse(out);
    const rows = parsed?.[0]?.results || [];
    return new Set(rows.map((r) => r.version));
  } catch {
    return new Set();
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.db) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const schemaPath = join(repoRoot, 'schema.sql');
  if (!existsSync(schemaPath)) {
    console.error(`schema.sql not found at ${schemaPath}`);
    process.exit(1);
  }

  console.log(`[1/3] Applying schema.sql to ${args.db} (${args.target})...`);
  runWranglerSql(args.db, args.target, readFileSync(schemaPath, 'utf8'));

  console.log('[2/3] Ensuring schema_migrations bookkeeping table...');
  runWranglerSql(args.db, args.target, `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('[3/3] Applying pending migrations...');
  const applied = listAppliedVersions(args.db, args.target);
  const dir = join(repoRoot, 'migrations');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    : [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) {
      console.log(`  ↩ skip ${version} (already applied)`);
      continue;
    }
    console.log(`  ↳ applying ${version}...`);
    const content = readFileSync(join(dir, file), 'utf8');
    runWranglerSql(
      args.db,
      args.target,
      `${content}\nINSERT OR IGNORE INTO schema_migrations (version) VALUES ('${version}');`,
    );
  }

  console.log('Done.');
}

main();
