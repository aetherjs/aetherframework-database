/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/middleware/performance-monitor
 */
import { EventEmitter } from 'events';

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enabled: options.enabled !== false,
      slowQueryThreshold: options.slowQueryThreshold || 1000, // ms
      maxQueryHistory: options.maxQueryHistory || 1000,
      collectMetrics: options.collectMetrics !== false,
      metricsInterval: options.metricsInterval || 60000, // 1 minute
      alertThresholds: {
        slowQueriesPerMinute: options.alertThresholds?.slowQueriesPerMinute || 10,
        errorRate: options.alertThresholds?.errorRate || 0.1, // 10%
        connectionErrors: options.alertThresholds?.connectionErrors || 5,
        ...options.alertThresholds
      },
      ...options
    };
    
    this.queries = [];
    this.slowQueries = [];
    this.errors = [];
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      slowQueries: 0,
      totalQueryTime: 0,
      avgQueryTime: 0,
      maxQueryTime: 0,
      minQueryTime: Infinity,
      connections: new Map(),
      alerts: []
    };
    
    this.startMetricsCollection();
  }

  /**
   * Monitor query execution
   * @param {Object} query - Query object
   * @param {Function} execute - Query execution function
   * @returns {Promise<Object>} Query result
   */
  async monitor(query, execute) {
    if (!this.options.enabled) {
      return execute(query);
    }
    
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await execute(query);
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      
      const duration = endTime - startTime;
      const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
      
      this.recordQuery(query, duration, true, null, memoryDiff);
      
      // Check for slow query
      if (duration > this.options.slowQueryThreshold) {
        this.recordSlowQuery(query, duration);
        this.emit('slow-query', { query, duration, threshold: this.options.slowQueryThreshold });
      }
      
      return result;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.recordQuery(query, duration, false, error);
      this.recordError(query, error, duration);
      
      this.emit('query-error', { query, error, duration });
      throw error;
    }
  }

  /**
   * Record query execution
   * @param {Object} query - Query object
   * @param {number} duration - Execution duration in ms
   * @param {boolean} success - Whether query succeeded
   * @param {Error|null} error - Error object if failed
   * @param {number} memoryDiff - Memory difference in bytes
   */
  recordQuery(query, duration, success, error = null, memoryDiff = 0) {
    const queryRecord = {
      timestamp: new Date().toISOString(),
      sql: query.sql.substring(0, 200) + (query.sql.length > 200 ? '...' : ''),
      params: query.params,
      duration,
      success,
      error: error ? error.message : null,
      connection: query.connectionName || 'default',
      type: query.type || 'query',
      memoryDiff
    };
    
    // Add to query history
    this.queries.push(queryRecord);
    if (this.queries.length > this.options.maxQueryHistory) {
      this.queries.shift();
    }
    
    // Update metrics
    this.metrics.totalQueries++;
    if (success) {
      this.metrics.successfulQueries++;
    } else {
      this.metrics.failedQueries++;
    }
    
    this.metrics.totalQueryTime += duration;
    this.metrics.avgQueryTime = this.metrics.totalQueryTime / this.metrics.totalQueries;
    this.metrics.maxQueryTime = Math.max(this.metrics.maxQueryTime, duration);
    this.metrics.minQueryTime = Math.min(this.metrics.minQueryTime, duration);
    
    // Update connection metrics
    const connectionName = query.connectionName || 'default';
    if (!this.metrics.connections.has(connectionName)) {
      this.metrics.connections.set(connectionName, {
        totalQueries: 0,
        successfulQueries: 0,
        failedQueries: 0,
        totalQueryTime: 0,
        avgQueryTime: 0
      });
    }
    
    const connMetrics = this.metrics.connections.get(connectionName);
    connMetrics.totalQueries++;
    if (success) {
      connMetrics.successfulQueries++;
    } else {
      connMetrics.failedQueries++;
    }
    connMetrics.totalQueryTime += duration;
    connMetrics.avgQueryTime = connMetrics.totalQueryTime / connMetrics.totalQueries;
    
    this.emit('query-recorded', queryRecord);
  }

  /**
   * Record slow query
   * @param {Object} query - Query object
   * @param {number} duration - Execution duration in ms
   */
  recordSlowQuery(query, duration) {
    const slowQueryRecord = {
      timestamp: new Date().toISOString(),
      sql: query.sql.substring(0, 200) + (query.sql.length > 200 ? '...' : ''),
      params: query.params,
      duration,
      threshold: this.options.slowQueryThreshold,
      connection: query.connectionName || 'default',
      type: query.type || 'query'
    };
    
    this.slowQueries.push(slowQueryRecord);
    this.metrics.slowQueries++;
    
    // Check alert threshold
    const slowQueriesLastMinute = this.getSlowQueriesLastMinute();
    if (slowQueriesLastMinute > this.options.alertThresholds.slowQueriesPerMinute) {
      this.triggerAlert('slow-queries', {
        message: `High number of slow queries detected: ${slowQueriesLastMinute} in the last minute`,
        threshold: this.options.alertThresholds.slowQueriesPerMinute,
        actual: slowQueriesLastMinute,
        queries: this.slowQueries.slice(-10) // Last 10 slow queries
      });
    }
  }

  /**
   * Record error
   * @param {Object} query - Query object
   * @param {Error} error - Error object
   * @param {number} duration - Execution duration in ms
   */
  recordError(query, error, duration) {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      sql: query.sql.substring(0, 200) + (query.sql.length > 200 ? '...' : ''),
      params: query.params,
      duration,
      error: error.message,
      stack: error.stack,
      connection: query.connectionName || 'default',
      type: query.type || 'query'
    };
    
    this.errors.push(errorRecord);
    
    // Check error rate alert
    const errorRate = this.getErrorRate();
    if (errorRate > this.options.alertThresholds.errorRate) {
      this.triggerAlert('error-rate', {
        message: `High error rate detected: ${(errorRate * 100).toFixed(2)}%`,
        threshold: this.options.alertThresholds.errorRate,
        actual: errorRate,
        errors: this.errors.slice(-10) // Last 10 errors
      });
    }
  }

  /**
   * Get slow queries from last minute
   * @returns {number} Number of slow queries
   */
  getSlowQueriesLastMinute() {
    const oneMinuteAgo = Date.now() - 60000;
    return this.slowQueries.filter(q => 
      new Date(q.timestamp).getTime() > oneMinuteAgo
    ).length;
  }

  /**
   * Get error rate
   * @returns {number} Error rate (0-1)
   */
  getErrorRate() {
    if (this.metrics.totalQueries === 0) {
      return 0;
    }
    return this.metrics.failedQueries / this.metrics.totalQueries;
  }

  /**
   * Trigger alert
   * @param {string} type - Alert type
   * @param {Object} data - Alert data
   */
  triggerAlert(type, data) {
    const alert = {
      type,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    this.metrics.alerts.push(alert);
    if (this.metrics.alerts.length > 100) {
      this.metrics.alerts.shift();
    }
    
    this.emit('alert', alert);
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    if (!this.options.collectMetrics) {
      return;
    }
    
    setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.metricsInterval);
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const systemMetrics = {
      timestamp: new Date().toISOString(),
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers
      },
           cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      queries: {
        total: this.metrics.totalQueries,
        successful: this.metrics.successfulQueries,
        failed: this.metrics.failedQueries,
        slow: this.metrics.slowQueries,
        avgTime: this.metrics.avgQueryTime,
        maxTime: this.metrics.maxQueryTime,
        minTime: this.metrics.minQueryTime === Infinity ? 0 : this.metrics.minQueryTime
      },
      connections: Object.fromEntries(this.metrics.connections)
    };
    
    this.emit('metrics-collected', systemMetrics);
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const fiveMinutesAgo = now - 300000;
    const oneHourAgo = now - 3600000;
    
    const queriesLastMinute = this.queries.filter(q => 
      new Date(q.timestamp).getTime() > oneMinuteAgo
    );
    const queriesLastFiveMinutes = this.queries.filter(q => 
      new Date(q.timestamp).getTime() > fiveMinutesAgo
    );
    const queriesLastHour = this.queries.filter(q => 
      new Date(q.timestamp).getTime() > oneHourAgo
    );
    
    const slowQueriesLastMinute = this.slowQueries.filter(q => 
      new Date(q.timestamp).getTime() > oneMinuteAgo
    );
    
    const errorsLastMinute = this.errors.filter(e => 
      new Date(e.timestamp).getTime() > oneMinuteAgo
    );
    
    return {
      summary: {
        totalQueries: this.metrics.totalQueries,
        successfulQueries: this.metrics.successfulQueries,
        failedQueries: this.metrics.failedQueries,
        slowQueries: this.metrics.slowQueries,
        errorRate: this.getErrorRate(),
        avgQueryTime: this.metrics.avgQueryTime,
        maxQueryTime: this.metrics.maxQueryTime,
        minQueryTime: this.metrics.minQueryTime === Infinity ? 0 : this.metrics.minQueryTime
      },
      recent: {
        lastMinute: {
          queries: queriesLastMinute.length,
          slowQueries: slowQueriesLastMinute.length,
          errors: errorsLastMinute.length,
          avgDuration: queriesLastMinute.length > 0 
            ? queriesLastMinute.reduce((sum, q) => sum + q.duration, 0) / queriesLastMinute.length 
            : 0
        },
        lastFiveMinutes: {
          queries: queriesLastFiveMinutes.length,
          avgDuration: queriesLastFiveMinutes.length > 0 
            ? queriesLastFiveMinutes.reduce((sum, q) => sum + q.duration, 0) / queriesLastFiveMinutes.length 
            : 0
        },
        lastHour: {
          queries: queriesLastHour.length,
          avgDuration: queriesLastHour.length > 0 
            ? queriesLastHour.reduce((sum, q) => sum + q.duration, 0) / queriesLastHour.length 
            : 0
        }
      },
      connections: Object.fromEntries(this.metrics.connections),
      alerts: this.metrics.alerts.slice(-10), // Last 10 alerts
      settings: {
        slowQueryThreshold: this.options.slowQueryThreshold,
        maxQueryHistory: this.options.maxQueryHistory,
        alertThresholds: this.options.alertThresholds
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get slow queries
   * @param {number} limit - Maximum number of queries to return
   * @returns {Array} Slow queries
   */
  getSlowQueries(limit = 50) {
    return this.slowQueries.slice(-limit).reverse();
  }

  /**
   * Get recent errors
   * @param {number} limit - Maximum number of errors to return
   * @returns {Array} Recent errors
   */
  getRecentErrors(limit = 50) {
    return this.errors.slice(-limit).reverse();
  }

  /**
   * Get query history
   * @param {Object} filters - Filter options
   * @param {number} limit - Maximum number of queries to return
   * @returns {Array} Query history
   */
  getQueryHistory(filters = {}, limit = 100) {
    let filtered = [...this.queries];
    
    if (filters.connection) {
      filtered = filtered.filter(q => q.connection === filters.connection);
    }
    
    if (filters.type) {
      filtered = filtered.filter(q => q.type === filters.type);
    }
    
    if (filters.success !== undefined) {
      filtered = filtered.filter(q => q.success === filters.success);
    }
    
    if (filters.minDuration) {
      filtered = filtered.filter(q => q.duration >= filters.minDuration);
    }
    
    if (filters.maxDuration) {
      filtered = filtered.filter(q => q.duration <= filters.maxDuration);
    }
    
    if (filters.startTime) {
      const start = new Date(filters.startTime).getTime();
      filtered = filtered.filter(q => new Date(q.timestamp).getTime() >= start);
    }
    
    if (filters.endTime) {
      const end = new Date(filters.endTime).getTime();
      filtered = filtered.filter(q => new Date(q.timestamp).getTime() <= end);
    }
    
    return filtered.slice(-limit).reverse();
  }

  /**
   * Generate performance report
   * @returns {Object} Performance report
   */
  generateReport() {
    const metrics = this.getMetrics();
    const report = {
      timestamp: new Date().toISOString(),
      summary: metrics.summary,
      recommendations: [],
      issues: []
    };
    
    // Generate recommendations
    if (metrics.summary.errorRate > 0.05) {
      report.recommendations.push('High error rate detected. Consider reviewing query patterns and database connections.');
    }
    
    if (metrics.summary.avgQueryTime > 100) {
      report.recommendations.push('Average query time is high. Consider adding indexes or optimizing queries.');
    }
    
    if (metrics.recent.lastMinute.slowQueries > 5) {
      report.recommendations.push('Multiple slow queries detected in the last minute. Consider reviewing slow query logs.');
    }
    
    // Identify issues
    if (metrics.alerts.length > 0) {
      report.issues = metrics.alerts.map(alert => ({
        type: alert.type,
        message: alert.message,
        timestamp: alert.timestamp
      }));
    }
    
    // Connection analysis
    for (const [connection, stats] of Object.entries(metrics.connections)) {
      if (stats.failedQueries > 0) {
        report.issues.push({
          type: 'connection-errors',
          message: `Connection "${connection}" has ${stats.failedQueries} failed queries`,
          connection,
          failedQueries: stats.failedQueries
        });
      }
      
      if (stats.avgQueryTime > 500) {
        report.recommendations.push(`Connection "${connection}" has high average query time (${stats.avgQueryTime.toFixed(2)}ms). Consider optimizing queries or increasing connection pool size.`);
      }
    }
    
    // Memory usage analysis
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
    
    if (memoryUsageMB > 500) {
      report.issues.push({
        type: 'high-memory-usage',
        message: `High memory usage detected: ${memoryUsageMB.toFixed(2)} MB`,
        memoryUsage: memoryUsageMB
      });
      report.recommendations.push('High memory usage detected. Consider implementing query result pagination or reducing cache size.');
    }
    
    return report;
  }

  /**
   * Reset performance monitor
   */
  reset() {
    this.queries = [];
    this.slowQueries = [];
    this.errors = [];
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      slowQueries: 0,
      totalQueryTime: 0,
      avgQueryTime: 0,
      maxQueryTime: 0,
      minQueryTime: Infinity,
      connections: new Map(),
      alerts: []
    };
    this.emit('reset');
  }

  /**
   * Export performance data
   * @param {string} format - Export format (json, csv)
   * @returns {string} Exported data
   */
  export(format = 'json') {
    const data = {
      queries: this.queries,
      slowQueries: this.slowQueries,
      errors: this.errors,
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
    
    switch (format.toLowerCase()) {
      case 'csv':
        return this.exportToCSV(data);
      case 'json':
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Export to CSV
   * @param {Object} data - Data to export
   * @returns {string} CSV data
   */
  exportToCSV(data) {
    const csvLines = [];
    
    // Export queries
    if (data.queries.length > 0) {
      csvLines.push('=== QUERIES ===');
      const queryHeaders = Object.keys(data.queries[0]).join(',');
      csvLines.push(queryHeaders);
      data.queries.forEach(query => {
        const values = Object.values(query).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    // Export slow queries
    if (data.slowQueries.length > 0) {
      csvLines.push('\n=== SLOW QUERIES ===');
      const slowQueryHeaders = Object.keys(data.slowQueries[0]).join(',');
      csvLines.push(slowQueryHeaders);
      data.slowQueries.forEach(query => {
        const values = Object.values(query).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    // Export errors
    if (data.errors.length > 0) {
      csvLines.push('\n=== ERRORS ===');
      const errorHeaders = Object.keys(data.errors[0]).join(',');
      csvLines.push(errorHeaders);
      data.errors.forEach(error => {
        const values = Object.values(error).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    return csvLines.join('\n');
  }

  /**
   * Get health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const metrics = this.getMetrics();
    const errorRate = metrics.summary.errorRate;
    const slowQueryRate = metrics.recent.lastMinute.slowQueries;
    
    let status = 'healthy';
    let issues = [];
    
    if (errorRate > 0.1) {
      status = 'critical';
      issues.push(`High error rate: ${(errorRate * 100).toFixed(2)}%`);
    } else if (errorRate > 0.05) {
      status = 'warning';
      issues.push(`Moderate error rate: ${(errorRate * 100).toFixed(2)}%`);
    }
    
    if (slowQueryRate > 20) {
      status = 'critical';
      issues.push(`High number of slow queries: ${slowQueryRate} in last minute`);
    } else if (slowQueryRate > 10) {
      status = 'warning';
      issues.push(`Moderate number of slow queries: ${slowQueryRate} in last minute`);
    }
    
    if (metrics.summary.avgQueryTime > 1000) {
      status = 'critical';
      issues.push(`High average query time: ${metrics.summary.avgQueryTime.toFixed(2)}ms`);
    } else if (metrics.summary.avgQueryTime > 500) {
      status = 'warning';
      issues.push(`Moderate average query time: ${metrics.summary.avgQueryTime.toFixed(2)}ms`);
    }
    
    return {
      status,
      issues,
      metrics: {
        errorRate,
        slowQueryRate,
        avgQueryTime: metrics.summary.avgQueryTime,
        totalQueries: metrics.summary.totalQueries,
        timestamp: new Date().toISOString()
      }
    };
  }
}

export default PerformanceMonitor;
