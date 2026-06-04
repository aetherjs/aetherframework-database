/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/BatchOperationPlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * Batch Operation Plugin - Optimizes performance and reliability for bulk data operations
 */
export class BatchOperationPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "BatchOperationPlugin";
  }

  _registerMethods() {
    // Register batch operation methods to QueryBuilder
    this.queryBuilder.batchUpdate = this.batchUpdate.bind(this);
    this.queryBuilder.batchDelete = this.batchDelete.bind(this);
    this.queryBuilder.batchUpsert = this.batchUpsert.bind(this);
    this.queryBuilder.batchIncrementDecrement = this.batchIncrementDecrement.bind(this);
    this.queryBuilder.insertBatch = this.insertBatch.bind(this);
    this.queryBuilder._optimizeChunkSize = this._optimizeChunkSize.bind(this);
  }

  /**
   * Batch update multiple records
   * @param {Array} data - Array of data objects for update
   * @param {string} keyField - Key field name (default: 'id')
   * @returns {Promise<Array>} Update results
   */
  async batchUpdate(data, keyField = "id") {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Data must be a non-empty array for batch update");
    }

    // Execute updates in parallel
    const promises = data.map((item) => {
      const keyValue = item[keyField];
      const updateData = { ...item };
      delete updateData[keyField];

      return this.queryBuilder.clone()
        .where(keyField, "=", keyValue)
        .update(updateData)
        .execute();
    });

    return Promise.all(promises);
  }

  /**
   * Batch delete multiple records by key values
   * @param {Array} values - Array of key values to delete
   * @param {string} keyField - Key field name (default: 'id')
   * @returns {Promise<Object>} Delete result
   */
  async batchDelete(values, keyField = "id") {
    return this.queryBuilder.whereIn(keyField, values).delete().execute();
  }

  /**
   * Batch upsert (insert or update)
   * @param {Array} data - Array of data objects
   * @param {Array} uniqueColumns - Unique constraint columns
   * @param {number} chunkSize - Chunk size for batch processing
   * @returns {Promise<Array>} Upsert results
   */
  async batchUpsert(data, uniqueColumns = ["id"], chunkSize = 100) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Data must be a non-empty array");
    }

    const results = [];

    // Process in chunks using Promise.all for parallel execution
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const chunkPromises = chunk.map((item) =>
        this.queryBuilder.clone().upsert(item, uniqueColumns),
      );

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Batch increment/decrement
   * @param {string} field - Field to increment/decrement
   * @param {Object} values - Object with key: amount pairs
   * @param {string} keyField - Key field name (default: 'id')
   * @param {boolean} increment - True for increment, false for decrement
   * @returns {Promise<Array>} Update results
   */
  async batchIncrementDecrement(
    field,
    values,
    keyField = "id",
    increment = true,
  ) {
    const results = [];
    for (const [keyValue, amount] of Object.entries(values)) {
      const query = this.queryBuilder.clone().where(keyField, "=", keyValue);
      const result = increment
        ? await query.increment(field, amount)
        : await query.decrement(field, amount);
      results.push(result);
    }
    return results;
  }

  /**
   * Batch insert with optimized chunk size
   * @param {Array} data - Array of data objects
   * @param {number} chunkSize - Chunk size for batch processing
   * @returns {Promise<Object>} Insert results
   */
  async insertBatch(data, chunkSize = 1000) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("insertBatch: data must be a non-empty array");
    }

    // Optimize chunk size based on data structure
    const optimizedChunkSize = this._optimizeChunkSize(chunkSize, data[0]);

    const results = [];
    for (let i = 0; i < data.length; i += optimizedChunkSize) {
      const chunk = data.slice(i, i + optimizedChunkSize);
      const result = await this.queryBuilder.clone().insert(chunk).execute();
      results.push(result);
    }

    return {
      success: true,
      totalInserted: data.length,
      affectedRows: results.reduce((sum, r) => sum + (r.affectedRows || 0), 0),
      chunks: results.length,
      details: results,
    };
  }

  /**
   * Optimize chunk size based on data structure
   * @param {number} defaultSize - Default chunk size
   * @param {Object} sampleRow - Sample data row
   * @returns {number} Optimized chunk size
   */
  _optimizeChunkSize(defaultSize, sampleRow) {
    if (!sampleRow) return Math.min(defaultSize, 1000);

    const columnCount = Object.keys(sampleRow).length;

    // MySQL recommendation: each SQL should not exceed 4~16MB
    if (columnCount > 35) return Math.min(defaultSize, 350); // Very wide table
    if (columnCount > 20) return Math.min(defaultSize, 650);
    if (columnCount > 12) return Math.min(defaultSize, 1100);
    if (columnCount > 6) return Math.min(defaultSize, 1800);
    return Math.min(defaultSize, 2500); // Narrow table can be larger
  }
}
