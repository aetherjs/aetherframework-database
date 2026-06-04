/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/VersioningPlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Versioning Plugin - Provides optimistic locking and data versioning functionality.
 * Prevents concurrent update conflicts and optionally maintains a version history table.
 */
export class VersioningPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.versionColumn = 'version';
    this.versionHistoryEnabled = false;
    this.versionHistoryTable = null;
    this.keyField = 'id';
  }

  _registerMethods() {
    // Register versioning methods to QueryBuilder
    this.queryBuilder.withOptimisticLock = this.withOptimisticLock.bind(this);
    this.queryBuilder.updateWithVersion = this.updateWithVersion.bind(this);
    this.queryBuilder.createVersionHistory = this.createVersionHistory.bind(this);
    this.queryBuilder.getVersionHistory = this.getVersionHistory.bind(this);
    this.queryBuilder.restoreFromVersion = this.restoreFromVersion.bind(this);
    this.queryBuilder.getCurrentVersion = this.getCurrentVersion.bind(this);
    this.queryBuilder.checkVersion = this.checkVersion.bind(this);

    // Override the update method to integrate version checking
    this._wrapUpdateMethod();
  }

  /**
   * Enable optimistic locking for the table.
   * @param {string} column - The name of the version column (default: 'version').
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  withOptimisticLock(column = 'version') {
    this.versionColumn = column;
    this.queryBuilder.query.optimisticLock = true;
    return this.queryBuilder;
  }

  /**
   * Perform an update with optimistic lock check.
   * @param {Object} data - The data to update.
   * @param {number} expectedVersion - The expected current version of the record.
   * @param {Object} options - Additional options (e.g., changedBy, changeReason).
   * @returns {Promise<Object>} The result of the update operation, including new version.
   */
  async updateWithVersion(data, expectedVersion, options = {}) {
    if (!this.versionColumn) {
      throw new Error('Optimistic lock is not enabled. Call withOptimisticLock() first.');
    }

    // Fetch the current record to check version and optionally log history
    const originalData = await this.queryBuilder.clone().first();
    if (!originalData) {
      throw new Error('Record not found');
    }

    if (originalData[this.versionColumn] !== expectedVersion) {
      throw new Error(
        `Optimistic lock failed: Record was modified by another transaction. ` +
        `Expected version: ${expectedVersion}, Actual version: ${originalData[this.versionColumn]}`
      );
    }

    // Increment the version in the update data
    const updateData = { ...data };
    updateData[this.versionColumn] = expectedVersion + 1;

    // Add version condition to WHERE clause
    this.queryBuilder.where(this.versionColumn, '=', expectedVersion);

    // Execute the update
    const result = await this.queryBuilder.update(updateData).execute();

    if (result.affectedRows === 0) {
      throw new Error('Optimistic lock failed: Record was modified by another transaction during update.');
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
   * Create a version history table and enable history tracking.
   * @param {string} historyTable - Name of the history table (defaults to `${mainTable}_history`).
   * @param {string} keyField - The primary key field name (default: 'id').
   * @returns {Promise<QueryBuilder>} The QueryBuilder instance.
   */
  async createVersionHistory(historyTable = null, keyField = 'id') {
    const tableName = historyTable || `${this.queryBuilder.tableName}_history`;
    this.versionHistoryEnabled = true;
    this.versionHistoryTable = tableName;
    this.keyField = keyField;

    // SQL to create the history table (example for MySQL/PostgreSQL syntax)
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ${keyField} BIGINT NOT NULL,
        version INT NOT NULL,
        data JSON NOT NULL,
        changed_by VARCHAR(255),
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        change_reason TEXT,
        INDEX idx_${keyField}_version (${keyField}, version),
        INDEX idx_changed_at (changed_at)
      )
    `;

    try {
      await this.queryBuilder.connection.query(createTableSQL);
    } catch (error) {
      console.error(`Failed to create version history table: ${error.message}`);
      throw error;
    }

    // Attach a hook to automatically record history on updates
    this.queryBuilder.addHook('beforeUpdate', async (data, builder) => {
      if (builder.query.optimisticLock) {
        await this._recordVersionHistoryOnUpdate(data, builder);
      }
    });

    return this.queryBuilder;
  }

  /**
   * Retrieve the version history for a specific record.
   * @param {number|string} recordId - The ID of the record.
   * @param {Object} options - Query options (limit, offset, order).
   * @returns {Promise<Array>} Array of historical versions.
   */
  async getVersionHistory(recordId, options = {}) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) {
      throw new Error('Version history is not enabled. Call createVersionHistory() first.');
    }

    const { limit = 100, offset = 0, orderBy = 'changed_at', orderDirection = 'DESC' } = options;

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
   * Restore a record to a specific historical version.
   * @param {number} historyId - The ID of the history record to restore from.
   * @param {Object} options - Restore options (restoredBy, restoreReason).
   * @returns {Promise<Object>} The result of the restore operation.
   */
  async restoreFromVersion(historyId, options = {}) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) {
      throw new Error('Version history is not enabled. Call createVersionHistory() first.');
    }

    // Fetch the historical record
    const historyQuery = new this.queryBuilder.constructor(
      this.versionHistoryTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );
    const historyRecord = await historyQuery.where('history_id', '=', historyId).first();

    if (!historyRecord) {
      throw new Error(`Version history record with ID ${historyId} not found.`);
    }

    // Parse the historical data
    const historicalData = typeof historyRecord.data === 'string'
      ? JSON.parse(historyRecord.data)
      : historyRecord.data;

    // Prepare update data, restoring the version and adding audit info
    const updateData = {
      ...historicalData,
      [this.versionColumn]: historyRecord.version,
      restored_from_version: historyId,
      restored_at: new Date(),
      restored_by: options.restoredBy || null,
      restore_reason: options.restoreReason || null
    };

    // Remove history-specific fields before update
    delete updateData.history_id;
    delete updateData.changed_at;
    delete updateData.changed_by;

    // Perform the restore update
    return this.queryBuilder
      .where(this.keyField, '=', historyRecord[this.keyField])
      .update(updateData)
      .execute();
  }

  /**
   * Get the current version of a record.
   * @param {number|string} recordId - The record ID.
   * @returns {Promise<number|null>} The current version number, or null if not found.
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
   * Check if a record's current version matches the expected version.
   * @param {number|string} recordId - The record ID.
   * @param {number} expectedVersion - The version to check against.
   * @returns {Promise<boolean>} True if versions match.
   */
  async checkVersion(recordId, expectedVersion) {
    const currentVersion = await this.getCurrentVersion(recordId);
    return currentVersion === expectedVersion;
  }

  /**
   * Wraps the original update method to inject version checking logic.
   * @private
   */
  _wrapUpdateMethod() {
    const originalUpdate = this.queryBuilder.update;
    this.queryBuilder.update = function(data) {
      // If optimistic locking is enabled and a version is provided in the data
      if (this.query.optimisticLock && data && data[this.versionColumn] !== undefined) {
        const expectedVersion = data[this.versionColumn];
        // Remove version from update data as it will be incremented
        delete data[this.versionColumn];
        // Add version check to WHERE clause
        this.where(this.versionColumn, '=', expectedVersion);
        // Increment version for the update
        data[this.versionColumn] = expectedVersion + 1;
      }
      return originalUpdate.call(this, data);
    }.bind(this.queryBuilder);
  }

  /**
   * Records a version history entry during an update operation.
   * @private
   */
  async _recordVersionHistoryOnUpdate(data, builder) {
    if (!this.versionHistoryEnabled || !this.versionHistoryTable) return;

    const current = await builder.clone().first();
    if (current && current[this.versionColumn] !== undefined) {
      await this._recordVersionHistory(current, data, {
        changed_by: data.changed_by,
        change_reason: data.change_reason
      });
    }
  }

  /**
   * Inserts a record into the version history table.
   * @private
   */
  async _recordVersionHistory(originalData, newData, options = {}) {
    const historyData = {
      [this.keyField]: originalData[this.keyField],
      version: originalData[this.versionColumn],
      data: JSON.stringify(originalData),
      changed_by: options.changed_by || null,
      change_reason: options.change_reason || null
    };

    const historyQuery = new this.queryBuilder.constructor(
      this.versionHistoryTable,
      this.queryBuilder.connection,
      this.queryBuilder.dialect
    );
    await historyQuery.insert(historyData);
  }

  /**
   * Returns the plugin's configuration.
   * @returns {Object} The configuration object.
   */
  getConfig() {
    return {
      versionColumn: this.versionColumn,
      versionHistoryEnabled: this.versionHistoryEnabled,
      versionHistoryTable: this.versionHistoryTable,
      keyField: this.keyField
    };
  }
}
