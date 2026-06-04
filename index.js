/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/index
 */
import DatabaseManager from './src/DatabaseManager.js';


export { 
  getDriver, 
  hasDriver, 
  getAvailableDrivers,
  registerDriver,
  unregisterDriver,
  preloadDrivers,
  clearDriverCache,
  getMySQLDriver,
  getPostgreSQLDriver,
  getSQLiteDriver,
  getMongoDBDriver,
  getRedisDriver,
  getMSSQLDriver,
  getOracleDriver
} from './src/drivers/index.js';


export { default as ConnectionManager } from './src/core/ConnectionManager.js';
export { default as TransactionManager } from './src/core/TransactionManager.js';

export default DatabaseManager;
