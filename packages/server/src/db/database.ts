/**
 * Thin SQLite access layer without an ORM (spec §12; M3.05).
 */

import type { DatabaseSync, StatementResultingChanges } from "node:sqlite";
import { openDatabase, type DatabaseOptions } from "./migrate.js";

export type SQLValue = string | number | bigint | null | Uint8Array;

export type TransactionMode = "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE";

export class Database {
  readonly raw: DatabaseSync;

  constructor(raw: DatabaseSync) {
    this.raw = raw;
  }

  static open(options: DatabaseOptions = {}): Database {
    return new Database(openDatabase(options));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  get<T>(sql: string, ...params: SQLValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLValue[]): StatementResultingChanges {
    return this.raw.prepare(sql).run(...params);
  }

  transaction<T>(fn: () => T, mode: TransactionMode = "IMMEDIATE"): T {
    this.raw.exec(`BEGIN ${mode}`);
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        // The original error is more useful than a failed rollback.
      }
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}
