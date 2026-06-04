/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/DistributedPlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * Distributed feature plugin for QueryBuilder
 * Provides distributed system capabilities: connection pool management, read-write splitting, service discovery integration
 * 
 * @class DistributedPlugin
 * @extends {BasePlugin}
 * @description Plugin for handling distributed database operations including connection pooling, 
 *              read-write splitting, shard routing, distributed locking, and cloud-native configuration
 */
export class DistributedPlugin extends BasePlugin {
  /**
   * Plugin name identifier
   * @type {string}
   * @static
   */
  static name = 'distributed';

  /**
   * Supported distributed features
   * @type {string[]}
   * @static
   */
  static supportedFeatures = ['connectionPool', 'readWriteSplit', 'shardRouting', 'distributedLock', 'configCenter'];

  /**
   * Create a distributed plugin instance
   * @param {Object} queryBuilder - QueryBuilder instance to attach to
   * @param {Object} options - Plugin configuration options
   * @param {Object} [options.connectionPool=null] - External connection pool instance
   * @param {Object} [options.readWriteSplit=null] - Read-write split configuration
   * @param {Object} [options.shardRouting=null] - Shard routing configuration
   * @param {Object} [options.distributedLock=null] - Distributed lock client (Redis/ZooKeeper)
   * @param {Object} [options.configCenter=null] - Cloud native config center client
   */
  constructor(queryBuilder, options = {}) {
    super(queryBuilder);
    this.pluginName = "DistributedPlugin";
    this.connectionPool = options.connectionPool || null;
    this.readWriteSplit = options.readWriteSplit || null;
    this.shardRouting = options.shardRouting || null;
    this.distributedLockClient = options.distributedLock || null;
    this.configCenter = options.configCenter || null;
    this.primaryConnection = null;
    this.replicaConnections = [];
    this._roundRobinIndex = 0;
  }

  /**
   * Register plugin methods to QueryBuilder
   * @protected
   * @override
   */
  _registerMethods() {
    // Register distributed methods to QueryBuilder
    this.methods = {
      executeWithPool: this.executeWithPool.bind(this),
      executeWithDistributedLock: this.executeWithDistributedLock.bind(this),
      routeToShard: this.routeToShard.bind(this),
      getReadConnection: this.getReadConnection.bind(this),
      isReadOnlyQuery: this.isReadOnlyQuery.bind(this),
      getDistributedHealthStatus: this.getHealthStatus.bind(this),
      updateDistributedConfig: this.updateConfig.bind(this)
    };
  }

  /**
   * Register hooks for the plugin
   * @protected
   * @override
   */
  _registerHooks() {
    // Register query execution hooks for automatic read-write splitting
    this.registerHook('beforeExecute', async (sql, bindings) => {
      // Automatically route read-only queries to replica connections
      if (this.readWriteSplit && this.isReadOnlyQuery()) {
        const readConn = this.getReadConnection();
        if (readConn && this.queryBuilder.connection !== readConn) {
          const oldConn = this.queryBuilder.connection;
          this.queryBuilder.connection = readConn;
          return () => {
            // Cleanup hook: restore original connection
            this.queryBuilder.connection = oldConn;
          };
        }
      }
      return null;
    }, { priority: 100 });

    // Register after execution hook for metrics collection
    this.registerHook('afterExecute', async (result) => {
      if (this.configCenter) {
        await this._recordMetrics(result);
      }
      return result;
    }, { priority: 50 });
  }

  /**
   * Register middlewares for the plugin
   * @protected
   * @override
   */
  _registerMiddlewares() {
    // Register connection pool middleware
    this.registerMiddleware('connection', async (context, next) => {
      if (this.connectionPool && context.usePool !== false) {
        const connection = await this.connectionPool.getConnection();
        try {
          context.connection = connection;
          const result = await next();
          return result;
        } finally {
          this.connectionPool.release(connection);
        }
      }
      return await next();
    }, { priority: 100 });
  }

  /**
   * Initialize the plugin
   * @async
   * @returns {Promise<void>}
   * @override
   */
  async init() {
    await super.init();
    
    if (this.connectionPool) {
      this._setupConnectionPool();
    }

    if (this.readWriteSplit) {
      this._setupReadWriteSplit();
    }

    if (this.configCenter) {
      this._watchConfigChanges();
    }
    

  }

  /**
   * Use connection pool to get connection for execution
   * @async
   * @param {QueryBuilder} qb - Query builder instance
   * @returns {Promise<any>} Query execution result
   */
  async executeWithPool(qb) {
    const connection = await this.connectionPool.getConnection();
    try {
      qb.connection = connection;
      const result = await qb.execute();
      return result;
    } finally {
      this.connectionPool.release(connection);
    }
  }

