/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/DatabaseFactory
 */

import mysqlDriver from '../drivers/mysql-driver.js';
import postgresDriver from '../drivers/postgres-driver.js';
import sqliteDriver from '../drivers/sqlite-driver.js';
import mongodbDriver from '../drivers/mongodb-driver.js';
import redisDriver from '../drivers/redis-driver.js';
import mssqlDriver from '../drivers/mssql-driver.js';
import oracleDriver from '../drivers/oracle-driver.js';

/**
 * Database Factory - Core factory for creating database driver instances
 * Supports both built-in and external drivers with plugin architecture
 */
class DatabaseFactory {
  constructor() {
    this.drivers = new Map();
    this.externalDrivers = new Map();
    this.initializeBuiltInDrivers();
  }

  /**
   * Initialize built-in database drivers
   */
  initializeBuiltInDrivers() {
    const builtInDrivers = {
      'mysql': mysqlDriver,
      'mariadb': mysqlDriver,
      'postgresql': postgresDriver,
      'postgres': postgresDriver,
      'pg': postgresDriver,
      'sqlite': sqliteDriver,
      'sqlite3': sqliteDriver,
      'mongodb': mongodbDriver,
      'mongo': mongodbDriver,
      'redis': redisDriver,
      'mssql': mssqlDriver,
      'sqlserver': mssqlDriver,
      'oracle': oracleDriver
    };

    for (const [name, DriverClass] of Object.entries(builtInDrivers)) {
      this.registerDriver(name, DriverClass);
    }
  }

  /**
   * Register a new driver
   * @param {string} name - Driver name
   * @param {Class} DriverClass - Driver class
   */
  registerDriver(name, DriverClass) {
    this.drivers.set(name.toLowerCase(), DriverClass);
  }

  /**
   * Register external driver
   * @param {string} name - Driver name
   * @param {Class} DriverClass - Driver class
   */
  registerExternalDriver(name, DriverClass) {
    this.externalDrivers.set(name.toLowerCase(), DriverClass);
  }

  /**
   * Load driver dynamically
   * @param {string} driverName - Driver name
   * @returns {Promise<Class>} Driver class
   */
  async loadDriver(driverName) {
    const normalizedName = driverName.toLowerCase();
    
    // Check if driver is already loaded
    if (this.drivers.has(normalizedName)) {
      return this.drivers.get(normalizedName);
    }

    // Check if it's an external driver
    if (this.externalDrivers.has(normalizedName)) {
      return this.externalDrivers.get(normalizedName);
    }

    // Try to load from external drivers directory
    try {
      const driverModule = await import(`../drivers/${normalizedName}-driver.js`);
      if (driverModule.default && typeof driverModule.default === 'function') {
        this.registerDriver(normalizedName, driverModule.default);
        return driverModule.default;
      }
    } catch (error) {
      // Driver not found in drivers directory
    }

    throw new Error(`Unsupported database driver: ${driverName}`);
  }

  /**
   * Create driver instance
   * @param {string} driverName - Driver name
   * @param {Object} config - Driver configuration
   * @returns {Object} Driver instance
   */
  createDriver(driverName, config) {
    const normalizedName = driverName.toLowerCase();
    
    // Check built-in drivers first
    if (this.drivers.has(normalizedName)) {
      const DriverClass = this.drivers.get(normalizedName);
      return new DriverClass(config);
    }

    // Check external drivers
    if (this.externalDrivers.has(normalizedName)) {
      const DriverClass = this.externalDrivers.get(normalizedName);
      return new DriverClass(config);
    }

    throw new Error(`Driver not found: ${driverName}`);
  }

  /**
   * Get available driver names
   * @returns {Array} List of available driver names
   */
  getAvailableDrivers() {
    const builtInDrivers = Array.from(this.drivers.keys());
    const externalDrivers = Array.from(this.externalDrivers.keys());
    return [...builtInDrivers, ...externalDrivers];
  }

  /**
   * Check if driver exists
   * @param {string} driverName - Driver name
   * @returns {boolean} True if driver exists
   */
  hasDriver(driverName) {
    const normalizedName = driverName.toLowerCase();
    return this.drivers.has(normalizedName) || this.externalDrivers.has(normalizedName);
  }

  /**
   * Remove driver
   * @param {string} driverName - Driver name
   */
  removeDriver(driverName) {
    const normalizedName = driverName.toLowerCase();
    if (this.drivers.has(normalizedName)) {
      this.drivers.delete(normalizedName);
    }
    if (this.externalDrivers.has(normalizedName)) {
      this.externalDrivers.delete(normalizedName);
    }
  }

  /**
   * Clear all drivers
   */
  clearDrivers() {
    this.drivers.clear();
    this.externalDrivers.clear();
  }

  /**
   * Get driver info
   * @param {string} driverName - Driver name
   * @returns {Object} Driver information
   */
  getDriverInfo(driverName) {
    const normalizedName = driverName.toLowerCase();
    const isBuiltIn = this.drivers.has(normalizedName);
    const isExternal = this.externalDrivers.has(normalizedName);
    
    return {
      name: driverName,
      isBuiltIn,
      isExternal,
      exists: isBuiltIn || isExternal,
      type: isBuiltIn ? 'built-in' : isExternal ? 'external' : 'not-found'
    };
  }
}

export default DatabaseFactory;
