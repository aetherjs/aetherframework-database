/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/postgres-driver
 */
import pg from 'pg';

/**
 * PostgreSQL Driver (also supports CockroachDB)
 * CockroachDB is PostgreSQL compatible, so we can reuse this driver
 */
class PostgreSQLDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  /**
   * Create a single connection
   * @param {Object} config - Connection configuration
   * @returns {Promise<Object>} PostgreSQL client
   */
  async connect(config) {
    // Check if this is a CockroachDB connection
    const isCockroachDB = config.type === 'cockroachdb' || config.type === 'cockroach';
    
    // For CockroachDB, we need to enable specific options
    const connectionConfig = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : false
    };

    // Add CockroachDB specific options if needed
    if (isCockroachDB) {
      // CockroachDB specific connection options
      connectionConfig.application_name = 'cockroachdb-driver';
      // CockroachDB often requires SSL
      if (!config.ssl && process.env.NODE_ENV === 'production') {
        console.warn('⚠️ CockroachDB in production should use SSL. Set ssl: true in config.');
      }
    }

    const client = new pg.Client(connectionConfig);
    await client.connect();
    return client;
  }

  /**
   * Create connection pool
   * @param {Object} config - Pool configuration
   * @returns {Promise<Object>} PostgreSQL pool
   */
  async createPool(config) {
    // Check if this is a CockroachDB connection
    const isCockroachDB = config.type === 'cockroachdb' || config.type === 'cockroach';
    
    const poolConfig = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: config.pool?.max || 10,
      min: config.pool?.min || 2,
      idleTimeoutMillis: config.pool?.idleTimeout || 30000,
      connectionTimeoutMillis: config.pool?.acquireTimeout || 10000
    };

    // Add CockroachDB specific pool options
    if (isCockroachDB) {
      poolConfig.application_name = 'cockroachdb-pool';
      // CockroachDB may need different pool settings
      poolConfig.max = config.pool?.max || 20; // Higher max connections for CockroachDB
    }

    this.pool = new pg.Pool(poolConfig);
    return this.pool;
  }

  /**
   * Execute SELECT query
   * @param {Object} connection - PostgreSQL client or pool client
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(connection, sql, params = []) {
    // Check if this is a CockroachDB connection
    const isCockroachDB = this.config.type === 'cockroachdb' || this.config.type === 'cockroach';
    
    // For CockroachDB, we might need to adjust some queries
    if (isCockroachDB) {
      // CockroachDB doesn't support some PostgreSQL features
      // We can add compatibility adjustments here if needed
      // For example, CockroachDB uses different serial types
      sql = this.adaptSQLForCockroachDB(sql);
    }

    const result = await connection.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields,
      command: result.command
    };
  }

  /**
   * Execute INSERT/UPDATE/DELETE operation
   * @param {Object} connection - PostgreSQL client or pool client
   * @param {string} sql - SQL statement
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Execution result
   */
  async execute(connection, sql, params = []) {
    // Check if this is a CockroachDB connection
    const isCockroachDB = this.config.type === 'cockroachdb' || this.config.type === 'cockroach';
    
    if (isCockroachDB) {
      sql = this.adaptSQLForCockroachDB(sql);
    }

    const result = await connection.query(sql, params);
    return {
      rowCount: result.rowCount,
      rows: result.rows
    };
  }

  /**
   * Adapt SQL for CockroachDB compatibility
   * @param {string} sql - Original SQL
   * @returns {string} Adapted SQL
   * @private
   */
  adaptSQLForCockroachDB(sql) {
    let adaptedSql = sql;
    
    // CockroachDB uses different syntax for some features
    // Add adaptations as needed
    
    // Example: Replace SERIAL with INT DEFAULT unique_rowid()
    // This is just an example - actual adaptations depend on your use case
    if (sql.includes('SERIAL')) {
      console.warn('⚠️ CockroachDB: SERIAL type is not supported. Consider using INT DEFAULT unique_rowid()');
    }
    
    return adaptedSql;
  }

  /**
   * Begin transaction
   * @param {Object} connection - PostgreSQL client
   */
  async beginTransaction(connection) {
    await connection.query('BEGIN');
  }

  /**
   * Commit transaction
   * @param {Object} connection - PostgreSQL client
   */
  async commitTransaction(connection) {
    await connection.query('COMMIT');
  }

  /**
   * Rollback transaction
   * @param {Object} connection - PostgreSQL client
   */
  async rollbackTransaction(connection) {
    await connection.query('ROLLBACK');
  }

  /**
   * Close connection
   * @param {Object} connection - PostgreSQL client
   */
  async close(connection) {
    await connection.end();
  }

  /**
   * Close connection pool
   * @param {Object} pool - PostgreSQL pool
   */
  async closePool(pool) {
    await pool.end();
  }

  /**
   * Get pool statistics
   * @param {Object} pool - PostgreSQL pool
   * @returns {Object} Pool statistics
   */
  getPoolStats(pool) {
    return {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  }

  /**
   * Health check
   * @param {Object} connection - PostgreSQL client
   * @returns {Promise<boolean>} Health status
   */
  async healthCheck(connection) {
    try {
      const result = await connection.query('SELECT 1 as health');
      return result.rows.health === 1;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get dialect name
   * @returns {string} Dialect name
   */
  getDialect() {
    const isCockroachDB = this.config.type === 'cockroachdb' || this.config.type === 'cockroach';
    return isCockroachDB ? 'cockroachdb' : 'postgresql';
  }
}

export default PostgreSQLDriver;
