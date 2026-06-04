/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/middleware/connection-pool
 */
import { EventEmitter } from 'events';

class ConnectionPoolMiddleware extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      maxConnections: options.maxConnections || 10,
      minConnections: options.minConnections || 2,
      idleTimeout: options.idleTimeout || 30000, // ms
      acquireTimeout: options.acquireTimeout || 10000, // ms
      evictionRunInterval: options.evictionRunInterval || 60000, // ms
      testOnBorrow: options.testOnBorrow !== false,
      testOnReturn: options.testOnReturn !== false,
      ...options
    };
    
    this.pool = new Map();
    this.activeConnections = new Set();
    this.waitingQueue = [];
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      connectionCreations: 0,
      connectionDestructions: 0,
      connectionTimeouts: 0,
      connectionErrors: 0
    };
    
    this.startEvictionTimer();
  }

  /**
   * Get a connection from pool
   * @param {string} connectionName - Connection name
   * @param {Function} createConnection - Function to create new connection
   * @returns {Promise<Object>} Database connection
   */
  async getConnection(connectionName, createConnection) {
    const poolKey = connectionName;
    
    // Check if we have idle connections
    if (this.pool.has(poolKey) && this.pool.get(poolKey).length > 0) {
      const connections = this.pool.get(poolKey);
      const connection = connections.pop();
      
      // Test connection if enabled
      if (this.options.testOnBorrow) {
        try {
          await this.testConnection(connection);
        } catch (error) {
          this.stats.connectionErrors++;
          this.emit('connection-test-failed', { connectionName, error });
          // Remove bad connection and create new one
          this.stats.connectionDestructions++;
          return this.createNewConnection(connectionName, createConnection);
        }
      }
      
      this.activeConnections.add(connection);
      this.stats.activeConnections++;
      this.stats.idleConnections--;
      
      this.emit('connection-acquired', { 
        connectionName, 
        fromPool: true,
        activeConnections: this.stats.activeConnections,
        idleConnections: this.stats.idleConnections
      });
      
      return connection;
    }
    
    // Check if we can create new connection
    if (this.stats.totalConnections < this.options.maxConnections) {
      const connection = await this.createNewConnection(connectionName, createConnection);
      this.activeConnections.add(connection);
      this.stats.activeConnections++;
      
      this.emit('connection-created', { 
        connectionName, 
        activeConnections: this.stats.activeConnections,
        totalConnections: this.stats.totalConnections
      });
      
      return connection;
    }
    
    // Wait for connection to become available
    return new Promise((resolve, reject) => {
      const waitStartTime = Date.now();
      const timeoutId = setTimeout(() => {
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
          this.stats.waitingClients--;
          this.stats.connectionTimeouts++;
          
          this.emit('connection-timeout', { 
            connectionName, 
            waitTime: Date.now() - waitStartTime,
            waitingClients: this.stats.waitingClients
          });
          
          reject(new Error(`Connection pool timeout after ${this.options.acquireTimeout}ms`));
        }
      }, this.options.acquireTimeout);
      
      this.waitingQueue.push({
        connectionName,
        resolve: async () => {
          clearTimeout(timeoutId);
          try {
            const connection = await this.getConnection(connectionName, createConnection);
            resolve(connection);
          } catch (error) {
            reject(error);
          }
        },
        reject,
        timestamp: Date.now()
      });
      
      this.stats.waitingClients++;
      this.emit('connection-waiting', { 
        connectionName, 
        waitingClients: this.stats.waitingClients 
      });
    });
  }

  /**
   * Release connection back to pool
   * @param {string} connectionName - Connection name
   * @param {Object} connection - Database connection
   */
  async releaseConnection(connectionName, connection) {
    if (!this.activeConnections.has(connection)) {
      this.emit('connection-not-active', { connectionName });
      return;
    }
    
    // Test connection if enabled
    if (this.options.testOnReturn) {
      try {
        await this.testConnection(connection);
      } catch (error) {
        this.stats.connectionErrors++;
        this.emit('connection-test-failed', { connectionName, error });
        // Destroy bad connection
        await this.destroyConnection(connectionName, connection);
        this.activeConnections.delete(connection);
        this.stats.activeConnections--;
        this.stats.totalConnections--;
        return;
      }
    }
    
    // Add connection back to pool
    if (!this.pool.has(connectionName)) {
      this.pool.set(connectionName, []);
    }
    
    this.pool.get(connectionName).push({
      connection,
      lastUsed: Date.now()
    });
    
    this.activeConnections.delete(connection);
    this.stats.activeConnections--;
    this.stats.idleConnections++;
    
    // Check waiting queue
    if (this.waitingQueue.length > 0) {
      const nextRequest = this.waitingQueue.shift();
      this.stats.waitingClients--;
      nextRequest.resolve();
    }
    
    this.emit('connection-released', { 
      connectionName, 
      activeConnections: this.stats.activeConnections,
      idleConnections: this.stats.idleConnections,
      waitingClients: this.stats.waitingClients
    });
  }

  /**
   * Create new connection
   * @param {string} connectionName - Connection name
   * @param {Function} createConnection - Function to create new connection
   * @returns {Promise<Object>} New connection
   */
  async createNewConnection(connectionName, createConnection) {
    try {
      const connection = await createConnection();
      this.stats.totalConnections++;
      this.stats.connectionCreations++;
      
      this.emit('connection-created', { 
        connectionName, 
        activeConnections: this.stats.activeConnections,
        totalConnections: this.stats.totalConnections
      });
      
      return connection;
    } catch (error) {
      this.stats.connectionErrors++;
      this.emit('connection-creation-error', { connectionName, error });
      throw error;
    }
  }

  /**
   * Destroy connection
   * @param {string} connectionName - Connection name
   * @param {Object} connection - Database connection
   */
  async destroyConnection(connectionName, connection) {
    try {
      if (typeof connection.close === 'function') {
        await connection.close();
      } else if (typeof connection.end === 'function') {
        await connection.end();
      } else if (typeof connection.destroy === 'function') {
        connection.destroy();
      }
      
      this.stats.connectionDestructions++;
      this.emit('connection-destroyed', { connectionName });
    } catch (error) {
      this.stats.connectionErrors++;
      this.emit('connection-destruction-error', { connectionName, error });
    }
  }

  /**
   * Test connection health
   * @param {Object} connection - Database connection
   * @returns {Promise<boolean>} True if connection is healthy
   */
  async testConnection(connection) {
    // Try to execute a simple query to test connection
    if (typeof connection.query === 'function') {
      try {
        await connection.query('SELECT 1');
        return true;
      } catch (error) {
        return false;
      }
    }
    
    // For connections without query method, assume they're healthy
    return true;
  }

  /**
   * Start eviction timer
   */
  startEvictionTimer() {
    setInterval(() => {
      this.evictIdleConnections();
    }, this.options.evictionRunInterval);
  }

  /**
   * Evict idle connections
   */
  async evictIdleConnections() {
    const now = Date.now();
    
    for (const [connectionName, connections] of this.pool.entries()) {
      const activeConnections = [];
      const idleConnections = [];
      const toDestroy = [];
      
      for (const connInfo of connections) {
        const idleTime = now - connInfo.lastUsed;
        
        if (idleTime > this.options.idleTimeout) {
          toDestroy.push(connInfo);
        } else if (this.activeConnections.has(connInfo.connection)) {
          activeConnections.push(connInfo);
        } else {
          idleConnections.push(connInfo);
        }
      }
      
      // Destroy idle connections that exceed idle timeout
      for (const connInfo of toDestroy) {
        await this.destroyConnection(connectionName, connInfo.connection);
      }
      
      // Update pool with remaining connections
      this.pool.set(connectionName, idleConnections);
      this.stats.idleConnections = idleConnections.length;
      this.stats.activeConnections = activeConnections.length;
    }
  }

    /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getStats() {
    const poolStats = {};
    for (const [connectionName, connections] of this.pool.entries()) {
      poolStats[connectionName] = {
        idleConnections: connections.length,
        activeConnections: Array.from(this.activeConnections).filter(conn => 
          this.getConnectionName(conn) === connectionName
        ).length
      };
    }
    
    return {
      ...this.stats,
      poolStats,
      waitingQueueSize: this.waitingQueue.length,
      evictionRunInterval: this.options.evictionRunInterval,
      idleTimeout: this.options.idleTimeout,
      acquireTimeout: this.options.acquireTimeout,
      maxConnections: this.options.maxConnections,
      minConnections: this.options.minConnections,
      testOnBorrow: this.options.testOnBorrow,
      testOnReturn: this.options.testOnReturn,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get connection name from connection object
   * @param {Object} connection - Database connection
   * @returns {string} Connection name
   */
  getConnectionName(connection) {
    for (const [name, connections] of this.pool.entries()) {
      if (connections.some(connInfo => connInfo.connection === connection)) {
        return name;
      }
    }
    return 'unknown';
  }

  /**
   * Close all connections in pool
   * @returns {Promise<void>}
   */
  async closeAll() {
    const closePromises = [];
    
    // Close all idle connections
    for (const [connectionName, connections] of this.pool.entries()) {
      for (const connInfo of connections) {
        closePromises.push(this.destroyConnection(connectionName, connInfo.connection));
      }
    }
    
    // Close all active connections
    for (const connection of this.activeConnections) {
      const connectionName = this.getConnectionName(connection);
      closePromises.push(this.destroyConnection(connectionName, connection));
    }
    
    // Clear waiting queue
    for (const request of this.waitingQueue) {
      request.reject(new Error('Connection pool closed'));
    }
    this.waitingQueue = [];
    
    await Promise.allSettled(closePromises);
    
    this.pool.clear();
    this.activeConnections.clear();
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      connectionCreations: 0,
      connectionDestructions: 0,
      connectionTimeouts: 0,
      connectionErrors: 0
    };
    
    this.emit('pool-closed');
  }

  /**
   * Drain pool (stop accepting new connections)
   * @returns {Promise<void>}
   */
  async drain() {
    this.options.maxConnections = 0;
    
    // Wait for all active connections to be released
    while (this.activeConnections.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Close all idle connections
    await this.closeAll();
    
    this.emit('pool-drained');
  }

  /**
   * Check if pool is healthy
   * @returns {Object} Health status
   */
  getHealth() {
    const stats = this.getStats();
    const isHealthy = 
      stats.connectionErrors < 10 && 
      stats.connectionTimeouts < 5 &&
      stats.waitingQueueSize < 20;
    
    return {
      healthy: isHealthy,
      status: isHealthy ? 'healthy' : 'unhealthy',
      issues: !isHealthy ? [
        ...(stats.connectionErrors >= 10 ? ['Too many connection errors'] : []),
        ...(stats.connectionTimeouts >= 5 ? ['Too many connection timeouts'] : []),
        ...(stats.waitingQueueSize >= 20 ? ['Too many waiting clients'] : [])
      ] : [],
      stats
    };
  }

  /**
   * Reset pool statistics
   */
  resetStats() {
    this.stats = {
      totalConnections: this.stats.totalConnections,
      activeConnections: this.stats.activeConnections,
      idleConnections: this.stats.idleConnections,
      waitingClients: this.stats.waitingClients,
      connectionCreations: 0,
      connectionDestructions: 0,
      connectionTimeouts: 0,
      connectionErrors: 0
    };
    this.emit('stats-reset');
  }
}

export default ConnectionPoolMiddleware;
