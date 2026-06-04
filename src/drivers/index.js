/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/index
 */
// Driver registry mapping database types to driver classes
const drivers = {};

// Driver file path mapping
const driverPaths = {
  mysql: './mysql-driver.js',
  mariadb: './mysql-driver.js',
  postgresql: './postgres-driver.js',
  postgres: './postgres-driver.js',
  pg: './postgres-driver.js',
  sqlite: './sqlite-driver.js',
  sqlite3: './sqlite-driver.js',
  mongodb: './mongodb-driver.js',
  mongo: './mongodb-driver.js',
  mssql: './mssql-driver.js',
  sqlserver: './mssql-driver.js',
  oracle: './oracle-driver.js',
  // Add CockroachDB support (reuse PostgreSQL driver)
  cockroachdb: './postgres-driver.js',
  cockroach: './postgres-driver.js',
  // Add ClickHouse support (requires separate driver)
  clickhouse: './clickhouse-driver.js'
};

/**
 * Get driver class by database type name using dynamic imports
 * @param {string} name - Database type name (mysql, postgresql, sqlite, etc.)
 * @returns {Promise<Class|null>} Driver class or null if not found
 */
export async function getDriver(name) {
  const normalizedName = name.toLowerCase();
  
  // Return cached driver if already loaded
  if (drivers[normalizedName]) {
    return drivers[normalizedName];
  }
  
  // Check if it's MySQL (your current database)
  if (normalizedName === 'mysql' || normalizedName === 'mariadb') {
    try {
      // Only dynamically import MySQL driver
      const { default: MySQLDriver } = await import('./mysql-driver.js');
      drivers[normalizedName] = MySQLDriver;
      return MySQLDriver;
    } catch (error) {
      console.error(`❌ Failed to load MySQL driver:`, error.message);
      return null;
    }
  }

  // Check if it's MongoDB
  if (normalizedName === 'mongodb' || normalizedName === 'mongo') {
    try {
      // Dynamically import MongoDB driver
      const { default: MongoDBDriver } = await import('./mongodb-driver.js');
      drivers[normalizedName] = MongoDBDriver;
      return MongoDBDriver;
    } catch (error) {
      console.error(`❌ Failed to load MongoDB driver:`, error.message);
      return null;
    }
  }

  // Check if it's CockroachDB (reuse PostgreSQL driver)
  if (normalizedName === 'cockroachdb' || normalizedName === 'cockroach') {
    // Check if CockroachDB support is enabled via environment variable
    if (process.env.ENABLE_COCKROACHDB !== 'true') {
      console.warn(`⚠️ CockroachDB driver is disabled. Set ENABLE_COCKROACHDB=true to enable.`);
      return null;
    }
    
    try {
      // CockroachDB is PostgreSQL compatible, reuse PostgreSQL driver
      const { default: PostgreSQLDriver } = await import('./postgres-driver.js');
      drivers[normalizedName] = PostgreSQLDriver;

      return PostgreSQLDriver;
    } catch (error) {
      console.error(`❌ Failed to load CockroachDB driver:`, error.message);
      return null;
    }
  }

  // Check if it's ClickHouse
  if (normalizedName === 'clickhouse') {
    // Check if ClickHouse support is enabled via environment variable
    if (process.env.ENABLE_CLICKHOUSE !== 'true') {
      console.warn(`⚠️ ClickHouse driver is disabled. Set ENABLE_CLICKHOUSE=true to enable.`);
      return null;
    }
    
    try {
      // Dynamically import ClickHouse driver
      const { default: ClickHouseDriver } = await import('./clickhouse-driver.js');
      drivers[normalizedName] = ClickHouseDriver;

      return ClickHouseDriver;
    } catch (error) {
      console.error(`❌ Failed to load ClickHouse driver:`, error.message);
      return null;
    }
  }
  
  // For other drivers, return null and prompt for installation
  console.warn(`⚠️ Driver "${name}" not loaded. To use this driver, install required package:`);
  
  const packageMap = {
    postgresql: 'pg',
    postgres: 'pg',
    pg: 'pg',
    sqlite: 'sqlite3',
    sqlite3: 'sqlite3',
    mongodb: 'mongodb',
    mongo: 'mongodb',
    redis: 'redis',
    mssql: 'mssql',
    sqlserver: 'mssql',
    oracle: 'oracledb',
    cockroachdb: 'pg',        // CockroachDB uses PostgreSQL driver
    cockroach: 'pg',          // CockroachDB uses PostgreSQL driver
    clickhouse: '@clickhouse/client'  // ClickHouse client package
  };
  
  if (packageMap[normalizedName]) {
    console.warn(`   npm install ${packageMap[normalizedName]}`);
  }
  
  return null;
}

