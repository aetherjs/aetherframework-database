/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/ConnectionManager
 */

import { EventEmitter } from 'events';

/**
 * Connection Manager - Manages database connections with pooling and retry logic
 */
class ConnectionManager extends EventEmitter {
  /**
   * Create a new ConnectionManager instance
   * @param {Object} driver - Database driver instance
   * @param {Object} config - Connection configuration
   */
  constructor(driver, config) {
    super();
    this.driver = driver;
    this.config = config;
    this.connection = null;
    this.pool = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = config.retry?.maxAttempts || 3;
    this.retryDelay = config.retry?.delay || 1000;
    this.retryBackoff = config.retry?.backoff !== false;
  }

  /**
   * Connect to database
   * @returns {Promise<ConnectionManager>} Connected instance
   */
  async connect() {
    if (this.isConnected) {
      return this;
    }

    try {
      // Check if driver supports connection pooling
      if (this.config.pool && this.driver.createPool) {
        this.pool = await this.driver.createPool(this.config);
        this.connection = this.pool;
      } else {
        this.connection = await this.driver.connect(this.config);
      }

      this.isConnected = true;
      this.retryCount = 0;
      this.emit('connected', { type: this.config.type, config: this.config });
      return this;
    } catch (error) {
      this.emit('connection:error', { error, config: this.config });
      
      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = this.retryBackoff 
          ? this.retryDelay * Math.pow(2, this.retryCount - 1)
          : this.retryDelay;
        
        console.warn(`⚠️ Connection failed, retrying in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.connect();
      }

      throw new Error(`Failed to connect to ${this.config.type} database after ${this.maxRetries} attempts: ${error.message}`);
    }
  }

  /**
   * Execute query
   * @param {string} sql - SQL statement
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Query result
   */
  async query(sql, params = [], options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const startTime = Date.now();
      const result = await this.driver.query(this.connection, sql, params, options);
      const duration = Date.now() - startTime;

      this.emit('query:executed', { 
        sql, 
        params, 
        duration, 
        result,
        options 
      });

      return result;
    } catch (error) {
      this.emit('query:error', { sql, params, error, options });
      
      // Check if connection is still alive
      if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST') {
        console.warn('⚠️ Connection lost, attempting to reconnect...');
        this.isConnected = false;
        await this.connect();
        return this.query(sql, params, options);
      }

      throw error;
    }
  }

  /**
   * Execute transaction
   * @param {Function} callback - Transaction callback
   * @returns {Promise<*>} Transaction result
   */
  async transaction(callback) {
    if (!this.isConnected) {
      await this.connect();
    }

    if (!this.driver.beginTransaction) {
      throw new Error(`Transaction not supported for ${this.config.type} driver`);
    }

    try {
      await this.driver.beginTransaction(this.connection);
      this.emit('transaction:begin');

      const result = await callback({
        query: (sql, params) => this.query(sql, params),
        execute: (sql, params) => this.execute(sql, params)
      });

      await this.driver.commitTransaction(this.connection);
      this.emit('transaction:commit', { result });

      return result;
    } catch (error) {
      await this.driver.rollbackTransaction(this.connection);
      this.emit('transaction:rollback', { error });
      throw error;
    }
  }

  /**
   * Execute SQL statement (for INSERT, UPDATE, DELETE)
   * @param {string} sql - SQL statement
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Execution result
   */
  async execute(sql, params = [], options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const startTime = Date.now();
      const result = await this.driver.execute(this.connection, sql, params, options);
      const duration = Date.now() - startTime;

      this.emit('execute:completed', { 
        sql, 
        params, 
        duration, 
        result,
        options 
      });

      return result;
    } catch (error) {
      this.emit('execute:error', { sql, params, error, options });
      throw error;
    }
  }

  /**
   * Close connection
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.isConnected) {
      return;
    }

    try {
      if (this.pool && this.driver.closePool) {
        await this.driver.closePool(this.pool);
      } else if (this.driver.close) {
        await this.driver.close(this.connection);
      }

      this.isConnected = false;
      this.connection = null;
      this.pool = null;
      this.emit('closed');
    } catch (error) {
      this.emit('close:error', { error });
      throw error;
    }
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getStatus() {
    return {
      type: this.config.type,
      isConnected: this.isConnected,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      hasPool: !!this.pool,
      config: {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user
      }
    };
  }

  /**
   * Health check
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    if (!this.isConnected) {
      return {
        status: 'disconnected',
        message: 'Not connected to database',
        timestamp: new Date().toISOString()
      };
    }

    try {
      const startTime = Date.now();
      
      // Try a simple query to check connection health
      const healthQuery = this.getHealthQuery();
      await this.driver.query(this.connection, healthQuery.sql, healthQuery.params);
      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        type: this.config.type,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        type: this.config.type,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get health check query based on database type
   * @returns {Object} Health check query
   */
  getHealthQuery() {
    const queries = {
      mysql: { sql: 'SELECT 1', params: [] },
      postgresql: { sql: 'SELECT 1', params: [] },
      sqlite: { sql: 'SELECT 1', params: [] },
      mongodb: { sql: 'db.stats()', params: [] },
      redis: { sql: 'PING', params: [] },
      mssql: { sql: 'SELECT 1', params: [] },
      oracle: { sql: 'SELECT 1 FROM DUAL', params: [] }
    };

    return queries[this.config.type] || { sql: 'SELECT 1', params: [] };
  }

  /**
   * Get connection pool stats (if using pooling)
   * @returns {Object|null} Pool statistics
   */
  getPoolStats() {
    if (!this.pool || !this.driver.getPoolStats) {
      return null;
    }

    return this.driver.getPoolStats(this.pool);
  }

  /**
   * Reconnect to database
   * @returns {Promise<ConnectionManager>} Reconnected instance
   */
  async reconnect() {
    
    try {
      await this.close();
      await this.connect();
      return this;
    } catch (error) {
      this.emit('reconnect:error', { error });
      throw error;
    }
  }

  /**
   * Ping database connection
   * @returns {Promise<boolean>} True if ping successful
   */
  async ping() {
    if (!this.isConnected) {
      return false;
    }

    try {
      const health = await this.healthCheck();
      return health.status === 'healthy';
    } catch (error) {
      return false;
    }
  }
getDriver() {
return this.driver;
}
getType() {
return this.type;
}
  /**
   * Get connection metrics
   * @returns {Object} Connection metrics
   */
  getMetrics() {
    return {
      type: this.config.type,
      isConnected: this.isConnected,
      retryCount: this.retryCount,
      connectionTime: this.connectionTime,
      lastQueryTime: this.lastQueryTime,
      totalQueries: this.totalQueries || 0,
      failedQueries: this.failedQueries || 0,
      poolStats: this.getPoolStats(),
      timestamp: new Date().toISOString()
    };
  }
}

export default ConnectionManager;
