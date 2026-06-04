/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/ShardingPlugin
 */
import { BasePlugin } from './BasePlugin.js';
import crypto from 'crypto';

/**
 * Sharding Plugin - Provides horizontal and vertical data sharding/partitioning support.
 * Dynamically routes queries to the correct physical table based on shard/partition keys.
 */
export class ShardingPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.shardKey = null;
    this.partitionKey = null;
    this.shardStrategy = 'hash'; // 'hash', 'range', 'list'
    this.partitionStrategy = 'time'; // 'time', 'hash', 'range'
    this.totalShards = 10;
    this.partitionFormat = 'pYYYYMM'; // Format for time-based partitions
  }

  _registerMethods() {
    // Register sharding methods to QueryBuilder
    this.queryBuilder.shard = this.shard.bind(this);
    this.queryBuilder.partition = this.partition.bind(this);
    this.queryBuilder.getActualTableName = this.getActualTableName.bind(this);
    this.queryBuilder.calculateShardKey = this.calculateShardKey.bind(this);
    this.queryBuilder.shardRoute = this.shardRoute.bind(this);
    this.queryBuilder.setShardingConfig = this.setShardingConfig.bind(this);
  }

  /**
   * Set the shard key for horizontal partitioning.
   * @param {string} shardKey - The value used to determine the shard.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  shard(shardKey) {
    this.shardKey = shardKey;
    return this.queryBuilder;
  }

  /**
   * Set the partition key for vertical partitioning (e.g., time-based).
   * @param {string|Date} partitionKey - The value used to determine the partition.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  partition(partitionKey) {
    this.partitionKey = partitionKey;
    return this.queryBuilder;
  }

  /**
   * Configures the sharding/partitioning strategy.
   * @param {Object} config - Configuration options.
   * @returns {QueryBuilder} The QueryBuilder instance.
   */
  setShardingConfig(config = {}) {
    Object.assign(this, config);
    return this.queryBuilder;
  }

  /**
   * Calculates the actual physical table name based on shard/partition keys.
   * @returns {string} The actual table name to use in the query.
   */
  getActualTableName() {
    let tableName = this.queryBuilder.tableName;

    // Apply sharding (horizontal)
    if (this.shardKey) {
      let shardSuffix;
      switch (this.shardStrategy) {
        case 'hash':
          shardSuffix = this._hashShard(this.shardKey);
          break;
        case 'range':
          shardSuffix = this._rangeShard(this.shardKey);
          break;
        case 'list':
          shardSuffix = this._listShard(this.shardKey);
          break;
        default:
          shardSuffix = this._hashShard(this.shardKey);
      }
      tableName = `${tableName}_${shardSuffix}`;
    }

    // Apply partitioning (vertical, e.g., by time)
    if (this.partitionKey) {
      let partitionSuffix;
      switch (this.partitionStrategy) {
        case 'time':
          partitionSuffix = this._timePartition(this.partitionKey);
          break;
        case 'hash':
          partitionSuffix = this._hashPartition(this.partitionKey);
          break;
        case 'range':
          partitionSuffix = this._rangePartition(this.partitionKey);
          break;
        default:
          partitionSuffix = this._timePartition(this.partitionKey);
      }
      tableName = `${tableName}_${partitionSuffix}`;
    }

    return tableName;
  }

  /**
   * Calculates a shard key using consistent hashing.
   * @param {*} value - The value to hash (e.g., user ID).
   * @param {number} totalShards - Total number of shards.
   * @returns {string} The calculated shard identifier.
   */
  calculateShardKey(value, totalShards = this.totalShards) {
    const hash = crypto.createHash('md5').update(String(value)).digest('hex');
    const shardNum = parseInt(hash.substring(0, 8), 16) % totalShards;
    return `shard${shardNum}`;
  }

  /**
   * Routes an insert operation to the appropriate shard based on data.
   * @param {Object} data - The data to insert.
   * @param {string} keyField - The field used for shard calculation (default: 'id').
   * @returns {Promise<Object>} The result of the insert operation.
   */
  async shardRoute(data, keyField = 'id') {
    const shardValue = data[keyField];
    if (!shardValue) {
      throw new Error(`Shard key field '${keyField}' not found in data.`);
    }
    const shardKey = this.calculateShardKey(shardValue);
    return this.queryBuilder.clone().shard(shardKey).insert(data).execute();
  }

  /**
   * Hash-based sharding strategy.
   * @private
   */
  _hashShard(value) {
    return this.calculateShardKey(value);
  }

  /**
   * Range-based sharding strategy (example: by numeric ranges).
   * @private
   */
  _rangeShard(value) {
    // Example: shard by user_id ranges (0-999 -> shard0, 1000-1999 -> shard1, etc.)
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error('Range sharding requires a numeric value.');
    }
    const shardNum = Math.floor(num / 1000) % this.totalShards;
    return `shard${shardNum}`;
  }

  /**
   * List-based sharding strategy (example: by region).
   * @private
   */
  _listShard(value) {
    // Example: map specific values to specific shards
    const shardMap = {
      'us': 'shard0',
      'eu': 'shard1',
      'asia': 'shard2'
      // ... extend as needed
    };
    return shardMap[value] || this._hashShard(value);
  }

  /**
   * Time-based partitioning strategy.
   * @private
   */
  _timePartition(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    // Supports formats like pYYYYMM, pYYYYMMDD, etc.
    return this.partitionFormat
      .replace('YYYY', year)
      .replace('MM', month)
      .replace('DD', String(date.getDate()).padStart(2, '0'));
  }

  /**
   * Hash-based partitioning strategy.
   * @private
   */
  _hashPartition(value) {
    const hash = crypto.createHash('md5').update(String(value)).digest('hex');
    const partitionNum = parseInt(hash.substring(0, 4), 16) % 100; // Example: 100 partitions
    return `part${String(partitionNum).padStart(3, '0')}`;
  }

  /**
   * Range-based partitioning strategy (example: by date ranges).
   * @private
   */
  _rangePartition(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `y${year}q${quarter}`;
  }

  /**
   * Override the internal method that builds the final SQL to use the actual table name.
   * This method should be called by the plugin after the main QueryBuilder registers it.
   */
  applyTableNameOverride() {
    const originalGetActualTableName = this.queryBuilder.getActualTableName;
    this.queryBuilder.getActualTableName = () => {
      // Use the plugin's logic if sharding/partitioning is active, otherwise fall back
      if (this.shardKey || this.partitionKey) {
        return this.getActualTableName();
      }
      return originalGetActualTableName ? originalGetActualTableName.call(this.queryBuilder) : this.queryBuilder.tableName;
    };
  }
}
