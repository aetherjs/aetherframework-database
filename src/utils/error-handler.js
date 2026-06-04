/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/src/utils/error-handler
 */
import { EventEmitter } from 'events';

/**
 * Error Handler - Centralized error handling for database operations
 */
class ErrorHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      logErrors: options.logErrors !== false,
      throwErrors: options.throwErrors !== false,
      retryOnError: options.retryOnError || false,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      errorCodes: {
        connection: ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND'],
        timeout: ['ETIMEDOUT', 'ESOCKETTIMEDOUT'],
        deadlock: ['ER_LOCK_DEADLOCK', '40P01', '40001'],
        duplicate: ['ER_DUP_ENTRY', '23505', '23000'],
        constraint: ['ER_NO_REFERENCED_ROW', 'ER_ROW_IS_REFERENCED', '23503', '23504'],
        syntax: ['ER_PARSE_ERROR', '42601', '42000'],
        ...options.errorCodes
      },
      ...options
    };
    
    this.errorStats = {
      totalErrors: 0,
      byType: {},
      byConnection: {},
      byDriver: {},
      recentErrors: []
    };
  }

   /**
   * Handle database error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Promise<Error>} Handled error
   */
  async handle(error, context = {}) {
    this.errorStats.totalErrors++;
    
    // Classify error
    const errorType = this.classifyError(error);
    const errorCode = error.code || error.errno || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';
    
    // Update error statistics
    this.updateErrorStats(errorType, errorCode, context);
    
    // Create enhanced error object
    const enhancedError = this.enhanceError(error, errorType, errorCode, context);
    
    // Log error if enabled
    if (this.options.logErrors) {
      this.logError(enhancedError, context);
    }
    
    // Emit error event
    this.emit('error', enhancedError);
    
    // Check if error is retryable
    if (this.options.retryOnError && this.isRetryableError(errorType, errorCode)) {
      return this.handleRetryableError(enhancedError, context);
    }
    
    // Throw error if configured
    if (this.options.throwErrors) {
      throw enhancedError;
    }
    
    return enhancedError;
  }

  /**
   * Classify error type
   * @param {Error} error - Error object
   * @returns {string} Error type
   */
  classifyError(error) {
    const errorCode = error.code || error.errno || '';
    const errorMessage = error.message || '';
    
    // Check connection errors
    if (this.options.errorCodes.connection.includes(errorCode) || 
        errorMessage.includes('connection') || 
        errorMessage.includes('connect')) {
      return 'connection';
    }
    
    // Check timeout errors
    if (this.options.errorCodes.timeout.includes(errorCode) || 
        errorMessage.includes('timeout') || 
        errorMessage.includes('timed out')) {
      return 'timeout';
    }
    
    // Check deadlock errors
    if (this.options.errorCodes.deadlock.includes(errorCode) || 
        errorMessage.includes('deadlock') || 
        errorMessage.includes('lock')) {
      return 'deadlock';
    }
    
    // Check duplicate errors
    if (this.options.errorCodes.duplicate.includes(errorCode) || 
        errorMessage.includes('duplicate') || 
        errorMessage.includes('unique constraint')) {
      return 'duplicate';
    }
    
    // Check constraint errors
    if (this.options.errorCodes.constraint.includes(errorCode) || 
        errorMessage.includes('constraint') || 
        errorMessage.includes('foreign key')) {
      return 'constraint';
    }
    
    // Check syntax errors
    if (this.options.errorCodes.syntax.includes(errorCode) || 
        errorMessage.includes('syntax') || 
        errorMessage.includes('parse')) {
      return 'syntax';
    }
    
    // Check authentication errors
    if (errorMessage.includes('authentication') || 
        errorMessage.includes('password') || 
        errorMessage.includes('access denied')) {
      return 'authentication';
    }
    
    // Check permission errors
    if (errorMessage.includes('permission') || 
        errorMessage.includes('access denied') || 
        errorMessage.includes('privilege')) {
      return 'permission';
    }
    
    // Check resource errors
    if (errorMessage.includes('resource') || 
        errorMessage.includes('memory') || 
        errorMessage.includes('disk')) {
      return 'resource';
    }
    
    return 'unknown';
  }

  /**
   * Update error statistics
   * @param {string} errorType - Error type
   * @param {string} errorCode - Error code
   * @param {Object} context - Error context
   */
  updateErrorStats(errorType, errorCode, context) {
    // Update by type
    if (!this.errorStats.byType[errorType]) {
      this.errorStats.byType[errorType] = 0;
    }
    this.errorStats.byType[errorType]++;
    
    // Update by connection
    const connection = context.connection || 'unknown';
    if (!this.errorStats.byConnection[connection]) {
      this.errorStats.byConnection[connection] = 0;
    }
    this.errorStats.byConnection[connection]++;
    
    // Update by driver
    const driver = context.driver || 'unknown';
    if (!this.errorStats.byDriver[driver]) {
      this.errorStats.byDriver[driver] = 0;
    }
    this.errorStats.byDriver[driver]++;
    
    // Add to recent errors
    const errorRecord = {
      timestamp: new Date().toISOString(),
      type: errorType,
      code: errorCode,
      message: context.message || 'Unknown error',
      connection,
      driver,
      sql: context.sql,
      params: context.params,
      stack: context.stack
    };
    
    this.errorStats.recentErrors.push(errorRecord);
    if (this.errorStats.recentErrors.length > 100) {
      this.errorStats.recentErrors.shift();
    }
  }

  /**
   * Enhance error with additional information
   * @param {Error} error - Original error
   * @param {string} errorType - Error type
   * @param {string} errorCode - Error code
   * @param {Object} context - Error context
   * @returns {Error} Enhanced error
   */
  enhanceError(error, errorType, errorCode, context) {
    const enhancedError = new Error(error.message);
    enhancedError.name = error.name || 'DatabaseError';
    enhancedError.code = errorCode;
    enhancedError.type = errorType;
    enhancedError.timestamp = new Date().toISOString();
    enhancedError.context = context;
    enhancedError.stack = error.stack;
    enhancedError.originalError = error;
    
    // Add suggestions based on error type
    enhancedError.suggestions = this.getErrorSuggestions(errorType, errorCode, context);
    
    // Add recovery strategies
    enhancedError.recoveryStrategies = this.getRecoveryStrategies(errorType, errorCode);
    
    return enhancedError;
  }

  /**
   * Get error suggestions
   * @param {string} errorType - Error type
   * @param {string} errorCode - Error code
   * @param {Object} context - Error context
   * @returns {Array} Error suggestions
   */
  getErrorSuggestions(errorType, errorCode, context) {
    const suggestions = [];
    
    switch (errorType) {
      case 'connection':
        suggestions.push('Check database server status');
        suggestions.push('Verify connection parameters (host, port, username, password)');
        suggestions.push('Check network connectivity');
        suggestions.push('Verify firewall settings');
        break;
      case 'timeout':
        suggestions.push('Increase query timeout settings');
        suggestions.push('Optimize slow queries');
        suggestions.push('Check database server load');
        suggestions.push('Consider adding database indexes');
        break;
      case 'deadlock':
        suggestions.push('Retry the transaction');
        suggestions.push('Review transaction isolation levels');
        suggestions.push('Optimize transaction order');
        suggestions.push('Consider using row-level locking');
        break;
      case 'duplicate':
        suggestions.push('Check for existing records before insert');
        suggestions.push('Use UPSERT operations');
        suggestions.push('Handle duplicate key gracefully');
        suggestions.push('Review unique constraints');
        break;
      case 'constraint':
        suggestions.push('Check foreign key relationships');
        suggestions.push('Verify data integrity');
        suggestions.push('Review constraint definitions');
        suggestions.push('Check referenced records exist');
        break;
      case 'syntax':
        suggestions.push('Review SQL syntax');
        suggestions.push('Check for missing or extra parentheses');
        suggestions.push('Verify table and column names');
        suggestions.push('Check for reserved keyword usage');
        break;
      case 'authentication':
        suggestions.push('Verify username and password');
        suggestions.push('Check user permissions');
        suggestions.push('Verify authentication method');
        suggestions.push('Check password expiration');
        break;
      case 'permission':
        suggestions.push('Check user permissions');
        suggestions.push('Verify database privileges');
        suggestions.push('Review access control lists');
        suggestions.push('Contact database administrator');
        break;
      case 'resource':
        suggestions.push('Increase database memory limits');
        suggestions.push('Optimize query performance');
        suggestions.push('Add database indexes');
        suggestions.push('Consider database scaling');
        break;
      default:
        suggestions.push('Review error details');
        suggestions.push('Check database logs');
        suggestions.push('Contact database administrator');
    }
    
    // Add context-specific suggestions
    if (context.sql) {
      suggestions.push('Review the executed SQL query');
    }
    
    if (context.params && context.params.length > 0) {
      suggestions.push('Check query parameter values');
    }
    
    return suggestions;
  }

  /**
   * Get recovery strategies
   * @param {string} errorType - Error type
   * @param {string} errorCode - Error code
   * @returns {Array} Recovery strategies
   */
  getRecoveryStrategies(errorType, errorCode) {
    const strategies = [];
    
    switch (errorType) {
      case 'connection':
        strategies.push('Retry connection with exponential backoff');
        strategies.push('Fallback to backup server if available');
        strategies.push('Use cached data if applicable');
        break;
      case 'timeout':
        strategies.push('Retry with increased timeout');
        strategies.push('Break query into smaller batches');
        strategies.push('Use asynchronous processing');
        break;
      case 'deadlock':
        strategies.push('Automatic retry with random delay');
        strategies.push('Implement deadlock detection and resolution');
        strategies.push('Use optimistic locking');
        break;
      case 'duplicate':
        strategies.push('Update existing record instead of insert');
        strategies.push('Ignore duplicate and continue');
        strategies.push('Return existing record');
        break;
      case 'constraint':
        strategies.push('Validate data before operation');
        strategies.push('Use transactions with proper rollback');
        strategies.push('Implement data validation at application level');
        break;
      case 'syntax':
        strategies.push('Validate SQL syntax before execution');
        strategies.push('Use parameterized queries');
        strategies.push('Implement SQL linting');
        break;
      default:
        strategies.push('Log error for investigation');
        strategies.push('Provide user-friendly error message');
        strategies.push('Implement circuit breaker pattern');
    }
    
    return strategies;
  }

  /**
   * Log error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  logError(error, context) {
    const logEntry = {
      timestamp: error.timestamp,
      type: error.type,
      code: error.code,
      message: error.message,
      name: error.name,
      connection: context.connection || 'unknown',
      driver: context.driver || 'unknown',
      sql: context.sql ? context.sql.substring(0, 200) + (context.sql.length > 200 ? '...' : '') : null,
      params: context.params,
      stack: error.stack,
      suggestions: error.suggestions,
      recoveryStrategies: error.recoveryStrategies
    };
    
    console.error('Database Error:', logEntry);
    
    // Emit log event
    this.emit('error-logged', logEntry);
  }

  /**
   * Check if error is retryable
   * @param {string} errorType - Error type
   * @param {string} errorCode - Error code
   * @returns {boolean} True if error is retryable
   */
  isRetryableError(errorType, errorCode) {
    const retryableTypes = ['connection', 'timeout', 'deadlock'];
    const retryableCodes = ['ETIMEDOUT', 'ECONNREFUSED', 'ER_LOCK_DEADLOCK', '40P01', '40001'];
    
    return retryableTypes.includes(errorType) || retryableCodes.includes(errorCode);
  }

  /**
   * Handle retryable error
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Promise<Error>} Handled error
   */
  async handleRetryableError(error, context) {
    const maxRetries = this.options.maxRetries;
    const retryDelay = this.options.retryDelay;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.emit('retry-attempt', { attempt, maxRetries, error, context });
        
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry the operation
        if (context.retryCallback) {
          return await context.retryCallback();
        }
        
        // If no retry callback, throw original error
        break;
      } catch (retryError) {
        if (attempt === maxRetries) {
          this.emit('retry-failed', { attempt, maxRetries, error: retryError, context });
          throw this.enhanceError(retryError, error.type, error.code, {
            ...context,
            retryAttempts: attempt,
            originalError: error
          });
        }
      }
    }
    
    return error;
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStats() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);
    
    const recentErrorsLastHour = this.errorStats.recentErrors.filter(
      error => new Date(error.timestamp) > oneHourAgo
    );
    
    const recentErrorsLastDay = this.errorStats.recentErrors.filter(
      error => new Date(error.timestamp) > oneDayAgo
    );
    
    // Calculate error rates
    const totalErrors = this.errorStats.totalErrors;
    const errorRateLastHour = recentErrorsLastHour.length;
    const errorRateLastDay = recentErrorsLastDay.length;
    
    // Find most common error types
    const errorTypes = Object.entries(this.errorStats.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    // Find most problematic connections
    const problematicConnections = Object.entries(this.errorStats.byConnection)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    // Find most problematic drivers
    const problematicDrivers = Object.entries(this.errorStats.byDriver)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return {
      summary: {
        totalErrors,
        errorRateLastHour,
        errorRateLastDay,
        timestamp: now.toISOString()
      },
      byType: errorTypes.reduce((acc, [type, count]) => {
        acc[type] = count;
        return acc;
      }, {}),
      byConnection: problematicConnections.reduce((acc, [connection, count]) => {
        acc[connection] = count;
        return acc;
      }, {}),
      byDriver: problematicDrivers.reduce((acc, [driver, count]) => {
        acc[driver] = count;
        return acc;
      }, {}),
      recentErrors: this.errorStats.recentErrors.slice(-10).reverse(),
      settings: {
        logErrors: this.options.logErrors,
        throwErrors: this.options.throwErrors,
        retryOnError: this.options.retryOnError,
        maxRetries: this.options.maxRetries,
        retryDelay: this.options.retryDelay
      }
    };
  }

  /**
   * Get error report
   * @returns {Object} Error report
   */
  getReport() {
    const stats = this.getStats();
    const report = {
      timestamp: new Date().toISOString(),
      summary: stats.summary,
      analysis: this.analyzeErrors(),
      recommendations: this.generateRecommendations(),
      topErrors: stats.recentErrors,
      errorDistribution: {
        byType: stats.byType,
        byConnection: stats.byConnection,
        byDriver: stats.byDriver
      }
    };
    
    return report;
  }

  /**
   * Analyze errors
   * @returns {Object} Error analysis
   */
  analyzeErrors() {
    const stats = this.getStats();
    const analysis = {
      issues: [],
      warnings: [],
      suggestions: []
    };
    
    // Check for high error rates
    if (stats.summary.errorRateLastHour > 10) {
      analysis.issues.push({
        type: 'high-error-rate',
        message: `High error rate detected: ${stats.summary.errorRateLastHour} errors in the last hour`,
        severity: 'high'
      });
      analysis.suggestions.push('Investigate connection pool settings');
      analysis.suggestions.push('Check database server health');
      analysis.suggestions.push('Review application error handling');
    }
    
    // Check for specific error patterns
    const connectionErrors = stats.byType.connection || 0;
    if (connectionErrors > 5) {
      analysis.warnings.push({
        type: 'connection-errors',
        message: `Multiple connection errors detected: ${connectionErrors}`,
        severity: 'medium'
      });
      analysis.suggestions.push('Verify database connection settings');
      analysis.suggestions.push('Check network connectivity');
      analysis.suggestions.push('Review connection pool configuration');
    }
    
    const timeoutErrors = stats.byType.timeout || 0;
    if (timeoutErrors > 3) {
      analysis.warnings.push({
        type: 'timeout-errors',
        message: `Multiple timeout errors detected: ${timeoutErrors}`,
        severity: 'medium'
      });
      analysis.suggestions.push('Increase query timeout settings');
      analysis.suggestions.push('Optimize slow queries');
      analysis.suggestions.push('Consider database indexing');
    }
    
    // Check for problematic connections
    const topConnection = Object.entries(stats.byConnection)[0];
    if (topConnection && topConnection[1] > 10) {
      analysis.warnings.push({
        type: 'problematic-connection',
        message: `Connection "${topConnection[0]}" has ${topConnection[1]} errors`,
        severity: 'medium'
      });
      analysis.suggestions.push(`Review connection "${topConnection[0]}" configuration`);
      analysis.suggestions.push('Check connection pool settings for this connection');
    }
    
    return analysis;
  }

  /**
   * Generate recommendations
   * @returns {Array} Recommendations
   */
  generateRecommendations() {
    const stats = this.getStats();
    const recommendations = [];
    
    // General recommendations
    if (stats.summary.totalErrors > 0) {
      recommendations.push('Implement comprehensive error logging and monitoring');
      recommendations.push('Set up alerts for critical error types');
      recommendations.push('Regularly review error reports and statistics');
    }
    
    // Specific recommendations based on error types
    if (stats.byType.connection > 0) {
      recommendations.push('Implement connection retry logic with exponential backoff');
      recommendations.push('Consider using connection pooling');
      recommendations.push('Set up database health checks');
    }
    
    if (stats.byType.timeout > 0) {
      recommendations.push('Optimize slow-running queries');
      recommendations.push('Add appropriate database indexes');
      recommendations.push('Consider query result caching');
    }
    
    if (stats.byType.deadlock > 0) {
      recommendations.push('Review transaction isolation levels');
      recommendations.push('Implement deadlock detection and retry logic');
      recommendations.push('Consider using optimistic locking');
    }
    
    if (stats.byType.duplicate > 0) {
      recommendations.push('Implement UPSERT operations');
      recommendations.push('Add duplicate key handling in application logic');
      recommendations.push('Consider using unique constraints with proper error handling');
    }
    
    return recommendations;
  }

  /**
   * Clear error statistics
   */
  clearStats() {
    this.errorStats = {
      totalErrors: 0,
      byType: {},
      byConnection: {},
      byDriver: {},
      recentErrors: []
    };
    this.emit('stats-cleared');
  }

  /**
   * Export error data
   * @param {string} format - Export format (json, csv)
   * @returns {string} Exported data
   */
  export(format = 'json') {
    const data = {
      stats: this.getStats(),
      recentErrors: this.errorStats.recentErrors,
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
    
    // Export error statistics
    csvLines.push('=== ERROR STATISTICS ===');
    csvLines.push('Metric,Value');
    csvLines.push(`Total Errors,${data.stats.summary.totalErrors}`);
    csvLines.push(`Errors Last Hour,${data.stats.summary.errorRateLastHour}`);
    csvLines.push(`Errors Last Day,${data.stats.summary.errorRateLastDay}`);
    csvLines.push(`Timestamp,${data.stats.summary.timestamp}`);
    
    // Export error types
    csvLines.push('\n=== ERROR TYPES ===');
    csvLines.push('Type,Count');
    Object.entries(data.stats.byType).forEach(([type, count]) => {
      csvLines.push(`${type},${count}`);
    });
    
    // Export recent errors
    if (data.recentErrors.length > 0) {
      csvLines.push('\n=== RECENT ERRORS ===');
      const headers = Object.keys(data.recentErrors[0]).join(',');
      csvLines.push(headers);
      data.recentErrors.forEach(error => {
        const values = Object.values(error).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    return csvLines.join('\n');
  }

  /**
   * Create error handler middleware
   * @returns {Function} Error handler middleware
   */
  createMiddleware() {
    return async (error, context) => {
      return await this.handle(error, context);
    };
  }
}

export default ErrorHandler;