  /**
   * Execute query with distributed lock protection
   * @async
   * @param {string} lockKey - Unique lock key
   * @param {number} [timeout=5000] - Lock acquire timeout in milliseconds
   * @returns {Promise<any>} Query execution result
   * @throws {Error} If distributed lock client not configured
   */
  async executeWithDistributedLock(lockKey, timeout = 5000) {
    if (!this.distributedLockClient) {
      throw new Error('Distributed lock client not configured. Please initialize plugin with distributedLock option.');
    }

    const lock = await this.distributedLockClient.acquire(lockKey, timeout);
    try {
      return await this.queryBuilder.execute();
    } finally {
      await lock.release();
    }
  }

  /**
   * Route query to specific shard by shard key
   * @param {string|number} shardKey - Sharding key value
   * @returns {QueryBuilder} Current query builder instance with correct connection
   * @throws {Error} If shard routing not configured
   */
  routeToShard(shardKey) {
    if (!this.shardRouting) {
      throw new Error('Shard routing not configured. Please initialize plugin with shardRouting option.');
    }

    const shard = this._calculateShard(shardKey);
    this.queryBuilder.connection = shard.connection;
    this.queryBuilder.tableName = shard.getTableName(this.queryBuilder.originalTableName, shardKey);
    return this.queryBuilder;
  }

  /**
   * Get read connection based on read-write split strategy
   * @returns {Object} Read connection
   */
  getReadConnection() {
    if (!this.readWriteSplit || this.replicaConnections.length === 0) {
      return this.primaryConnection;
    }

    return this._selectReplicaByStrategy();
  }

  /**
   * Check if current query is read-only operation
   * @returns {boolean} True if query is read-only
   */
  isReadOnlyQuery() {
    const queryType = this.queryBuilder.query.type;
    return ['select', 'exists', 'count'].includes(queryType);
  }

  /**
   * Setup connection pool integration
   * @returns {void}
   * @private
   */
  _setupConnectionPool() {
    // Validate connection pool interface
    if (typeof this.connectionPool.getConnection !== 'function' || 
        typeof this.connectionPool.release !== 'function') {
      throw new Error('Connection pool must implement getConnection and release methods');
    }
  }

  /**
   * Setup read-write split connections
   * @returns {void}
   * @private
   */
  _setupReadWriteSplit() {
    this.primaryConnection = this.readWriteSplit.primary;
    this.replicaConnections = this.readWriteSplit.replicas || [];
  }

  /**
   * Watch dynamic configuration changes from config center
   * @returns {void}
   * @private
   */
  _watchConfigChanges() {
    if (!this.configCenter || !this.configCenter.watch) {
      return;
    }

    // Watch pool size changes
    this.configCenter.watch('database.pool.size', (newSize) => {
      if (this.connectionPool && this.connectionPool.resize) {
        this.connectionPool.resize(newSize);
      }
    });

    // Watch replica node changes
    this.configCenter.watch('database.readWriteSplit.replicas', (newReplicas) => {
      this.replicaConnections = newReplicas;
    });
  }

  /**
   * Calculate target shard by shard key using consistent hashing
   * @param {string|number} shardKey - Sharding key
   * @returns {Object} Target shard configuration
   * @private
   */
  _calculateShard(shardKey) {
    const shards = this.shardRouting.shards;
    const hash = this._hashString(String(shardKey));
    const index = hash % shards.length;
    return shards[index];
  }

  /**
   * Select replica connection based on load balancing strategy
   * @returns {Object} Selected replica connection
   * @private
   */
  _selectReplicaByStrategy() {
    const strategy = this.readWriteSplit.strategy || 'round-robin';
    
    switch (strategy) {
      case 'round-robin':
        const index = this._roundRobinIndex++ % this.replicaConnections.length;
        return this.replicaConnections[index];
      
      case 'random':
        const randomIndex = Math.floor(Math.random() * this.replicaConnections.length);
        return this.replicaConnections[randomIndex];
      
      case 'least-connected':
        return this.replicaConnections
          .sort((a, b) => a.activeConnections - b.activeConnections);
      
      default:
        return this.replicaConnections;
    }
  }

  /**
   * Simple string hash function for consistent hashing
   * @param {string} str - Input string
   * @returns {number} Hash value
   * @private
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Record metrics to config center
   * @param {Object} result - Query execution result
   * @returns {Promise<void>}
   * @private
   */
  async _recordMetrics(result) {
    if (!this.configCenter || !this.configCenter.recordMetric) {
      return;
    }

    const metrics = {
      timestamp: Date.now(),
      queryType: this.queryBuilder.query.type,
      shardKey: this.shardRouting ? 'calculated' : 'none',
      readWrite: this.readWriteSplit ? 'split' : 'single',
      connectionPool: !!this.connectionPool
    };

    await this.configCenter.recordMetric('distributed_query', metrics);
  }

