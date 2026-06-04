/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/SyncPlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Sync Plugin - Provides cross-database data synchronization functionality
 * Supports bidirectional sync, conflict resolution, and batch processing
 */
export class SyncPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.syncConfig = {
      conflictStrategy: 'update',
      batchSize: 1000,
      keyField: 'id',
      timestampField: 'updated_at',
      onConflict: null,
      onProgress: null
    };
  }

  _registerMethods() {
    // Register sync methods to QueryBuilder
    this.queryBuilder.syncTo = this.syncTo.bind(this);
    this.queryBuilder.syncBidirectional = this.syncBidirectional.bind(this);
    this.queryBuilder.setSyncConfig = this.setSyncConfig.bind(this);
    this.queryBuilder.migrateData = this.migrateData.bind(this);
  }

  /**
   * Set synchronization configuration
   * @param {Object} config - Sync configuration
   * @returns {QueryBuilder} Query builder instance
   */
  setSyncConfig(config = {}) {
    this.syncConfig = {
      ...this.syncConfig,
      ...config
    };
    return this.queryBuilder;
  }

  /**
   * Sync data to another database
   * @param {Object} targetDb - Target database connection
   * @param {string} targetTable - Target table name
   * @param {Object} options - Sync options
   * @returns {Promise<number>} Number of synced records
   */
  async syncTo(targetDb, targetTable, options = {}) {
    const config = {
      ...this.syncConfig,
      ...options
    };

    let offset = 0;
    let totalSynced = 0;
    let totalRecords = 0;

    // Get total record count
    const countResult = await this.queryBuilder.clone()
      .selectRaw("COUNT(*) as total")
      .first();
    totalRecords = parseInt(countResult.total);
    while (true) {
      // Get batch of data
      const sourceData = await this.queryBuilder.clone()
        .limit(config.batchSize)
        .offset(offset)
        .get();

      if (!sourceData || sourceData.length === 0) {
        break;
      }

      // Sync each record
      for (const row of sourceData) {
        try {
          const targetQuery = new this.queryBuilder.constructor(
            targetTable,
            targetDb,
            this.queryBuilder.dialect
          );

          // Build conflict resolution
          if (config.conflictStrategy === 'update') {
            const updateData = { ...row };
            delete updateData[config.keyField];

            await targetQuery
              .where(config.keyField, '=', row[config.keyField])
              .update(updateData)
              .execute();
          } else if (config.conflictStrategy === 'ignore') {
            try {
              await targetQuery.insert(row).execute();
            } catch (error) {
              // Ignore duplicate errors
              if (
                !error.message.includes('duplicate') &&
                !error.message.includes('unique')
              ) {
                throw error;
              }
            }
          } else {
            // error strategy - just insert, will throw on conflict
            await targetQuery.insert(row).execute();
          }

          totalSynced++;
        } catch (error) {
          if (config.onConflict) {
            await config.onConflict(row, error);
          } else {
            throw error;
          }
        }
      }

      offset += config.batchSize;

      // Progress callback
      if (config.onProgress) {
        config.onProgress({
          totalRecords,
          synced: totalSynced,
          percentage: Math.round((offset / totalRecords) * 100)
        });
      }

    }

    return totalSynced;
  }

  /**
   * Two-way sync between databases
   * @param {Object} targetDb - Target database connection
   * @param {string} targetTable - Target table name
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async syncBidirectional(targetDb, targetTable, options = {}) {
    const config = {
      ...this.syncConfig,
      ...options
    };

    const results = {
      sourceToTarget: 0,
      targetToSource: 0,
      conflicts: 0,
      errors: []
    };

    // Sync from source to target
    try {
      results.sourceToTarget = await this.syncTo(targetDb, targetTable, {
        conflictStrategy: config.conflictStrategy,
        keyField: config.keyField,
        batchSize: config.batchSize,
        onConflict: async (row, error) => {
          if (config.conflictStrategy === 'newer_wins') {
            try {
              // Compare timestamps
              const targetQuery = new this.queryBuilder.constructor(
                targetTable,
                targetDb,
                this.queryBuilder.dialect
              );
              const targetRow = await targetQuery
                .where(config.keyField, '=', row[config.keyField])
                .first();

              if (
                targetRow &&
                row[config.timestampField] > targetRow[config.timestampField]
              ) {
                // Source is newer, update target
                const updateData = { ...row };
                delete updateData[config.keyField];

                await targetQuery
                  .where(config.keyField, '=', row[config.keyField])
                  .update(updateData)
                  .execute();
                results.conflicts++;
              }
            } catch (compareError) {
              results.errors.push(
                `Conflict resolution failed: ${compareError.message}`
              );
            }
          }
        }
      });
    } catch (error) {
      results.errors.push(`Source to target sync failed: ${error.message}`);
    }

    // Sync from target to source
    try {
      const targetQuery = new this.queryBuilder.constructor(targetTable, targetDb, this.queryBuilder.dialect);
      results.targetToSource = await targetQuery.syncTo(
        this.queryBuilder.connection,
        this.queryBuilder.tableName,
        {
          conflictStrategy: config.conflictStrategy,
          keyField: config.keyField,
          batchSize: config.batchSize,
          onConflict: async (row, error) => {
            if (config.conflictStrategy === 'newer_wins') {
              try {
                // Compare timestamps
                const sourceRow = await this.queryBuilder.clone()
                  .where(config.keyField, '=', row[config.keyField])
                  .first();

                if (
                  sourceRow &&
                  row[config.timestampField] > sourceRow[config.timestampField]
                ) {
                  // Target is newer, update source
                  const updateData = { ...row };
                  delete updateData[config.keyField];

                  await this.queryBuilder.clone()
                    .where(config.keyField, '=', row[config.keyField])
                    .update(updateData)
                    .execute();
                  results.conflicts++;
                }
              } catch (compareError) {
                results.errors.push(
                  `Conflict resolution failed: ${compareError.message}`
                );
              }
            }
          }
        }
      );
    } catch (error) {
      results.errors.push(`Target to source sync failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Migrate data from source to target
   * @param {string} sourceTable - Source table name
   * @param {Object} mapping - Field mapping
   * @param {Object} options - Migration options
   * @returns {Promise<number>} Number of migrated records
   */
  async migrateData(sourceTable, mapping, options = {}) {
    const {
      batchSize = 1000,
      transform = null,
      validate = null,
      onProgress = null
    } = options;

    let offset = 0;
    let totalMigrated = 0;
    let totalProcessed = 0;

    // Get total record count
    const countResult = await this.queryBuilder.connection.query(
      `SELECT COUNT(*) as total FROM ${sourceTable}`
    );
    const totalRecords = parseInt(countResult.rows.total);



    while (true) {
      // Get batch of data
      const sourceData = await this.queryBuilder.connection.query(
        `SELECT * FROM ${sourceTable} LIMIT ? OFFSET ?`,
        [batchSize, offset]
      );

      if (!sourceData.rows || sourceData.rows.length === 0) {
        break;
      }

      // Transform data
      const transformedData = sourceData.rows.map((row) => {
        let newRow = {};

        // Apply field mapping
        Object.entries(mapping).forEach(([sourceField, targetField]) => {
          if (typeof targetField === 'function') {
            newRow[sourceField] = targetField(row);
          } else {
            newRow[targetField] = row[sourceField];
          }
        });

        // Apply transformation if provided
        if (transform) {
          newRow = transform(newRow, row);
        }

        return newRow;
      });

      // Validate data if validator provided
      if (validate) {
        const validationErrors = [];
        transformedData.forEach((row, index) => {
          const error = validate(row);
          if (error) {
            validationErrors.push({ index, error, row });
          }
        });

        if (validationErrors.length > 0) {
          throw new Error(
            `Validation failed for ${validationErrors.length} records`
          );
        }
      }

      // Insert batch
      const result = await this.queryBuilder.clone().insert(transformedData).execute();

      totalMigrated += transformedData.length;
      totalProcessed += sourceData.rows.length;
      offset += batchSize;

      // Progress callback
      if (onProgress) {
        onProgress({
          totalRecords,
          processed: totalProcessed,
          migrated: totalMigrated,
          batchSize: transformedData.length,
          percentage: Math.round((totalProcessed / totalRecords) * 100)
        });
      }

    }


    return totalMigrated;
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: 'SyncPlugin',
      version: '1.0.0',
      description: 'Cross-database data synchronization and migration',
      features: [
        'Bidirectional synchronization',
        'Conflict resolution strategies',
        'Batch processing',
        'Data migration',
        'Progress tracking'
      ],
      strategies: ['update', 'ignore', 'error', 'newer_wins']
    };
  }
}
