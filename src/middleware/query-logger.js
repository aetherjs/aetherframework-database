/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/middleware/query-logger
 */
import { EventEmitter } from 'events';

class QueryLogger extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enabled: options.enabled !== false,
      logLevel: options.logLevel || 'info',
      slowQueryThreshold: options.slowQueryThreshold || 1000, // ms
      logToConsole: options.logToConsole !== false,
      logToFile: options.logToFile || false,
      logFile: options.logFile || 'query.log',
      ...options
    };
    this.queries = [];
    this.slowQueries = [];
  }

  /**
   * Middleware function to log queries
   * @param {Object} query - Query object
   * @param {Function} next - Next middleware function
   * @returns {Promise<Object>} Query result
   */
  async log(query, next) {
    const startTime = Date.now();
    
    try {
      const result = await next(query);
      const duration = Date.now() - startTime;
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        sql: query.sql,
        params: query.params,
        duration,
        success: true,
        connection: query.connectionName,
        type: query.type || 'query'
      };
      
      this.queries.push(logEntry);
      
      // Check for slow queries
      if (duration > this.options.slowQueryThreshold) {
        this.slowQueries.push(logEntry);
        this.emit('slow-query', logEntry);
      }
      
      // Log to console if enabled
      if (this.options.logToConsole) {
        this.logToConsole(logEntry);
      }
      
      // Log to file if enabled
      if (this.options.logToFile) {
        this.logToFile(logEntry);
      }
      
      this.emit('query-logged', logEntry);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const logEntry = {
        timestamp: new Date().toISOString(),
        sql: query.sql,
        params: query.params,
        duration,
        success: false,
        error: error.message,
        connection: query.connectionName,
        type: query.type || 'query'
      };
      
      this.queries.push(logEntry);
      
      // Log error to console if enabled
      if (this.options.logToConsole) {
        this.logErrorToConsole(logEntry);
      }
      
      // Log error to file if enabled
      if (this.options.logToFile) {
        this.logErrorToFile(logEntry);
      }
      
      this.emit('query-error', logEntry);
      throw error;
    }
  }

  /**
   * Log query to console
   * @param {Object} logEntry - Log entry
   */
  logToConsole(logEntry) {
    const { timestamp, sql, duration, success, connection, type } = logEntry;
    const status = success ? '✅' : '❌';
    const message = `[${timestamp}] ${status} ${type.toUpperCase()} on ${connection} - ${duration}ms`;
    
    switch (this.options.logLevel) {
      case 'debug':
        console.debug(message, { sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : '') });
        break;
      case 'warn':
        if (!success || duration > this.options.slowQueryThreshold) {
          console.warn(message);
        }
        break;
      case 'error':
        if (!success) {
          console.error(message, logEntry.error);
        }
        break;
      default: // info
    }
  }

  /**
   * Log error to console
   * @param {Object} logEntry - Log entry
   */
  logErrorToConsole(logEntry) {
    const { timestamp, sql, duration, error, connection, type } = logEntry;
    console.error(`[${timestamp}] ❌ ${type.toUpperCase()} ERROR on ${connection} - ${duration}ms`);
    console.error(`  SQL: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`);
    console.error(`  Error: ${error}`);
  }

  /**
   * Log query to file
   * @param {Object} logEntry - Log entry
   */
  async logToFile(logEntry) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const logDir = path.dirname(this.options.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.options.logFile, logLine, 'utf8');
    } catch (error) {
      console.error('Failed to write query log to file:', error.message);
    }
  }

  /**
   * Log error to file
   * @param {Object} logEntry - Log entry
   */
  async logErrorToFile(logEntry) {
    await this.logToFile(logEntry);
  }

  /**
   * Get query statistics
   * @returns {Object} Query statistics
   */
  getStats() {
    const totalQueries = this.queries.length;
    const successfulQueries = this.queries.filter(q => q.success).length;
    const failedQueries = totalQueries - successfulQueries;
    const slowQueries = this.slowQueries.length;
    
    const avgDuration = totalQueries > 0 
      ? this.queries.reduce((sum, q) => sum + q.duration, 0) / totalQueries 
      : 0;
    
    const maxDuration = totalQueries > 0 
      ? Math.max(...this.queries.map(q => q.duration)) 
      : 0;
    
    const minDuration = totalQueries > 0 
      ? Math.min(...this.queries.filter(q => q.success).map(q => q.duration)) 
      : 0;
    
    return {
      totalQueries,
      successfulQueries,
      failedQueries,
      slowQueries,
      avgDuration: avgDuration.toFixed(2),
      maxDuration,
      minDuration,
      successRate: totalQueries > 0 ? (successfulQueries / totalQueries * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Get recent queries
   * @param {number} limit - Number of queries to return
   * @returns {Array} Recent queries
   */
  getRecentQueries(limit = 100) {
    return this.queries.slice(-limit);
  }

  /**
   * Get slow queries
   * @param {number} threshold - Slow query threshold in ms
   * @returns {Array} Slow queries
   */
  getSlowQueries(threshold = null) {
    const actualThreshold = threshold || this.options.slowQueryThreshold;
    return this.queries.filter(q => q.duration > actualThreshold);
  }

  /**
   * Clear query log
   */
  clear() {
    this.queries = [];
    this.slowQueries = [];
    this.emit('log-cleared');
  }

  /**
   * Export query log
   * @param {string} format - Export format (json, csv)
   * @returns {string} Exported data
   */
  export(format = 'json') {
    switch (format.toLowerCase()) {
      case 'csv':
        return this.exportToCSV();
      case 'json':
      default:
        return JSON.stringify(this.queries, null, 2);
    }
  }

  /**
   * Export to CSV
   * @returns {string} CSV data
   */
  exportToCSV() {
    if (this.queries.length === 0) {
      return '';
    }
    
    const headers = Object.keys(this.queries).join(',');
    const rows = this.queries.map(q => 
      Object.values(q).map(v => 
        typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
      ).join(',')
    );
    
    return [headers, ...rows].join('\n');
  }
}

export default QueryLogger;
