/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/src/utils/config-loader
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Configuration Loader - Loads and validates database configuration
 */
class ConfigLoader {
  /**
   * Load configuration from multiple sources
   * @param {Object} options - Loader options
   * @returns {Object} Configuration object
   */
  static load(options = {}) {
    const config = {
      // Default configuration
      enabled: true,
      crossDb: false,
      default: 'primary',
      connections: {},
      driverModules: {},
      externalDrivers: {
        enabled: false,
        path: './external-drivers'
      },
      cache: {
        enabled: false,
        ttl: 300000,
        maxSize: 1000,
        strategy: 'lru'
      },
      pool: {
        min: 2,
        max: 10,
        idleTimeout: 30000,
        acquireTimeout: 10000,
        evictionRunInterval: 60000
      },
      retry: {
        maxAttempts: 3,
        delay: 1000,
        backoff: true
      },
      middleware: {
        queryLogger: {
          enabled: true,
          logLevel: 'info',
          slowQueryThreshold: 1000,
          logToConsole: true,
          logToFile: false,
          logFile: 'query.log'
        },
        connectionPool: {
          enabled: true,
          maxConnections: 10,
          minConnections: 2,
          idleTimeout: 30000,
          acquireTimeout: 10000,
          evictionRunInterval: 60000,
          testOnBorrow: true,
          testOnReturn: true
        },
        queryCache: {
          enabled: false,
          ttl: 300000,
          maxSize: 1000,
          strategy: 'lru',
          cacheNullResults: true,
          cacheErrors: false
        },
        performanceMonitor: {
          enabled: true,
          slowQueryThreshold: 1000,
          maxQueryHistory: 1000,
          collectMetrics: true,
          metricsInterval: 60000,
          alertThresholds: {
            slowQueriesPerMinute: 10,
            errorRate: 0.1,
            connectionErrors: 5
          }
        }
      }
    };

    // Load from environment variables
    this.loadFromEnv(config);

    // Load from config file
    if (options.configFile) {
      this.loadFromFile(config, options.configFile);
    }

    // Load from command line arguments
    if (options.args) {
      this.loadFromArgs(config, options.args);
    }

    // Merge with provided options
    this.mergeConfig(config, options);

    // Validate configuration
    this.validateConfig(config);

    return config;
  }

