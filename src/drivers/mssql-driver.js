/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/mssql-driver
 */
import sql from 'mssql';

class MSSQLDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async connect(config) {
    const connection = await sql.connect({
      server: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      options: {
        encrypt: config.options?.encrypt || false,
        trustServerCertificate: config.options?.trustServerCertificate || false,
        enableArithAbort: true
      },
      pool: {
        max: config.pool?.max || 10,
        min: config.pool?.min || 2,
        idleTimeoutMillis: config.pool?.idleTimeout || 30000,
        acquireTimeoutMillis: config.pool?.acquireTimeout || 10000
      }
    });
    return connection;
  }

  async createPool(config) {
    this.pool = new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      options: {
        encrypt: config.options?.encrypt || false,
        trustServerCertificate: config.options?.trustServerCertificate || false,
        enableArithAbort: true
      },
      pool: {
        max: config.pool?.max || 10,
        min: config.pool?.min || 2,
        idleTimeoutMillis: config.pool?.idleTimeout || 30000,
        acquireTimeoutMillis: config.pool?.acquireTimeout || 10000
      }
    });
    await this.pool.connect();
    return this.pool;
  }

  async query(connection, sqlText, params = []) {
    const request = connection.request();
    
    // Add parameters if provided
    params.forEach((param, index) => {
      request.input(`param${index}`, param);
    });
    
    const result = await request.query(sqlText);
    return {
      rows: result.recordset,
      rowCount: result.rowsAffected,
      recordsets: result.recordsets
    };
  }

  async execute(connection, sqlText, params = []) {
    return this.query(connection, sqlText, params);
  }

  async beginTransaction(connection) {
    const transaction = new sql.Transaction(connection);
    await transaction.begin();
    return transaction;
  }

  async commitTransaction(transaction) {
    await transaction.commit();
  }

  async rollbackTransaction(transaction) {
    await transaction.rollback();
  }

  async close(connection) {
    await connection.close();
  }

  async closePool(pool) {
    await pool.close();
  }

  getPoolStats(pool) {
    return {
      size: pool.size,
      available: pool.available,
      pending: pool.pending,
      borrowed: pool.borrowed
    };
  }

  async healthCheck(connection) {
    const result = await connection.request().query('SELECT 1 as health');
    return result.recordset.health === 1;
  }
}

export default MSSQLDriver;
