import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

class D1TestStatement {
  constructor(statement) {
    this.statement = statement;
    this.params = [];
  }

  bind(...params) {
    const next = new D1TestStatement(this.statement);
    next.params = params;
    return next;
  }

  async all() {
    return { results: this.statement.all(...this.params) };
  }

  async get() {
    return this.statement.get(...this.params);
  }

  async raw() {
    return this.statement.all(...this.params).map((row) => Object.values(row));
  }

  async run() {
    const result = this.statement.run(...this.params);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

export class D1TestDatabase {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    return new D1TestStatement(this.db.prepare(sql));
  }

  async batch(statements) {
    const results = [];
    this.db.exec('BEGIN');
    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

export function createSchemaBackedD1() {
  const d1 = new D1TestDatabase();
  d1.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return d1;
}
