#!/usr/bin/env node

/**
 * Reconcile credit_transactions against user_quotas snapshots.
 *
 * Usage:
 *   node scripts/reconcile-credits.mjs --db clearcut-db --project clearcut --remote
 *   npm run credits:reconcile -- --db clearcut-db --project clearcut --remote --json
 *
 * This script is intentionally read-only. It reports drift instead of mutating balances.
 */

import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    db: 'clearcut-db',
    project: 'clearcut',
    json: false,
    remote: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--project') args.project = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--remote') args.remote = true;
  }

  return args;
}

function runD1({ db, remote, sql }) {
  const command = ['wrangler', 'd1', 'execute', db, '--command', sql, '--json'];
  if (remote) command.splice(4, 0, '--remote');

  const result = spawnSync('npx', command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'wrangler d1 execute failed');
  }

  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results || [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = args.project.replaceAll("'", "''");
  const driftSql = `
    WITH ledger AS (
      SELECT
        user_id,
        project_id,
        SUM(CASE WHEN source = 'purchased' THEN amount ELSE 0 END) AS purchased_ledger,
        SUM(CASE WHEN source = 'gifted' THEN amount ELSE 0 END) AS gifted_ledger,
        SUM(CASE WHEN source = 'monthly' THEN amount ELSE 0 END) AS monthly_net,
        SUM(CASE WHEN type = 'consume' THEN -amount ELSE 0 END) AS total_consumed,
        SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS total_refunded
      FROM credit_transactions
      WHERE project_id = '${project}'
      GROUP BY user_id, project_id
    )
    SELECT
      q.user_id,
      q.project_id,
      q.credits_purchased,
      COALESCE(l.purchased_ledger, 0) AS purchased_ledger,
      q.credits_gifted,
      COALESCE(l.gifted_ledger, 0) AS gifted_ledger,
      q.total_used,
      COALESCE(l.total_consumed, 0) - COALESCE(l.total_refunded, 0) AS net_used_ledger,
      (q.credits_purchased - COALESCE(l.purchased_ledger, 0)) AS purchased_delta,
      (q.credits_gifted - COALESCE(l.gifted_ledger, 0)) AS gifted_delta,
      (q.total_used - (COALESCE(l.total_consumed, 0) - COALESCE(l.total_refunded, 0))) AS used_delta
    FROM user_quotas q
    LEFT JOIN ledger l ON l.user_id = q.user_id AND l.project_id = q.project_id
    WHERE q.project_id = '${project}'
      AND (
        q.credits_purchased != COALESCE(l.purchased_ledger, 0)
        OR q.credits_gifted != COALESCE(l.gifted_ledger, 0)
        OR q.total_used != (COALESCE(l.total_consumed, 0) - COALESCE(l.total_refunded, 0))
      )
    ORDER BY q.user_id;
  `;
  const orphanSql = `
    SELECT
      t.user_id,
      t.project_id,
      COUNT(*) AS transaction_count,
      SUM(CASE WHEN t.source = 'purchased' THEN t.amount ELSE 0 END) AS purchased_ledger,
      SUM(CASE WHEN t.source = 'gifted' THEN t.amount ELSE 0 END) AS gifted_ledger,
      SUM(CASE WHEN t.type = 'consume' THEN -t.amount ELSE 0 END) AS total_consumed,
      SUM(CASE WHEN t.type = 'refund' THEN t.amount ELSE 0 END) AS total_refunded
    FROM credit_transactions t
    LEFT JOIN user_quotas q ON q.user_id = t.user_id AND q.project_id = t.project_id
    WHERE t.project_id = '${project}'
      AND q.id IS NULL
    GROUP BY t.user_id, t.project_id
    ORDER BY t.user_id;
  `;

  const driftRows = runD1({ db: args.db, remote: args.remote, sql: driftSql });
  const orphanRows = runD1({ db: args.db, remote: args.remote, sql: orphanSql });
  const result = {
    project: args.project,
    driftCount: driftRows.length,
    orphanLedgerCount: orphanRows.length,
    drift: driftRows,
    orphanLedger: orphanRows,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (driftRows.length === 0 && orphanRows.length === 0) {
    console.log(`No credit drift detected for project "${args.project}".`);
  } else {
    if (driftRows.length > 0) {
      console.log(`Credit snapshot drift detected for project "${args.project}":`);
      console.table(driftRows);
    }
    if (orphanRows.length > 0) {
      console.log(`Credit ledger rows without user_quota snapshot detected for project "${args.project}":`);
      console.table(orphanRows);
    }
  }

  if (driftRows.length > 0 || orphanRows.length > 0) process.exitCode = 1;
}

main();
