/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/sqlite-driver
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

class SQLiteDriver {
  constructor(config) {
    this.config = config;
    this.db = null;
  }

  async connect(config) {
    const db = await open({
      filename: config.database === ':memory:' ? ':memory:' : config.database,
      driver: sqlite3.Database,
      mode: config.mode === 'memory' ? sqlite3.OPEN_MEMORY : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    });
    this.db = db;
    return db;
  }

  async query(connection, sql, params = []) {
    const rows = await connection.all(sql, params);
    const info = await connection.run(sql, params);
    return {
      rows,
      rowCount: rows.length,
      lastID: info.lastID,
      changes: info.changes
    };
  }

  async execute(connection, sql, params = []) {
    const result = await connection.run(sql, params);
    return {
      lastID: result.lastID,
      changes: result.changes
    };
  }

  async beginTransaction(connection) {
    await connection.run('BEGIN TRANSACTION');
  }

  async commitTransaction(connection) {
    await connection.run('COMMIT');
  }

  async rollbackTransaction(connection) {
    await connection.run('ROLLBACK');
  }

  async close(connection) {
    await connection.close();
  }

  async healthCheck(connection) {
    const result = await connection.get('SELECT 1 as health');
    return result.health === 1;
  }
}

export default SQLiteDriver;