  /**
   * Update plugin configuration dynamically
   * @param {Object} newConfig - New configuration
   * @returns {Promise<void>}
   */
  async updateConfig(newConfig) {
    // Cleanup old configuration
    await this.cleanup();
    
    // Update configuration
    Object.assign(this.config, newConfig);
    
    if (newConfig.connectionPool) {
      this.connectionPool = newConfig.connectionPool;
    }
    
    if (newConfig.readWriteSplit) {
      this.readWriteSplit = newConfig.readWriteSplit;
      this._setupReadWriteSplit();
    }
    
    if (newConfig.shardRouting) {
      this.shardRouting = newConfig.shardRouting;
    }
    
    if (newConfig.distributedLock) {
      this.distributedLockClient = newConfig.distributedLock;
    }
    
    if (newConfig.configCenter) {
      this.configCenter = newConfig.configCenter;
      this._watchConfigChanges();
    }
    
    // Re-initialize
    await this.init();
  }

  /**
   * Get plugin health status for cloud native monitoring
   * @returns {Promise<Object>} Health status object
   */
  async getHealthStatus() {
    const status = {
      healthy: true,
      features: {
        connectionPool: !!this.connectionPool,
        readWriteSplit: !!this.readWriteSplit,
        shardRouting: !!this.shardRouting,
        distributedLock: !!this.distributedLockClient,
        configCenter: !!this.configCenter
      },
      timestamp: Date.now()
    };

    if (this.connectionPool) {
      try {
        status.poolStats = await this.connectionPool.getStats();
      } catch (error) {
        status.poolStats = { error: error.message };
        status.healthy = false;
      }
    }

    return status;
  }

  /**
   * Cleanup resources when plugin is destroyed
   * @returns {Promise<void>}
   * @override
   */
  async cleanup() {
    // Cleanup config center watchers
    if (this.configCenter && this.configCenter.unwatch) {
      this.configCenter.unwatch('database.pool.size');
      this.configCenter.unwatch('database.readWriteSplit.replicas');
    }

    // Cleanup connection pool
    if (this.connectionPool) {
      await this.connectionPool.end();
    }

    // Call parent cleanup
    await super.cleanup();
    

  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   * @override
   */
  getMetadata() {
    const baseMetadata = super.getMetadata();
    return {
      ...baseMetadata,
      name: DistributedPlugin.name,
      description: 'Distributed database operations plugin with connection pooling, read-write splitting, sharding, and distributed locking',
      version: '1.0.0',
      features: DistributedPlugin.supportedFeatures,
      dependencies: ['BasePlugin']
    };
  }

  /**
   * Validate plugin configuration
   * @param {Object} config - Plugin configuration
   * @returns {Object} Validation result
   * @override
   */
  validateConfig(config) {
    const baseValidation = super.validateConfig(config);
    const errors = [...baseValidation.errors];
    const warnings = [...baseValidation.warnings];

    // Validate connection pool configuration
    if (config.connectionPool) {
      if (typeof config.connectionPool.getConnection !== 'function') {
        errors.push('connectionPool must have getConnection method');
      }
      if (typeof config.connectionPool.release !== 'function') {
        errors.push('connectionPool must have release method');
      }
    }

    // Validate read-write split configuration
    if (config.readWriteSplit) {
      if (!config.readWriteSplit.primary) {
        errors.push('readWriteSplit must have primary connection');
      }
      if (!Array.isArray(config.readWriteSplit.replicas)) {
        warnings.push('readWriteSplit.replicas should be an array');
      }
    }

    // Validate sharding configuration
    if (config.shardRouting) {
      if (!Array.isArray(config.shardRouting.shards) || config.shardRouting.shards.length === 0) {
        errors.push('shardRouting.shards must be a non-empty array');
      }
    }

    // Validate distributed lock configuration
    if (config.distributedLock) {
      if (typeof config.distributedLock.acquire !== 'function') {
        errors.push('distributedLock must have acquire method');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get plugin configuration
   * @returns {Object} Plugin configuration
   * @override
   */
  getConfig() {
    const baseConfig = super.getConfig();
    return {
      ...baseConfig,
      connectionPool: !!this.connectionPool,
      readWriteSplit: !!this.readWriteSplit,
      shardRouting: !!this.shardRouting,
      distributedLock: !!this.distributedLockClient,
      configCenter: !!this.configCenter
    };
  }

  /**
   * Get plugin status
   * @returns {Object} Plugin status information
   * @override
   */
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      connectionPool: !!this.connectionPool,
      readWriteSplit: !!this.readWriteSplit,
      replicaCount: this.replicaConnections.length,
      shardRouting: !!this.shardRouting,
      distributedLock: !!this.distributedLockClient,
      configCenter: !!this.configCenter
    };
  }
}
