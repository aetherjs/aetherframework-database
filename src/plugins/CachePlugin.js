/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/CachePlugin
 */
import crypto from 'crypto';
import { BasePlugin } from './BasePlugin.js';

/**
 * Cache Plugin - Provides query caching functionality with multiple cache drivers
 * Supports Redis, Memcached, Memory, and custom cache implementations
 */
export class CachePlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.cacheDriver = null;
    this.cacheEnabled = false;
    this.cacheConfig = {
      defaultTtl: 300, // 5 minutes
      prefix: 'query:',
      tagsEnabled: false,
      compression: false
    };
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }

  _registerMethods() {
    // Register cache methods to QueryBuilder
    this.queryBuilder.setCacheDriver = this.setCacheDriver.bind(this);
    this.queryBuilder.cache = this.cache.bind(this);
    this.queryBuilder.cacheWithTags = this.cacheWithTags.bind(this);
    this.queryBuilder.executeWithCache = this.executeWithCache.bind(this);
    this.queryBuilder.clearTableCache = this.clearTableCache.bind(this);
    this.queryBuilder.clearCache = this.clearCache.bind(this);
    this.queryBuilder.getCacheStats = this.getCacheStats.bind(this);
    this.queryBuilder.generateCacheKey = this.generateCacheKey.bind(this);
    this.queryBuilder.cacheTags = this.cacheTags.bind(this);
    this.queryBuilder.remember = this.remember.bind(this);
  }

  /**
   * Set cache driver
   * @param {Object} cacheDriver - Cache driver instance
   * @param {Object} options - Cache configuration
   * @returns {QueryBuilder} Query builder instance
   */
  setCacheDriver(cacheDriver, options = {}) {
    this.cacheDriver = cacheDriver;
    this.cacheConfig = {
      ...this.cacheConfig,
      ...options
    };
    this.cacheEnabled = true;
    
    // Validate cache driver interface
    this._validateCacheDriver();
    
    return this.queryBuilder;
  }

  /**
   * Enable query caching
   * @param {number} ttl - Time to live in seconds
   * @param {string} key - Custom cache key
   * @returns {QueryBuilder} Query builder instance
   */
  cache(ttl = null, key = null) {
    if (!this.cacheEnabled) {
      throw new Error('Cache is not enabled. Call setCacheDriver() first.');
    }

    this.queryBuilder.query.cache = true;
    this.queryBuilder.query.cacheTtl = ttl || this.cacheConfig.defaultTtl;
    this.queryBuilder.query.cacheKey = key || this.generateCacheKey();
    this.queryBuilder.query.cacheTags = [];
    
    return this.queryBuilder;
  }

  /**
   * Enable caching with tags
   * @param {number} ttl - Time to live in seconds
   * @param {Array} tags - Cache tags
   * @returns {QueryBuilder} Query builder instance
   */
  cacheWithTags(ttl = 300, tags = []) {
    if (!this.cacheConfig.tagsEnabled) {
      console.warn('Cache tags are not enabled in cache configuration');
    }

    this.queryBuilder.query.cache = true;
    this.queryBuilder.query.cacheTtl = ttl;
    this.queryBuilder.query.cacheTags = tags;
    this.queryBuilder.query.cacheKey = this.generateCacheKey();
    
    return this.queryBuilder;
  }

  /**
   * Add tags to cache
   * @param {...string} tags - Cache tags
   * @returns {QueryBuilder} Query builder instance
   */
  cacheTags(...tags) {
    if (!this.queryBuilder.query.cacheTags) {
      this.queryBuilder.query.cacheTags = [];
    }
    this.queryBuilder.query.cacheTags.push(...tags);
    return this.queryBuilder;
  }

  /**
   * Generate cache key from query
   * @returns {string} Cache key
   */
  generateCacheKey() {
    const { sql, bindings } = this.queryBuilder.toSQL();
    const queryHash = crypto
      .createHash('sha256')
      .update(sql + JSON.stringify(bindings) + this.queryBuilder.dialect)
      .digest('hex');

    const keyParts = [
      this.cacheConfig.prefix,
      this.queryBuilder.tableName,
      this.queryBuilder.query.type,
      queryHash
    ];

    return keyParts.join(':');
  }

  /**
   * Execute query with caching
   * @returns {Promise<Object>} Query result
   */
  async executeWithCache() {
    if (!this.queryBuilder.query.cache || !this.cacheDriver) {
      return this.queryBuilder.execute();
    }

    // Determine TTL based on query type
    let ttl = this.queryBuilder.query.cacheTtl || this.cacheConfig.defaultTtl;
    if (this.queryBuilder.query.type === 'select') {
      ttl = Math.max(ttl, 600); // At least 10 minutes for SELECT
    } else if (
      this.queryBuilder.query.type === 'insert' ||
      this.queryBuilder.query.type === 'update' ||
      this.queryBuilder.query.type === 'delete'
    ) {
      ttl = Math.min(ttl, 30); // Maximum 30 seconds for DML
    }

    const cacheKey = this.queryBuilder.query.cacheKey;

    // Try to get from cache
    try {
      const cached = await this.cacheDriver.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        this.cacheStats.hits++;
        this.queryBuilder.emit('cache:hit', { 
          key: cacheKey, 
          ttl: ttl 
        });
        
        // Parse cached data
        const result = typeof cached === 'string' ? JSON.parse(cached) : cached;
        
        // Add cache metadata
        if (result && typeof result === 'object') {
          result._cache = {
            hit: true,
            key: cacheKey,
            ttl: ttl,
            cachedAt: new Date().toISOString()
          };
        }
        
        return result;
      }
    } catch (error) {
      console.warn('Cache get error:', error.message);
    }

    // Cache miss - execute query
    this.cacheStats.misses++;
    const result = await this.queryBuilder.execute();

    // Store in cache
    try {
      const cacheValue = JSON.stringify(result);
      
      if (this.queryBuilder.query.cacheTags?.length > 0 && 
          this.cacheDriver.setWithTags) {
        await this.cacheDriver.setWithTags(
          cacheKey,
          cacheValue,
          ttl,
          this.queryBuilder.query.cacheTags
        );
      } else {
        await this.cacheDriver.set(cacheKey, cacheValue, ttl);
      }
      
      this.cacheStats.sets++;
      this.queryBuilder.emit('cache:miss', { 
        key: cacheKey, 
        ttl: ttl 
      });

      // Add cache metadata to result
      if (result && typeof result === 'object') {
        result._cache = {
          hit: false,
          key: cacheKey,
          ttl: ttl,
          cachedAt: new Date().toISOString()
        };
      }
    } catch (error) {
      console.warn('Cache set error:', error.message);
    }

    return result;
  }

  /**
   * Remember pattern - get from cache or execute and cache
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   * @param {Function} callback - Function to execute if not cached
   * @returns {Promise<*>} Cached or fresh result
   */
  async remember(key, ttl, callback) {
    if (!this.cacheEnabled || !this.cacheDriver) {
      return callback();
    }

    const cacheKey = `${this.cacheConfig.prefix}${key}`;

    try {
      const cached = await this.cacheDriver.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        this.cacheStats.hits++;
        return typeof cached === 'string' ? JSON.parse(cached) : cached;
      }
    } catch (error) {
      console.warn('Cache get error:', error.message);
    }

    // Execute callback and cache result
    const result = await callback();
    
    try {
      await this.cacheDriver.set(cacheKey, JSON.stringify(result), ttl);
      this.cacheStats.sets++;
    } catch (error) {
      console.warn('Cache set error:', error.message);
    }

    return result;
  }

  /**
   * Clear cache for this table
   * @param {string} pattern - Cache key pattern
   * @returns {Promise<void>}
   */
  async clearTableCache(pattern = null) {
    if (!this.cacheDriver) {
      return;
    }

    const cachePattern = pattern || `query:${this.queryBuilder.tableName}:*`;
    
    try {
      if (this.cacheDriver.clearPattern) {
        await this.cacheDriver.clearPattern(cachePattern);
      } else if (this.cacheDriver.del) {
        // For Redis-like drivers
        const keys = await this.cacheDriver.keys(cachePattern);
        if (keys.length > 0) {
          await this.cacheDriver.del(...keys);
        }
      }
      
      this.cacheStats.deletes++;
      this.queryBuilder.emit('cache:cleared', { pattern: cachePattern });
    } catch (error) {
      console.error('Failed to clear cache:', error.message);
    }
  }

  /**
   * Clear specific cache key
   * @param {string} key - Cache key to clear
   * @returns {Promise<void>}
   */
  async clearCache(key = null) {
    if (!this.cacheDriver) {
      return;
    }

    const cacheKey = key || this.queryBuilder.query.cacheKey;
    if (!cacheKey) {
      return;
    }

    try {
      await this.cacheDriver.del(cacheKey);
      this.cacheStats.deletes++;
      this.queryBuilder.emit('cache:cleared', { key: cacheKey });
    } catch (error) {
      console.error('Failed to clear cache:', error.message);
    }
  }

  /**
   * Clear cache by tags
   * @param {...string} tags - Cache tags
   * @returns {Promise<void>}
   */
  async clearCacheByTags(...tags) {
    if (!this.cacheDriver || !this.cacheDriver.clearByTags) {
      console.warn('Cache driver does not support tag-based clearing');
      return;
    }

    try {
      await this.cacheDriver.clearByTags(...tags);
      this.cacheStats.deletes++;
      this.queryBuilder.emit('cache:cleared:tags', { tags });
    } catch (error) {
      console.error('Failed to clear cache by tags:', error.message);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      ...this.cacheStats,
      enabled: this.cacheEnabled,
      driver: this.cacheDriver?.constructor?.name || 'none',
      config: this.cacheConfig
    };
  }

  /**
   * Reset cache statistics
   * @returns {Object} Reset statistics
   */
  resetCacheStats() {
    const oldStats = { ...this.cacheStats };
    this.cacheStats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
    return oldStats;
  }

  /**
   * Validate cache driver interface
   * @private
   */
  _validateCacheDriver() {
    const requiredMethods = ['get', 'set', 'del'];
    const missingMethods = [];

    for (const method of requiredMethods) {
      if (typeof this.cacheDriver[method] !== 'function') {
        missingMethods.push(method);
      }
    }

    if (missingMethods.length > 0) {
      throw new Error(
        `Cache driver missing required methods: ${missingMethods.join(', ')}`
      );
    }
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: 'CachePlugin',
      version: '1.0.0',
      description: 'Advanced query caching with multiple driver support',
      features: [
        'Multi-driver support (Redis, Memcached, Memory)',
        'Tag-based caching',
        'Automatic TTL management',
        'Cache statistics',
        'Pattern-based cache clearing'
      ],
      drivers: ['redis', 'memcached', 'memory', 'custom']
    };
  }
}