// Check if driver exists
export function hasDriver(name) {
  const normalizedName = name.toLowerCase();
  return !!drivers[normalizedName];
}

// Get all available driver names
export function getAvailableDrivers() {
  return Object.keys(driverPaths);
}

// Register custom driver
export function registerDriver(name, driverClass) {
  const normalizedName = name.toLowerCase();
  if (drivers[normalizedName]) {
    console.warn(`⚠️ Driver "${name}" is already registered, overriding existing driver`);
  }
  drivers[normalizedName] = driverClass;
}

// Remove registered driver
export function unregisterDriver(name) {
  const normalizedName = name.toLowerCase();
  if (drivers[normalizedName]) {
    delete drivers[normalizedName];
  } else {
    console.warn(`⚠️ Driver "${name}" not found, nothing to unregister`);
  }
}

// Preload all drivers
export async function preloadDrivers() {
  const driverNames = getAvailableDrivers();
  const promises = driverNames.map(async (name) => {
    try {
      await getDriver(name);
    } catch (error) {
      console.error(`❌ Failed to preload driver "${name}":`, error.message);
    }
  });
  await Promise.all(promises);
}

// Clear driver cache
export function clearDriverCache() {
  drivers.clear();
}

// On-demand export of individual drivers
export async function getMySQLDriver() {
  return await getDriver('mysql');
}

export async function getPostgreSQLDriver() {
  return await getDriver('postgresql');
}

export async function getSQLiteDriver() {
  return await getDriver('sqlite');
}

export async function getMongoDBDriver() {
  return await getDriver('mongodb');
}

export async function getMSSQLDriver() {
  return await getDriver('mssql');
}

export async function getOracleDriver() {
  return await getDriver('oracle');
}

// New: Export CockroachDB driver (environment variable controlled)
export async function getCockroachDBDriver() {
  // Check if CockroachDB support is enabled
  if (process.env.ENABLE_COCKROACHDB !== 'true') {
    console.warn(`⚠️ CockroachDB driver is disabled. Set ENABLE_COCKROACHDB=true to enable.`);
    return null;
  }
  return await getDriver('cockroachdb');
}

// New: Export ClickHouse driver (environment variable controlled)
export async function getClickHouseDriver() {
  // Check if ClickHouse support is enabled
  if (process.env.ENABLE_CLICKHOUSE !== 'true') {
    console.warn(`⚠️ ClickHouse driver is disabled. Set ENABLE_CLICKHOUSE=true to enable.`);
    return null;
  }
  return await getDriver('clickhouse');
}

// New: Export Redis driver
export async function getRedisDriver() {
  return await getDriver('redis');
}

// New: Export all drivers as an object
export async function getAllDrivers() {
  const driverNames = getAvailableDrivers();
  const driversObj = {};
  
  for (const name of driverNames) {
    try {
      const driver = await getDriver(name);
      if (driver) {
        driversObj[name] = driver;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load driver "${name}":`, error.message);
    }
  }
  
  return driversObj;
}

// New: Check if specific driver is available
export async function isDriverAvailable(name) {
  try {
    const driver = await getDriver(name);
    return driver !== null;
  } catch (error) {
    return false;
  }
}

// New: Get driver with fallback
export async function getDriverWithFallback(name, fallbackName = 'mysql') {
  const driver = await getDriver(name);
  if (driver) {
    return driver;
  }
  
  console.warn(`⚠️ Driver "${name}" not available, falling back to "${fallbackName}"`);
  return await getDriver(fallbackName);
}
