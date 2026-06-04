/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/AuditPlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Audit Plugin - Provides comprehensive audit logging functionality
 * Tracks all database operations with user context and metadata
 */
export class AuditPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.auditEnabled = false;
    this.auditOptions = {
      userId: null,
      action: 'unknown',
      metadata: {},
      auditTable: 'system_audit_logs'
    };
    this.auditHooks = new Map();
    this.logQueue = []; // 添加日志队列
    this.isProcessingQueue = false;
    this.queueProcessingInterval = null;
  }

  _registerMethods() {
    // Register audit methods to QueryBuilder
    this.queryBuilder.enableAuditLog = this.enableAuditLog.bind(this);
    this.queryBuilder.disableAuditLog = this.disableAuditLog.bind(this);
    this.queryBuilder.logAudit = this.logAudit.bind(this);
    this.queryBuilder.setAuditUser = this.setAuditUser.bind(this);
    this.queryBuilder.setAuditAction = this.setAuditAction.bind(this);
    this.queryBuilder.setAuditMetadata = this.setAuditMetadata.bind(this);
    this.queryBuilder.setAuditTable = this.setAuditTable.bind(this);
  }

  /**
   * Enable audit logging
   * @param {Object} options - Audit logging options
   * @returns {QueryBuilder} Query builder instance
   */
  enableAuditLog(options = {}) {
    this.auditEnabled = true;
    this.auditOptions = {
      ...this.auditOptions,
      ...options
    };

    // Add audit hooks
    this._addAuditHooks();
    
    // Create audit table if not exists
    this._ensureAuditTable();
    
    // Start background queue processor
    this._startQueueProcessor();
    
    return this.queryBuilder;
  }

  /**
   * Disable audit logging
   * @returns {QueryBuilder} Query builder instance
   */
  disableAuditLog() {
    this.auditEnabled = false;
    
    // Remove audit hooks
    this._removeAuditHooks();
    
    // Stop queue processor
    this._stopQueueProcessor();
    
    return this.queryBuilder;
  }

  /**
   * Set audit user ID
   * @param {string|number} userId - User identifier
   * @returns {QueryBuilder} Query builder instance
   */
  setAuditUser(userId) {
    this.auditOptions.userId = userId;
    return this.queryBuilder;
  }

  /**
   * Set audit action
   * @param {string} action - Action name (create, update, delete, etc.)
   * @returns {QueryBuilder} Query builder instance
   */
  setAuditAction(action) {
    this.auditOptions.action = action;
    return this.queryBuilder;
  }

  /**
   * Set audit metadata
   * @param {Object} metadata - Additional metadata
   * @returns {QueryBuilder} Query builder instance
   */
  setAuditMetadata(metadata) {
    this.auditOptions.metadata = {
      ...this.auditOptions.metadata,
      ...metadata
    };
    return this.queryBuilder;
  }

  /**
   * Set audit table name
   * @param {string} tableName - Audit table name
   * @returns {QueryBuilder} Query builder instance
   */
  setAuditTable(tableName) {
    this.auditOptions.auditTable = tableName;
    return this.queryBuilder;
  }

  /**
   * Start background queue processor
   * @private
   */
  _startQueueProcessor() {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
    }
    
    // Process queue every 100ms instead of immediate write
    this.queueProcessingInterval = setInterval(() => {
      this._processLogQueue();
    }, 100);
  }

  /**
   * Stop background queue processor
   * @private
   */
  _stopQueueProcessor() {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }
    
    // Process remaining logs
    this._processLogQueue();
  }

  /**
   * Process log queue asynchronously
   * @private
   */
  async _processLogQueue() {
    if (this.isProcessingQueue || this.logQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      // Take up to 100 logs at a time
      const logsToProcess = this.logQueue.splice(0, Math.min(100, this.logQueue.length));
      
      if (logsToProcess.length > 0) {
        // Batch insert logs
        await this._batchInsertAuditLogs(logsToProcess);
      }
    } catch (error) {
      console.error('Failed to process audit log queue:', error.message);
      // Requeue failed logs
      // In production, you might want to implement retry logic
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Batch insert audit logs
   * @param {Array} logs - Array of audit log entries
   * @private
   */
  async _batchInsertAuditLogs(logs) {
    if (logs.length === 0) return;
    
    const values = [];
    const placeholders = [];
    
    for (const log of logs) {
      values.push(
        log.userId,
        log.action,
        log.table_name,
        log.sql_query,
        log.bindings,
        log.query_type,
        log.affectedRows || 0,
        log.ip_address,
        log.user_agent,
        log.session_id,
        log.request_id,
        JSON.stringify(log.metadata),
        log.timestamp
      );
      
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    }
    
    const sql = `
      INSERT INTO ${this.auditOptions.auditTable} 
      (user_id, action, table_name, sql_query, bindings, query_type, 
       affected_rows, ip_address, user_agent, session_id, request_id, 
       metadata, created_at)
      VALUES ${placeholders.join(', ')}
    `;
    
    try {
      await this.queryBuilder.connection.query(sql, values);
    } catch (error) {
      console.error('Failed to batch insert audit logs:', error.message);
      throw error;
    }
  }

  /**
   * Log audit entry (async version)
   * @param {Object} data - Additional audit data
   * @returns {Promise<void>}
   */
  async logAudit(data) {
    if (!this.auditEnabled) {
      return;
    }

    const { sql, bindings } = this.queryBuilder.toSQL();
    const auditData = {
      ...this.auditOptions,
      ...data,
      table_name: this.queryBuilder.tableName,
      sql_query: sql,
      bindings: JSON.stringify(bindings),
      query_type: this.queryBuilder.query.type,
      timestamp: new Date(),
      ip_address: data.ipAddress || null,
      user_agent: data.userAgent || null,
      session_id: data.sessionId || null,
      request_id: data.requestId || null
    };

    // Queue the log instead of immediate insert
    this.logQueue.push(auditData);
    
    // If queue is getting large, trigger immediate processing
    if (this.logQueue.length > 1000) {
      this._processLogQueue();
    }
  }

  /**
   * Add audit hooks to QueryBuilder
   * @private
   */
  _addAuditHooks() {
    // Hook for insert operations
    const insertHook = async (data) => {
      await this.logAudit({
        action: 'create',
        affectedRows: data?.insertedCount || 1,
        metadata: { data }
      });
    };
    this.queryBuilder.addHook('afterInsert', insertHook);
    this.auditHooks.set('afterInsert', insertHook);

    // Hook for update operations
    const updateHook = async (result) => {
      await this.logAudit({
        action: 'update',
        affectedRows: result?.affectedRows || 0,
        metadata: { result }
      });
    };
    this.queryBuilder.addHook('afterUpdate', updateHook);
    this.auditHooks.set('afterUpdate', updateHook);

    // Hook for delete operations
    const deleteHook = async (result) => {
      await this.logAudit({
        action: 'delete',
        affectedRows: result?.affectedRows || 0,
        metadata: { result }
      });
    };
    this.queryBuilder.addHook('afterDelete', deleteHook);
    this.auditHooks.set('afterDelete', deleteHook);

    // Hook for select operations (optional, can be heavy)
    const selectHook = async (result) => {
      await this.logAudit({
        action: 'read',
        affectedRows: result?.length || 0,
        metadata: { rowCount: result?.length || 0 }
      });
    };
    this.queryBuilder.addHook('afterSelect', selectHook);
    this.auditHooks.set('afterSelect', selectHook);
  }

  /**
   * Remove audit hooks from QueryBuilder
   * @private
   */
  _removeAuditHooks() {
    for (const [event, hook] of this.auditHooks) {
      const hooks = this.queryBuilder.hooks[event];
      if (hooks) {
        const index = hooks.indexOf(hook);
        if (index > -1) {
          hooks.splice(index, 1);
        }
      }
    }
    this.auditHooks.clear();
  }

  /**
   * Ensure audit table exists
   * @private
   */
  async _ensureAuditTable() {
    try {
      await this.queryBuilder.connection.query(`
        CREATE TABLE IF NOT EXISTS ${this.auditOptions.auditTable} (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(255),
          action VARCHAR(50) NOT NULL,
          table_name VARCHAR(255) NOT NULL,
          sql_query TEXT NOT NULL,
          bindings TEXT,
          query_type VARCHAR(20),
          affected_rows INT DEFAULT 0,
          ip_address VARCHAR(45),
          user_agent TEXT,
          session_id VARCHAR(255),
          request_id VARCHAR(255),
          metadata JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_id (user_id),
          INDEX idx_action (action),
          INDEX idx_table_name (table_name),
          INDEX idx_created_at (created_at),
          INDEX idx_request_id (request_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (error) {
      console.warn('Failed to create audit table:', error.message);
    }
  }

  /**
   * Get audit logs
   * @param {Object} filters - Filter criteria
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Audit logs
   */
  async getAuditLogs(filters = {}, options = {}) {
    const {
      page = 1,
      perPage = 50,
      orderBy = 'created_at',
      orderDir = 'desc'
    } = options;

    const auditQuery = new this.queryBuilder.constructor(
      this.auditOptions.auditTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );

    // Apply filters
    if (filters.userId) {
      auditQuery.where('user_id', '=', filters.userId);
    }
    if (filters.action) {
      auditQuery.where('action', '=', filters.action);
    }
    if (filters.tableName) {
      auditQuery.where('table_name', '=', filters.tableName);
    }
    if (filters.startDate) {
      auditQuery.where('created_at', '>=', filters.startDate);
    }
    if (filters.endDate) {
      auditQuery.where('created_at', '<=', filters.endDate);
    }
    if (filters.requestId) {
      auditQuery.where('request_id', '=', filters.requestId);
    }

    // Apply ordering and pagination
    auditQuery.orderBy(orderBy, orderDir);
    
    return auditQuery.paginate(page, perPage).get();
  }

  /**
   * Clean old audit logs
   * @param {number} days - Keep logs for this many days
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanAuditLogs(days = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.queryBuilder.connection.query(
      `DELETE FROM ${this.auditOptions.auditTable} WHERE created_at < ?`,
      [cutoffDate]
    );

    return {
      deletedRows: result.affectedRows,
      cutoffDate: cutoffDate.toISOString()
    };
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: 'AuditPlugin',
      version: '1.0.0',
      description: 'Comprehensive audit logging for database operations',
      features: [
        'Automatic operation tracking',
        'User context logging',
        'Metadata support',
        'Audit log querying',
        'Automatic cleanup'
      ],
      tables: [this.auditOptions.auditTable]
    };
  }
}