  /**
   * Load configuration from environment variables
   * @param {Object} config - Configuration object
   */
  static loadFromEnv(config) {
    // Database module enabled
    if (process.env.DB_ENABLED !== undefined) {
      config.enabled = process.env.DB_ENABLED === 'true';
    }

    // Cross-database queries
    if (process.env.DB_CROSS_DB !== undefined) {
      config.crossDb = process.env.DB_CROSS_DB === 'true';
    }

    // Default connection
    if (process.env.DB_DEFAULT_CONNECTION) {
      config.default = process.env.DB_DEFAULT_CONNECTION;
    }

    // Driver module switches
    const drivers = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis', 'mssql', 'oracle'];
    drivers.forEach(driver => {
      const envVar = `DB_DRIVER_${driver.toUpperCase()}_ENABLED`;
      if (process.env[envVar] !== undefined) {
        config.driverModules[driver] = process.env[envVar] === 'true';
      }
    });

    // External drivers
    if (process.env.DB_EXTERNAL_DRIVERS_ENABLED !== undefined) {
      config.externalDrivers.enabled = process.env.DB_EXTERNAL_DRIVERS_ENABLED === 'true';
    }
    if (process.env.DB_EXTERNAL_DRIVERS_PATH) {
      config.externalDrivers.path = process.env.DB_EXTERNAL_DRIVERS_PATH;
    }

    // Cache configuration
    if (process.env.DB_CACHE_ENABLED !== undefined) {
      config.cache.enabled = process.env.DB_CACHE_ENABLED === 'true';
    }
    if (process.env.DB_CACHE_TTL) {
      config.cache.ttl = parseInt(process.env.DB_CACHE_TTL);
    }
    if (process.env.DB_CACHE_MAX_SIZE) {
      config.cache.maxSize = parseInt(process.env.DB_CACHE_MAX_SIZE);
    }
    if (process.env.DB_CACHE_STRATEGY) {
      config.cache.strategy = process.env.DB_CACHE_STRATEGY;
    }

    // Connection pool configuration
    if (process.env.DB_POOL_MIN) {
      config.pool.min = parseInt(process.env.DB_POOL_MIN);
    }
    if (process.env.DB_POOL_MAX) {
      config.pool.max = parseInt(process.env.DB_POOL_MAX);
    }
    if (process.env.DB_POOL_IDLE_TIMEOUT) {
      config.pool.idleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT);
    }
    if (process.env.DB_POOL_ACQUIRE_TIMEOUT) {
      config.pool.acquireTimeout = parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT);
    }
    if (process.env.DB_POOL_EVICTION_RUN_INTERVAL) {
      config.pool.evictionRunInterval = parseInt(process.env.DB_POOL_EVICTION_RUN_INTERVAL);
    }

    // Retry configuration
    if (process.env.DB_RETRY_MAX_ATTEMPTS) {
      config.retry.maxAttempts = parseInt(process.env.DB_RETRY_MAX_ATTEMPTS);
    }
    if (process.env.DB_RETRY_DELAY) {
      config.retry.delay = parseInt(process.env.DB_RETRY_DELAY);
    }
    if (process.env.DB_RETRY_BACKOFF !== undefined) {
      config.retry.backoff = process.env.DB_RETRY_BACKOFF === 'true';
    }

    // Load connection configurations for enabled drivers
    this.loadConnectionsFromEnv(config);
  }

  /**
   * Load connection configurations from environment variables
   * @param {Object} config - Configuration object
   */
  static loadConnectionsFromEnv(config) {
    const connectionConfigs = {
      mysql: {
        type: 'mysql',
        host: process.env.DB_DRIVER_MYSQL_HOST,
        port: process.env.DB_DRIVER_MYSQL_PORT,
        user: process.env.DB_DRIVER_MYSQL_USER,
        password: process.env.DB_DRIVER_MYSQL_PASSWORD,
        database: process.env.DB_DRIVER_MYSQL_DATABASE,
        charset: process.env.DB_DRIVER_MYSQL_CHARSET,
        timezone: process.env.DB_DRIVER_MYSQL_TIMEZONE
      },
      postgres: {
        type: 'postgresql',
        host: process.env.DB_DRIVER_POSTGRES_HOST,
        port: process.env.DB_DRIVER_POSTGRES_PORT,
        user: process.env.DB_DRIVER_POSTGRES_USER,
        password: process.env.DB_DRIVER_POSTGRES_PASSWORD,
        database: process.env.DB_DRIVER_POSTGRES_DATABASE,
        ssl: process.env.DB_DRIVER_POSTGRES_SSL === 'true'
      },
      sqlite: {
        type: 'sqlite',
        database: process.env.DB_DRIVER_SQLITE_DATABASE || ':memory:',
        mode: process.env.DB_DRIVER_SQLITE_MODE || 'memory'
      },
      mongodb: {
        type: 'mongodb',
        host: process.env.DB_DRIVER_MONGODB_HOST,
        port: process.env.DB_DRIVER_MONGODB_PORT,
        user: process.env.DB_DRIVER_MONGODB_USER,
        password: process.env.DB_DRIVER_MONGODB_PASSWORD,
        database: process.env.DB_DRIVER_MONGODB_DATABASE,
        authSource: process.env.DB_DRIVER_MONGODB_AUTH_SOURCE || 'admin'
      },
      redis: {
        type: 'redis',
        host: process.env.DB_DRIVER_REDIS_HOST,
        port: process.env.DB_DRIVER_REDIS_PORT,
        password: process.env.DB_DRIVER_REDIS_PASSWORD,
        db: parseInt(process.env.DB_DRIVER_REDIS_DB) || 0,
        keyPrefix: process.env.DB_DRIVER_REDIS_KEY_PREFIX || ''
      },
      mssql: {
        type: 'mssql',
        host: process.env.DB_DRIVER_MSSQL_HOST,
        port: process.env.DB_DRIVER_MSSQL_PORT,
        user: process.env.DB_DRIVER_MSSQL_USER,
        password: process.env.DB_DRIVER_MSSQL_PASSWORD,
        database: process.env.DB_DRIVER_MSSQL_DATABASE,
        encrypt: process.env.DB_DRIVER_MSSQL_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_DRIVER_MSSQL_TRUST_SERVER_CERTIFICATE === 'true'
      },
      oracle: {
        type: 'oracle',
        host: process.env.DB_DRIVER_ORACLE_HOST,
        port: process.env.DB_DRIVER_ORACLE_PORT,
        user: process.env.DB_DRIVER_ORACLE_USER,
        password: process.env.DB_DRIVER_ORACLE_PASSWORD,
        serviceName: process.env.DB_DRIVER_ORACLE_SERVICE_NAME || 'ORCL',
        connectString: process.env.DB_DRIVER_ORACLE_CONNECT_STRING
      }
    };

    // Only add connections for enabled modules
    for (const [name, enabled] of Object.entries(config.driverModules)) {
      if (enabled && connectionConfigs[name]) {
        const connConfig = connectionConfigs[name];
        const filteredConfig = Object.fromEntries(
          Object.entries(connConfig).filter(([_, value]) => value !== undefined)
        );
        
        if (Object.keys(filteredConfig).length > 0) {
          config.connections[name] = {
            ...filteredConfig,
            pool: config.pool
          };
        }
      }
    }

    // If no connections found and SQLite is enabled, create default SQLite connection
    if (Object.keys(config.connections).length === 0 && config.driverModules.sqlite) {
      config.connections.default = {
        type: 'sqlite',
        database: ':memory:',
        pool: config.pool
      };
      config.default = 'default';
    }
  }

  /**
   * Load configuration from file
   * @param {Object} config - Configuration object
   * @param {string} configFile - Configuration file path
   */
  static loadFromFile(config, configFile) {
    try {
      const filePath = path.isAbsolute(configFile) 
        ? configFile 
        : path.join(process.cwd(), configFile);
      
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        this.mergeConfig(config, fileConfig);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load configuration from file: ${configFile}`, error.message);
    }
  }

  /**
   * Load configuration from command line arguments
   * @param {Object} config - Configuration object
   * @param {Array} args - Command line arguments
   */
  static loadFromArgs(config, args) {
    // Parse command line arguments
    // Format: --db.host=localhost --db.port=3306
    for (const arg of args) {
      if (arg.startsWith('--db.')) {
        const [key, value] = arg.slice(5).split('=');
        if (key && value !== undefined) {
          this.setNestedValue(config, key.split('.'), value);
        }
      }
    }
  }

  /**
   * Set nested value in object
   * @param {Object} obj - Object to modify
   * @param {Array} path - Path array
   * @param {*} value - Value to set
   */
  static setNestedValue(obj, path, value) {
    const lastKey = path.pop();
    const target = path.reduce((acc, key) => {
      if (!acc[key]) acc[key] = {};
      return acc[key];
    }, obj);
    
    // Convert string values to appropriate types
    let finalValue = value;
    if (value === 'true') finalValue = true;
    else if (value === 'false') finalValue = false;
    else if (!isNaN(value) && value.trim() !== '') finalValue = Number(value);
    
    target[lastKey] = finalValue;
  }

  /**
   * Merge configurations
   * @param {Object} target - Target configuration
   * @param {Object} source - Source configuration
   */
  static mergeConfig(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  /**
   * Validate configuration
   * @param {Object} config - Configuration object
   * @throws {Error} If configuration is invalid
   */
  static validateConfig(config) {
    // Validate enabled drivers
    if (typeof config.enabled !== 'boolean') {
      throw new Error('DB_ENABLED must be a boolean');
    }

    // Validate driver modules
    if (typeof config.driverModules !== 'object') {
      throw new Error('driverModules must be an object');
    }

    // Validate connections
    if (typeof config.connections !== 'object') {
      throw new Error('connections must be an object');
    }

    // Validate pool configuration
    if (config.pool.min > config.pool.max) {
      throw new Error('DB_POOL_MIN cannot be greater than DB_POOL_MAX');
    }

    if (config.pool.min < 0 || config.pool.max < 1) {
      throw new Error('Pool size values must be positive');
    }

    // Validate cache configuration
    if (config.cache.ttl < 0) {
      throw new Error('DB_CACHE_TTL must be non-negative');
    }

    if (config.cache.maxSize < 0) {
      throw new Error('DB_CACHE_MAX_SIZE must be non-negative');
    }

    // Validate retry configuration
    if (config.retry.maxAttempts < 0) {
      throw new Error('DB_RETRY_MAX_ATTEMPTS must be non-negative');
    }

    if (config.retry.delay < 0) {
      throw new Error('DB_RETRY_DELAY must be non-negative');
    }

    // Validate middleware configurations
    if (config.middleware) {
      if (config.middleware.queryLogger) {
        if (config.middleware.queryLogger.slowQueryThreshold < 0) {
          throw new Error('slowQueryThreshold must be non-negative');
        }
      }

      if (config.middleware.performanceMonitor) {
        if (config.middleware.performanceMonitor.slowQueryThreshold < 0) {
          throw new Error('performanceMonitor.slowQueryThreshold must be non-negative');
        }
        if (config.middleware.performanceMonitor.alertThresholds.errorRate < 0 || config.middleware.performanceMonitor.alertThresholds.errorRate > 1) {
          throw new Error('performanceMonitor.alertThresholds.errorRate must be between 0 and 1');
        }
      }
    }

    // Log validation warnings
    this.logValidationWarnings(config);
  }

  /**
   * Log validation warnings
   * @param {Object} config - Configuration object
   */
  static logValidationWarnings(config) {
    // Check for enabled drivers without connections
    for (const [driver, enabled] of Object.entries(config.driverModules)) {
      if (enabled && !config.connections[driver]) {
        console.warn(`⚠️ Driver "${driver}" is enabled but no connection configuration found.`);
      }
    }

    // Check for connections without enabled drivers
    for (const [name, connConfig] of Object.entries(config.connections)) {
      const driverType = connConfig.type?.toLowerCase().replace(/[^a-z]/g, '');
      if (driverType && !config.driverModules[driverType]) {
        console.warn(`⚠️ Connection "${name}" uses driver "${driverType}" which is not enabled.`);
      }
    }

    // Check for missing default connection
    if (config.default && !config.connections[config.default]) {
      console.warn(`⚠️ Default connection "${config.default}" not found in connections.`);
    }
  }

  /**
   * Generate configuration template
   * @returns {Object} Configuration template
   */
  static generateTemplate() {
    return {
      enabled: true,
      crossDb: false,
      default: 'primary',
      connections: {
        mysql: {
          type: 'mysql',
          host: 'localhost',
          port: 3306,
          user: 'root',
          password: 'password',
          database: 'mydb',
          charset: 'utf8mb4',
          timezone: '+00:00'
        },
        postgres: {
          type: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'password',
          database: 'mydb',
          ssl: false
        },
        sqlite: {
          type: 'sqlite',
          database: './data/database.sqlite',
          mode: 'file'
        }
      },
      driverModules: {
        mysql: true,
        postgres: true,
        sqlite: true,
        mongodb: false,
        redis: false,
        mssql: false,
        oracle: false
      },
      externalDrivers: {
        enabled: false,
        path: './external-drivers'
      },
      cache: {
        enabled: false,
        ttl: 300000,
        maxSize: 1000,
        strategy: 'lru'
      },
      pool: {
        min: 2,
        max: 10,
        idleTimeout: 30000,
        acquireTimeout: 10000,
        evictionRunInterval: 60000
      },
      retry: {
        maxAttempts: 3,
        delay: 1000,
        backoff: true
      },
      middleware: {
        queryLogger: {
          enabled: true,
          logLevel: 'info',
          slowQueryThreshold: 1000,
          logToConsole: true,
          logToFile: false,
          logFile: 'query.log'
        },
        connectionPool: {
          enabled: true,
          maxConnections: 10,
          minConnections: 2,
          idleTimeout: 30000,
          acquireTimeout: 10000,
          evictionRunInterval: 60000,
          testOnBorrow: true,
          testOnReturn: true
        },
        queryCache: {
          enabled: false,
          ttl: 300000,
          maxSize: 1000,
          strategy: 'lru',
          cacheNullResults: true,
          cacheErrors: false
        },
        performanceMonitor: {
          enabled: true,
          slowQueryThreshold: 1000,
          maxQueryHistory: 1000,
          collectMetrics: true,
          metricsInterval: 60000,
          alertThresholds: {
            slowQueriesPerMinute: 10,
            errorRate: 0.1,
            connectionErrors: 5
          }
        }
      }
    };
  }

  /**
   * Save configuration to file
   * @param {Object} config - Configuration object
   * @param {string} filePath - File path
   */
  static saveToFile(config, filePath) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const configStr = JSON.stringify(config, null, 2);
      fs.writeFileSync(filePath, configStr, 'utf8');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get configuration summary
   * @param {Object} config - Configuration object
   * @returns {Object} Configuration summary
   */
  static getSummary(config) {
    const enabledDrivers = Object.entries(config.driverModules)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name);
    
    const disabledDrivers = Object.entries(config.driverModules)
      .filter(([_, enabled]) => !enabled)
      .map(([name]) => name);
    
    const connections = Object.keys(config.connections);
    
    return {
      enabled: config.enabled,
      crossDb: config.crossDb,
      defaultConnection: config.default,
      enabledDrivers,
      disabledDrivers,
      connections,
      connectionCount: connections.length,
      cacheEnabled: config.cache.enabled,
      poolSize: `${config.pool.min}-${config.pool.max}`,
      middleware: {
        queryLogger: config.middleware?.queryLogger?.enabled || false,
        connectionPool: config.middleware?.connectionPool?.enabled || false,
        queryCache: config.middleware?.queryCache?.enabled || false,
        performanceMonitor: config.middleware?.performanceMonitor?.enabled || false
      }
    };
  }
}

export default ConfigLoader;
