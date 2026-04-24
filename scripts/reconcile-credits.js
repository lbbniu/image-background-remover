#!/usr/bin/env node

/**
 * Reconcile credit_transactions against user_quotas snapshots.
 *
 * Usage:
 *   node scripts/reconcile-credits.js --db clearcut-db --project clearcut --remote
 *
 * This script is intentionally read-only. It reports drift instead of mutating balances.
 */

import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    db: 'clearcut-db',
    project: 'clearcut',
    remote: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--project') args.project = argv[++i];
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
  const sql = `
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
      WHERE project_id = '${args.project.replaceAll("'", "''")}'
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
    WHERE q.project_id = '${args.project.replaceAll("'", "''")}'
      AND (
        q.credits_purchased != COALESCE(l.purchased_ledger, 0)
        OR q.credits_gifted != COALESCE(l.gifted_ledger, 0)
        OR q.total_used != (COALESCE(l.total_consumed, 0) - COALESCE(l.total_refunded, 0))
      )
    ORDER BY q.user_id;
  `;

  const rows = runD1({ db: args.db, remote: args.remote, sql });
  if (rows.length === 0) {
    console.log(`No credit drift detected for project "${args.project}".`);
    return;
  }

  console.table(rows);
  process.exitCode = 1;
}

main();
