/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/middleware/query-cache
 */
import { EventEmitter } from 'events';

class QueryCacheMiddleware extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      enabled: options.enabled !== false,
      ttl: options.ttl || 300000, // 5 minutes default
      maxSize: options.maxSize || 1000,
      strategy: options.strategy || 'lru', // lru, fifo, lfu
      cacheNullResults: options.cacheNullResults !== false,
      cacheErrors: options.cacheErrors || false,
      ...options
    };
    
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: 0,
      memoryUsage: 0
    };
    
    this.accessOrder = new Map(); // For LRU strategy
    this.accessCount = new Map(); // For LFU strategy
    
    this.startCleanupTimer();
  }

  /**
   * Generate cache key from query
   * @param {Object} query - Query object
   * @returns {string} Cache key
   */
  generateCacheKey(query) {
    const { sql, params = [], connectionName, type = 'query' } = query;
    
    // Create a deterministic key
    const keyData = {
      sql: sql.trim().toLowerCase(),
      params: JSON.stringify(params),
      connection: connectionName,
      type
    };
    
    return JSON.stringify(keyData);
  }

  /**
   * Check if query should be cached
   * @param {Object} query - Query object
   * @returns {boolean} True if query should be cached
   */
  shouldCache(query) {
    if (!this.options.enabled) {
      return false;
    }
    
    const { sql } = query;
    
    // Don't cache INSERT, UPDATE, DELETE queries
    const lowerSql = sql.toLowerCase().trim();
    if (lowerSql.startsWith('insert ') || 
        lowerSql.startsWith('update ') || 
        lowerSql.startsWith('delete ') ||
        lowerSql.startsWith('create ') ||
        lowerSql.startsWith('alter ') ||
        lowerSql.startsWith('drop ') ||
        lowerSql.startsWith('truncate ')) {
      return false;
    }
    
    // Check for cache hints in SQL comments
    if (sql.includes('/* no-cache */')) {
      return false;
    }
    
    if (sql.includes('/* cache */')) {
      return true;
    }
    
    // Default: cache SELECT queries
    return lowerSql.startsWith('select ');
  }

  /**
   * Get cached result
   * @param {Object} query - Query object
   * @returns {Object|null} Cached result or null
   */
  get(query) {
    if (!this.options.enabled) {
      return null;
    }
    
    const key = this.generateCacheKey(query);
    
    if (!this.cache.has(key)) {
      this.stats.misses++;
      this.emit('cache-miss', { key, query });
      return null;
    }
    
    const cached = this.cache.get(key);
    
    // Check if cache entry has expired
    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      this.stats.size--;
      this.emit('cache-expired', { key, query });
      return null;
    }
    
    // Update access order for LRU
    if (this.options.strategy === 'lru') {
      this.accessOrder.set(key, Date.now());
    }
    
    // Update access count for LFU
    if (this.options.strategy === 'lfu') {
      const count = this.accessCount.get(key) || 0;
      this.accessCount.set(key, count + 1);
    }
    
    this.stats.hits++;
    this.emit('cache-hit', { 
      key, 
      query, 
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      ttl: cached.ttl
    });
    
    return cached.result;
  }

  /**
   * Set cache result
   * @param {Object} query - Query object
   * @param {Object} result - Query result
   * @param {number} ttl - Time to live in milliseconds
   */
  set(query, result, ttl = null) {
    if (!this.options.enabled || !this.shouldCache(query)) {
      return;
    }
    
    // Don't cache null results if configured
    if (!this.options.cacheNullResults && (result === null || result === undefined)) {
      return;
    }
    
    // Don't cache errors if configured
    if (!this.options.cacheErrors && result.error) {
      return;
    }
    
    const key = this.generateCacheKey(query);
    const actualTtl = ttl || this.options.ttl;
    const expiresAt = Date.now() + actualTtl;
    
    // Check cache size limit
    if (this.cache.size >= this.options.maxSize) {
      this.evict();
    }
    
    const cacheEntry = {
      result,
      cachedAt: Date.now(),
      expiresAt,
      ttl: actualTtl,
      query: {
        sql: query.sql.substring(0, 100) + (query.sql.length > 100 ? '...' : ''),
        params: query.params,
        connection: query.connectionName,
        type: query.type
      }
    };
    
    this.cache.set(key, cacheEntry);
    
    // Update access order for LRU
    if (this.options.strategy === 'lru') {
      this.accessOrder.set(key, Date.now());
    }
    
    // Initialize access count for LFU
    if (this.options.strategy === 'lfu') {
      this.accessCount.set(key, 1);
    }
    
    this.stats.sets++;
    this.stats.size = this.cache.size;
    this.stats.memoryUsage = this.estimateMemoryUsage();
    
    this.emit('cache-set', { 
      key, 
      query: cacheEntry.query,
      cachedAt: cacheEntry.cachedAt,
      expiresAt: cacheEntry.expiresAt,
      ttl: cacheEntry.ttl
    });
  }

  /**
   * Delete cache entry
   * @param {Object} query - Query object
   */
  delete(query) {
    const key = this.generateCacheKey(query);
    if (this.cache.delete(key)) {
      this.accessOrder.delete(key);
      this.accessCount.delete(key);
      this.stats.deletes++;
      this.stats.size = this.cache.size;
      this.stats.memoryUsage = this.estimateMemoryUsage();
      this.emit('cache-delete', { key, query });
    }
  }

  /**
   * Clear all cache entries
   * @param {string} pattern - Pattern to match (optional)
   */
  clear(pattern = null) {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const [key] of this.cache.entries()) {
        if (regex.test(key)) {
          this.cache.delete(key);
          this.accessOrder.delete(key);
          this.accessCount.delete(key);
        }
      }
    } else {
      this.cache.clear();
      this.accessOrder.clear();
      this.accessCount.clear();
    }
    
    this.stats.size = this.cache.size;
    this.stats.memoryUsage = this.estimateMemoryUsage();
    this.emit('cache-clear', { pattern });
  }

  /**
   * Evict entries based on strategy
   */
  evict() {
    const entriesToEvict = Math.max(1, Math.floor(this.options.maxSize * 0.1)); // Evict 10%
    
    switch (this.options.strategy) {
      case 'lru':
        this.evictLRU(entriesToEvict);
        break;
      case 'lfu':
        this.evictLFU(entriesToEvict);
        break;
      case 'fifo':
      default:
        this.evictFIFO(entriesToEvict);
        break;
    }
  }

  /**
   * Evict using LRU (Least Recently Used) strategy
   * @param {number} count - Number of entries to evict
   */
  evictLRU(count) {
    const entries = Array.from(this.accessOrder.entries())
      .sort((a, b) => a - b) // Sort by access time (oldest first)
      .slice(0, count);
    
    for (const [key] of entries) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessCount.delete(key);
      this.stats.evictions++;
    }
    
    this.stats.size = this.cache.size;
    this.emit('cache-evicted', { strategy: 'lru', count: entries.length });
  }

  /**
   * Evict using LFU (Least Frequently Used) strategy
   * @param {number} count - Number of entries to evict
   */
  evictLFU(count) {
    const entries = Array.from(this.accessCount.entries())
      .sort((a, b) => a - b) // Sort by access count (least frequent first)
      .slice(0, count);
    
    for (const [key] of entries) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessCount.delete(key);
      this.stats.evictions++;
    }
    
    this.stats.size = this.cache.size;
    this.emit('cache-evicted', { strategy: 'lfu', count: entries.length });
  }

  /**
   * Evict using FIFO (First In First Out) strategy
   * @param {number} count - Number of entries to evict
   */
  evictFIFO(count) {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a.cachedAt - b.cachedAt) // Sort by cache time (oldest first)
      .slice(0, count);
    
    for (const [key] of entries) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.accessCount.delete(key);
      this.stats.evictions++;
    }
    
    this.stats.size = this.cache.size;
    this.emit('cache-evicted', { strategy: 'fifo', count: entries.length });
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Cleanup every minute
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupExpired() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        this.accessCount.delete(key);
        expiredCount++;
        this.stats.evictions++;
      }
    }
    
    if (expiredCount > 0) {
      this.stats.size = this.cache.size;
      this.stats.memoryUsage = this.estimateMemoryUsage();
      this.emit('cache-cleanup', { expiredCount });
    }
  }

  /**
   * Estimate memory usage
   * @returns {number} Estimated memory usage in bytes
   */
  estimateMemoryUsage() {
    let total = 0;
    for (const [key, value] of this.cache.entries()) {
      total += key.length * 2; // UTF-16 string
      total += JSON.stringify(value).length * 2;
    }
    return total;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
      : '0%';
    
    return {
      ...this.stats,
      hitRate,
      strategy: this.options.strategy,
      ttl: this.options.ttl,
      maxSize: this.options.maxSize,
      enabled: this.options.enabled,
      cacheNullResults: this.options.cacheNullResults,
      cacheErrors: this.options.cacheErrors,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get cache entries
   * @param {number} limit - Maximum number of entries to return
   * @returns {Array} Cache entries
   */
  getEntries(limit = 100) {
    const entries = [];
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (count >= limit) break;
      
      entries.push({
        key: key.substring(0, 100) + (key.length > 100 ? '...' : ''),
        query: entry.query,
        cachedAt: new Date(entry.cachedAt).toISOString(),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
        ttl: entry.ttl,
        age: Date.now() - entry.cachedAt,
        expiresIn: entry.expiresAt ? entry.expiresAt - Date.now() : null
      });
      
      count++;
    }
    
    return entries;
  }

  /**
   * Invalidate cache by pattern
   * @param {string} pattern - Pattern to match
   * @returns {number} Number of invalidated entries
   */
  invalidate(pattern) {
    const regex = new RegExp(pattern);
    let invalidated = 0;
    
    for (const [key] of this.cache.entries()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        this.accessCount.delete(key);
        invalidated++;
      }
    }
    
    if (invalidated > 0) {
      this.stats.size = this.cache.size;
      this.stats.memoryUsage = this.estimateMemoryUsage();
      this.emit('cache-invalidated', { pattern, count: invalidated });
    }
    
    return invalidated;
  }

  /**
   * Pre-warm cache with queries
   * @param {Array} queries - Array of queries to pre-warm
   * @param {Function} executeQuery - Function to execute query
   * @returns {Promise<Array>} Pre-warm results
   */
  async prewarm(queries, executeQuery) {
    const results = [];
    
    for (const query of queries) {
      try {
        const result = await executeQuery(query);
        this.set(query, result);
        results.push({ query, success: true });
      } catch (error) {
        results.push({ query, success: false, error: error.message });
      }
    }
    
    this.emit('cache-prewarmed', { count: queries.length, results });
    return results;
  }

  /**
   * Reset cache statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage()
    };
    this.emit('stats-reset');
  }
}

export default QueryCacheMiddleware;
