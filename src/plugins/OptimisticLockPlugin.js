/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/OptimisticLockPlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Optimistic Lock Plugin - Provides optimistic locking and data versioning
 * Prevents concurrent updates and maintains version history
 */
export class OptimisticLockPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.versionColumn = 'version';
    this.versionHistoryEnabled = false;
    this.versionHistoryTable = null;
    this.keyField = 'id';
  }

  /**
   * Initialize the plugin
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this._registerMethods();
  }

  /**
   * Register plugin methods to QueryBuilder
   * @protected
   */
  _registerMethods() {
    this.queryBuilder.withOptimisticLock = this.withOptimisticLock.bind(this);
    this.queryBuilder.updateWithVersion = this.updateWithVersion.bind(this);
    this.queryBuilder.createVersionHistory = this.createVersionHistory.bind(this);
    this.queryBuilder.getVersionHistory = this.getVersionHistory.bind(this);
    this.queryBuilder.restoreFromVersion = this.restoreFromVersion.bind(this);
    
    // Override update method to add version checking
    const originalUpdate = this.queryBuilder.update;
    this.queryBuilder.update = function(data) {
      // If optimistic lock is enabled and version column exists in data
      if (this.versionColumn && data && data[this.versionColumn] !== undefined) {
        const expectedVersion = data[this.versionColumn];
        delete data[this.versionColumn];
        
        // Add version check to WHERE clause
        this.where(this.versionColumn, '=', expectedVersion);
        
        // Increment version
        data[this.versionColumn] = expectedVersion + 1;
      }
      
      return originalUpdate.call(this, data);
    }.bind(this.queryBuilder);

    return this;
  }

  /**
   * Cleanup plugin resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    delete this.queryBuilder.withOptimisticLock;
    delete this.queryBuilder.updateWithVersion;
    delete this.queryBuilder.createVersionHistory;
    delete this.queryBuilder.getVersionHistory;
    delete this.queryBuilder.restoreFromVersion;
    
    // Restore original update method
    // Note: This requires storing the original method reference
    
    this.initialized = false;
  }

  /**
   * Enable optimistic locking
   * @param {Object} options - Configuration options
   * @param {string} options.column - Version column name (default: 'version')
   * @param {boolean} options.autoIncrement - Auto increment version (default: true)
   * @returns {QueryBuilder} Query builder instance
   */
  withOptimisticLock(options = {}) {
    this.versionColumn = options.column || 'version';
    this.autoIncrement = options.autoIncrement !== false;
    this.queryBuilder.query.optimisticLock = true;
    
    return this.queryBuilder;
  }

  /**
   * Update with version check (optimistic locking)
   * @param {Object} data - Data to update
   * @param {number} expectedVersion - Expected version number
   * @param {Object} options - Update options
   * @param {string} options.changedBy - User who made the change
   * @param {string} options.changeReason - Reason for the change
   * @returns {Promise<Object>} Update result
   */
  async updateWithVersion(data, expectedVersion, options = {}) {
    if (!this.versionColumn) {
      throw new Error('Optimistic lock is not enabled. Call withOptimisticLock() first.');
    }

    // Store original data for version history
    const originalData = await this.queryBuilder.clone().first();
    
    if (!originalData) {
      throw new Error('Record not found');
    }

    // Check version
    if (originalData[this.versionColumn] !== expectedVersion) {
      throw new Error(
        'Optimistic lock failed: record was modified by another transaction. ' +
        `Expected version: ${expectedVersion}, Actual version: ${originalData[this.versionColumn]}`
      );
    }

    // Increment version
    const updateData = { ...data };
    updateData[this.versionColumn] = expectedVersion + 1;

    // Add version check to WHERE clause
    this.queryBuilder.where(this.versionColumn, '=', expectedVersion);

    // Execute update
    const result = await this.queryBuilder.update(updateData).execute();

    if (result.affectedRows === 0) {
      throw new Error('Optimistic lock failed: record was modified by another transaction');
    }

    // Record version history if enabled
    if (this.versionHistoryEnabled && this.versionHistoryTable) {
      await this._recordVersionHistory(originalData, updateData, options);
    }

    return {
      ...result,
      newVersion: updateData[this.versionColumn],
      previousVersion: expectedVersion
    };
  }

  /**
   * Create version history table
   * @param {Object} options - Configuration options
   * @param {string} options.tableName - History table name (default: `${tableName}_history`)
   * @param {string} options.keyField - Primary key field name (default: 'id')
   * @param {boolean} options.autoCreate - Auto create table if not exists (default: true)
   * @returns {Promise<QueryBuilder>} Query builder instance
   */
  async createVersionHistory(options = {}) {
    const tableName = options.tableName || `${this.queryBuilder.tableName}_history`;
    const keyField = options.keyField || 'id';
    const autoCreate = options.autoCreate !== false;

    this.versionHistoryEnabled = true;
    this.versionHistoryTable = tableName;
    this.keyField = keyField;

    if (autoCreate) {
      await this._createHistoryTable(tableName, keyField);
    }

    // Add hook to record version history
    this.queryBuilder.addHook('beforeUpdate', async (data, query) => {
      await this._recordVersionHistoryOnUpdate(data, query);
    });

    return this.queryBuilder;
  }

  /**
   * Get version history for a record
   * @param {number|string} recordId - Record ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.orderBy - Order by column
   * @param {string} options.orderDirection - Order direction (ASC/DESC)
   * @returns {Promise<Array>} Version history
   */
  async getVersionHistory(recordId, options = {}) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) {
      throw new Error('Version history is not enabled. Call createVersionHistory() first.');
    }

    const {
      limit = 100,
      offset = 0,
      orderBy = 'changed_at',
      orderDirection = 'DESC'
    } = options;

    const historyQuery = new this.queryBuilder.constructor(
      this.versionHistoryTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );

    return historyQuery
      .where(this.keyField, '=', recordId)
      .orderBy(orderBy, orderDirection)
      .limit(limit)
      .offset(offset)
      .get();
  }

  /**
   * Restore record from specific version
   * @param {number} historyId - History record ID
   * @param {Object} options - Restore options
   * @param {string} options.restoredBy - User who performed restoration
   * @param {string} options.restoreReason - Reason for restoration
   * @returns {Promise<Object>} Restore result
   */
  async restoreFromVersion(historyId, options = {}) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) {
      throw new Error('Version history is not enabled. Call createVersionHistory() first.');
    }

    // Get history record
    const historyQuery = new this.queryBuilder.constructor(
      this.versionHistoryTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );

    const historyRecord = await historyQuery
      .where('history_id', '=', historyId)
      .first();

    if (!historyRecord) {
      throw new Error(`Version history record ${historyId} not found`);
    }

    // Parse historical data
    const historicalData = typeof historyRecord.data === 'string' 
      ? JSON.parse(historyRecord.data)
      : historyRecord.data;

    // Update current record with historical data
    const updateData = {
      ...historicalData,
      [this.versionColumn]: historyRecord.version,
      restored_from_version: historyId,
      restored_at: new Date(),
      restored_by: options.restoredBy || null,
      restore_reason: options.restoreReason || null
    };

    // Remove history-specific fields
    delete updateData.history_id;
    delete updateData.changed_at;
    delete updateData.changed_by;

    return this.queryBuilder
      .where(this.keyField, '=', historyRecord[this.keyField])
      .update(updateData)
      .execute();
  }

  /**
   * Create history table
   * @private
   */
  async _createHistoryTable(tableName, keyField) {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ${keyField} BIGINT NOT NULL,
        version INT NOT NULL,
        data JSON NOT NULL,
        changed_by VARCHAR(255),
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        change_type VARCHAR(50),
        change_reason TEXT,
        INDEX idx_${keyField}_version (${keyField}, version),
        INDEX idx_changed_at (changed_at)
      )
    `;

    await this.queryBuilder.connection.query(sql);
  }

  /**
   * Record version history on update
   * @private
   */
  async _recordVersionHistoryOnUpdate(data, query) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) {
      return;
    }

    const current = await query.clone().first();
    if (current && current[this.versionColumn]) {
      await this._recordVersionHistory(current, data, {
        changed_by: data.changed_by,
        change_type: 'UPDATE',
        change_reason: data.change_reason
      });
    }
  }

  /**
   * Record version history
   * @private
   */
  async _recordVersionHistory(originalData, newData, options = {}) {
    const historyData = {
      [this.keyField]: originalData[this.keyField],
      version: originalData[this.versionColumn],
      data: JSON.stringify(originalData),
      changed_by: options.changedBy || null,
      change_type: options.changeType || 'UPDATE',
      change_reason: options.changeReason || null
    };

    const historyQuery = new this.queryBuilder.constructor(
      this.versionHistoryTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );

    await historyQuery.insert(historyData);
  }

  /**
   * Get plugin configuration
   * @returns {Object} Configuration object
   */
  getConfig() {
    return {
      versionColumn: this.versionColumn,
      versionHistoryEnabled: this.versionHistoryEnabled,
      versionHistoryTable: this.versionHistoryTable,
      keyField: this.keyField,
      autoIncrement: this.autoIncrement
    };
  }

  /**
   * Get current version of record
   * @param {number|string} recordId - Record ID
   * @returns {Promise<number|null>} Current version number or null if not found
   */
  async getCurrentVersion(recordId) {
    const record = await this.queryBuilder
      .clone()
      .where(this.keyField, '=', recordId)
      .select(this.versionColumn)
      .first();

    return record ? record[this.versionColumn] : null;
  }

  /**
   * Compare versions
   * @param {number|string} recordId - Record ID
   * @param {number} expectedVersion - Expected version
   * @returns {Promise<boolean>} True if versions match
   */
  async checkVersion(recordId, expectedVersion) {
    const currentVersion = await this.getCurrentVersion(recordId);
    return currentVersion === expectedVersion;
  }
}
