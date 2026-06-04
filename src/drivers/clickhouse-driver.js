/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/clickhouse-driver
 */
import { createClient } from '@clickhouse/client';

/**
 * ClickHouse Driver
 * Implements ClickHouse database driver with environment variable control
 */
class ClickHouseDriver {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Initialize the ClickHouse client
   * @returns {Promise<Object>} ClickHouse connection
   */
  async connect() {
    // Check if ClickHouse is enabled via environment variable
    if (process.env.ENABLE_CLICKHOUSE !== 'true') {
      throw new Error('ClickHouse driver is disabled. Set ENABLE_CLICKHOUSE=true to enable.');
    }

    if (this.isConnected) return this.client;

    try {
      this.client = createClient({
        host: this.config.host || 'http://localhost:8123',
        username: this.config.user || 'default',
        password: this.config.password || '',
        database: this.config.database || 'default',
        // ClickHouse specific options
        clickhouse_settings: {
          async_insert: 1, // Enable async insert for better performance
          wait_for_async_insert: 0,
        },
        // Connection pool settings
        max_open_connections: this.config.pool?.max || 10,
        request_timeout: this.config.pool?.acquireTimeout || 10000,
        compression: {
          response: true,
          request: true
        }
      });
      
      // Test connection
      await this.client.ping();
      this.isConnected = true;
      return this.client;
    } catch (error) {
      console.error('❌ ClickHouse connection failed:', error.message);
      throw error;
    }
  }

  /**
   * Create connection pool (ClickHouse doesn't have traditional connection pool)
   * @returns {Promise<Object>} ClickHouse client
   */
  async createPool() {
    // ClickHouse client handles connection pooling internally
    return await this.connect();
  }

  /**
   * Execute SELECT query
   * @param {Object} connection - ClickHouse client
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(connection, sql, params = []) {
    await this.ensureConnected();
    
    try {
      // ClickHouse uses parameterized queries differently
      // We need to handle parameters manually
      let finalSql = sql;
      if (params && params.length > 0) {
        // Replace ? placeholders with ClickHouse format
        params.forEach((param, index) => {
          const placeholder = `{param${index}:${this.getClickHouseType(param)}}`;
          finalSql = finalSql.replace('?', placeholder);
        });
      }
      
      const resultSet = await connection.query({
        query: finalSql,
        format: 'JSONEachRow', // Return data as JSON array
        clickhouse_settings: {
          allow_experimental_object_type: 1
        }
      });
      
      const rows = await resultSet.json();
      return {
        rows,
        rowCount: rows.length,
        metaData: resultSet.meta || []
      };
    } catch (error) {
      console.error('❌ ClickHouse query error:', error.message);
      throw error;
    }
  }

  /**
   * Execute INSERT/UPDATE/DELETE operation
   * Note: ClickHouse has limited UPDATE/DELETE support
   * @param {Object} connection - ClickHouse client
   * @param {string} sql - SQL statement
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Execution result
   */
  async execute(connection, sql, params = []) {
    await this.ensureConnected();

    try {
      let finalSql = sql;
      if (params && params.length > 0) {
        // Replace ? placeholders with ClickHouse format
        params.forEach((param, index) => {
          const placeholder = `{param${index}:${this.getClickHouseType(param)}}`;
          finalSql = finalSql.replace('?', placeholder);
        });
      }

      // For INSERT operations, ClickHouse has optimized methods
      if (sql.toUpperCase().startsWith('INSERT')) {
        // Extract table name from INSERT statement
        const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
        if (tableMatch && tableMatch) {
          const tableName = tableMatch;
          // If params is an array of objects, use insert method
          if (params.length > 0 && typeof params === 'object') {
            await connection.insert({
              table: tableName,
              values: params,
              format: 'JSONEachRow'
            });
            return { affectedRows: params.length };
          }
        }
      }

      // For other operations, use command
      await connection.command({ query: finalSql });
      return { affectedRows: 1 };
    } catch (error) {
      console.error('❌ ClickHouse execute error:', error.message);
      throw error;
    }
  }

  /**
   * Get ClickHouse type for parameter
   * @param {*} value - Parameter value
   * @returns {string} ClickHouse type string
   */
  getClickHouseType(value) {
    if (value === null || value === undefined) return 'Nullable(Nothing)';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'Int64' : 'Float64';
    }
    if (typeof value === 'boolean') return 'UInt8';
    if (typeof value === 'string') return 'String';
    if (value instanceof Date) return 'DateTime';
    if (Array.isArray(value)) return 'Array(String)';
    if (typeof value === 'object') return 'JSON';
    return 'String';
  }

  /**
   * Begin transaction (ClickHouse has limited transaction support)
   * @param {Object} connection - ClickHouse client
   * @returns {Promise<Object>} Transaction object
   */
  async beginTransaction(connection) {
    console.warn('⚠️ ClickHouse has limited transaction support. Transactions may not work as expected.');
    // ClickHouse doesn't support traditional transactions for all operations
    return { sessionId: Date.now() };
  }

  /**
   * Commit transaction
   * @param {Object} transaction - Transaction object
   */
  async commitTransaction(transaction) {
    // ClickHouse doesn't support traditional commit
    console.warn('⚠️ ClickHouse transaction committed (no-op)');
  }

  /**
   * Rollback transaction
   * @param {Object} transaction - Transaction object
   */
  async rollbackTransaction(transaction) {
    // ClickHouse doesn't support traditional rollback
    console.warn('⚠️ ClickHouse transaction rolled back (no-op)');
  }

  /**
   * Close connection
   * @param {Object} connection - ClickHouse client
   */
  async close(connection) {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
    }
  }

  /**
   * Close pool (ClickHouse doesn't have traditional connection pool)
   * @param {Object} pool - Not used for ClickHouse
   */
  async closePool(pool) {
    await this.close();
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    return {
      isConnected: this.isConnected,
      // ClickHouse doesn't expose connection pool stats
      note: 'ClickHouse uses HTTP connection pooling internally'
    };
  }

  /**
   * Health check
   * @param {Object} connection - ClickHouse client
   * @returns {Promise<boolean>} Health status
   */
  async healthCheck(connection) {
    try {
      await connection.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure connection is established
   * @private
   */
  async ensureConnected() {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  /**
   * Get dialect name
   * @returns {string} Dialect name
   */
  getDialect() {
    return 'clickhouse';
  }
}

export default ClickHouseDriver;
