/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/SoftDeletePlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Soft Delete Plugin - Provides soft delete functionality
 * Automatically adds deleted_at IS NULL condition to queries
 */
export class SoftDeletePlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.softDeleteEnabled = false;
    this.softDeleteColumn = 'deleted_at';
    this.deletedByColumn = 'deleted_by';
    this.deletedReasonColumn = 'deleted_reason';
    this.restoredAtColumn = 'restored_at';
    this.restoredByColumn = 'restored_by';
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
    this.queryBuilder.enableSoftDelete = this.enableSoftDelete.bind(this);
    this.queryBuilder.softDelete = this.softDelete.bind(this);
    this.queryBuilder.restore = this.restore.bind(this);
    this.queryBuilder.withTrashed = this.withTrashed.bind(this);
    this.queryBuilder.onlyTrashed = this.onlyTrashed.bind(this);
    this.queryBuilder.forceDelete = this.forceDelete.bind(this);
    
    // Override the execute method to add soft delete filtering
    const originalExecute = this.queryBuilder.execute;
    this.queryBuilder.execute = async function() {
      // Add soft delete filter for SELECT queries
      if (this.query.type === 'select' && this.softDeleteEnabled && !this.query.includeDeleted) {
        this.whereNull(this.softDeleteColumn);
      }
      return originalExecute.call(this);
    }.bind(this.queryBuilder);

    return this;
  }

  /**
   * Cleanup plugin resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    delete this.queryBuilder.enableSoftDelete;
    delete this.queryBuilder.softDelete;
    delete this.queryBuilder.restore;
    delete this.queryBuilder.withTrashed;
    delete this.queryBuilder.onlyTrashed;
    delete this.queryBuilder.forceDelete;
    
    // Restore original execute method
    // Note: This requires storing the original method reference
    
    this.initialized = false;
  }

  /**
   * Enable soft delete functionality
   * @param {Object} options - Configuration options
   * @param {string} options.column - Soft delete column name (default: 'deleted_at')
   * @param {string} options.deletedByColumn - Deleted by column name (default: 'deleted_by')
   * @param {string} options.deletedReasonColumn - Deleted reason column name (default: 'deleted_reason')
   * @param {string} options.restoredAtColumn - Restored at column name (default: 'restored_at')
   * @param {string} options.restoredByColumn - Restored by column name (default: 'restored_by')
   * @returns {QueryBuilder} Query builder instance
   */
  enableSoftDelete(options = {}) {
    this.softDeleteEnabled = true;
    this.softDeleteColumn = options.column || 'deleted_at';
    this.deletedByColumn = options.deletedByColumn || 'deleted_by';
    this.deletedReasonColumn = options.deletedReasonColumn || 'deleted_reason';
    this.restoredAtColumn = options.restoredAtColumn || 'restored_at';
    this.restoredByColumn = options.restoredByColumn || 'restored_by';
    
    return this.queryBuilder;
  }

  /**
   * Perform soft delete (mark as deleted instead of physical delete)
   * @param {Object} options - Soft delete options
   * @param {string|number} options.deletedBy - User ID or name who performed deletion
   * @param {string} options.reason - Reason for deletion
   * @returns {Promise<Object>} Delete result
   */
  async softDelete(options = {}) {
    if (!this.softDeleteEnabled) {
      throw new Error('Soft delete is not enabled. Call enableSoftDelete() first.');
    }

    const updateData = {
      [this.softDeleteColumn]: new Date()
    };

    // Add deleted_by if provided
    if (options.deletedBy !== undefined) {
      updateData[this.deletedByColumn] = options.deletedBy;
    }

    // Add deleted_reason if provided
    if (options.reason !== undefined) {
      updateData[this.deletedReasonColumn] = options.reason;
    }

    // Ensure we only update non-deleted records
    if (!this.queryBuilder.query.where.some(
      w => w.column === this.softDeleteColumn && w.type === 'null'
    )) {
      this.queryBuilder.whereNull(this.softDeleteColumn);
    }

    return this.queryBuilder
      .update(updateData)
      .execute();
  }

  /**
   * Restore soft deleted records
   * @param {Object} options - Restore options
   * @param {string|number} options.restoredBy - User ID or name who performed restoration
   * @returns {Promise<Object>} Update result
   */
  async restore(options = {}) {
    if (!this.softDeleteEnabled) {
      throw new Error('Soft delete is not enabled. Call enableSoftDelete() first.');
    }

    const updateData = {
      [this.softDeleteColumn]: null,
      [this.restoredAtColumn]: new Date()
    };

    // Add restored_by if provided
    if (options.restoredBy !== undefined) {
      updateData[this.restoredByColumn] = options.restoredBy;
    }

    // Only restore deleted records
    this.queryBuilder.whereNotNull(this.softDeleteColumn);

    return this.queryBuilder
      .update(updateData)
      .execute();
  }

  /**
   * Include soft deleted records in query
   * @returns {QueryBuilder} Query builder instance
   */
  withTrashed() {
    this.queryBuilder.query.includeDeleted = true;
    
    // Remove soft delete filter if present
    this.queryBuilder.query.where = this.queryBuilder.query.where.filter(
      w => !(w.column === this.softDeleteColumn && w.type === 'null')
    );
    
    return this.queryBuilder;
  }

  /**
   * Query only soft deleted records
   * @returns {QueryBuilder} Query builder instance
   */
  onlyTrashed() {
    if (!this.softDeleteEnabled) {
      throw new Error('Soft delete is not enabled. Call enableSoftDelete() first.');
    }

    this.queryBuilder.whereNotNull(this.softDeleteColumn);
    return this.queryBuilder;
  }

  /**
   * Force delete (permanent delete)
   * @returns {Promise<Object>} Delete result
   */
  async forceDelete() {
    // Remove soft delete filter
    this.queryBuilder.query.where = this.queryBuilder.query.where.filter(
      w => !(w.column === this.softDeleteColumn && w.type === 'null')
    );

    return this.queryBuilder.delete().execute();
  }

  /**
   * Get soft delete configuration
   * @returns {Object} Configuration object
   */
  getConfig() {
    return {
      enabled: this.softDeleteEnabled,
      column: this.softDeleteColumn,
      deletedByColumn: this.deletedByColumn,
      deletedReasonColumn: this.deletedReasonColumn,
      restoredAtColumn: this.restoredAtColumn,
      restoredByColumn: this.restoredByColumn
    };
  }

  /**
   * Check if record is soft deleted
   * @param {Object} record - Database record
   * @returns {boolean} True if record is soft deleted
   */
  isSoftDeleted(record) {
    if (!this.softDeleteEnabled) return false;
    return record[this.softDeleteColumn] !== null && record[this.softDeleteColumn] !== undefined;
  }

  /**
   * Get soft delete status
   * @param {Object} record - Database record
   * @returns {Object} Soft delete status information
   */
  getSoftDeleteStatus(record) {
    if (!this.softDeleteEnabled) {
      return { enabled: false, deleted: false };
    }

    const deleted = this.isSoftDeleted(record);
    const status = {
      enabled: true,
      deleted,
      deletedAt: record[this.softDeleteColumn],
      deletedBy: record[this.deletedByColumn],
      deletedReason: record[this.deletedReasonColumn]
    };

    if (!deleted && record[this.restoredAtColumn]) {
      status.restored = true;
      status.restoredAt = record[this.restoredAtColumn];
      status.restoredBy = record[this.restoredByColumn];
    }

    return status;
  }
}
