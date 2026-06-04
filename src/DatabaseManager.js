/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/src/DatabaseManager
 */
import { getDriver } from "./drivers/index.js";
import ConnectionManager from "./core/ConnectionManager.js";
import TransactionManager from "./core/TransactionManager.js";
import QueryBuilder from "./core/QueryBuilder.js";
import MongoQueryBuilder from "./core/MongoQueryBuilder.js";
import { PluginManager } from "./core/PluginManager.js";

// Import all plugins
import { CachePlugin } from "./plugins/CachePlugin.js";
// import { AuditPlugin } from "./plugins/AuditPlugin.js";
import { EncryptionPlugin } from "./plugins/EncryptionPlugin.js";
import { SyncPlugin } from "./plugins/SyncPlugin.js";
import { HookPlugin } from "./plugins/HookPlugin.js";
import { OptimisticLockPlugin } from "./plugins/OptimisticLockPlugin.js";
import { SoftDeletePlugin } from "./plugins/SoftDeletePlugin.js";
import { ShardingPlugin } from "./plugins/ShardingPlugin.js";
import { VersioningPlugin } from "./plugins/VersioningPlugin.js";
import { JsonPlugin } from "./plugins/JsonPlugin.js";
import { PerformancePlugin } from "./plugins/PerformancePlugin.js";
import { GraphQLPlugin } from "./plugins/GraphQLPlugin.js";
import { ResiliencePlugin } from "./plugins/ResiliencePlugin.js";
import { BatchOperationPlugin } from "./plugins/BatchOperationPlugin.js";
import { CtePlugin } from "./plugins/CtePlugin.js";
import { WindowFunctionPlugin } from "./plugins/WindowFunctionPlugin.js";
import { FullTextSearchPlugin } from "./plugins/FullTextSearchPlugin.js";
import { GeospatialPlugin } from "./plugins/GeospatialPlugin.js";
import { DistributedPlugin } from "./plugins/DistributedPlugin.js";

/**
 * DatabaseManager - Main database management class with comprehensive plugin support
 * Manages database connections, transactions, and plugin integration
 */
class DatabaseManager {
  /**
   * Constructor for DatabaseManager
   * @param {Object} config - Configuration object
   * @param {Object} config.connections - Database connections configuration
   * @param {string} config.default - Default connection name
   * @param {Object} config.plugins - Plugins configuration
   * @param {Object} config.pluginManager - Plugin manager configuration
   */
  constructor(config = {}) {
    this.config = config;
    this.connections = {};
    this.connectionManagers = {};
    this.transactionManagers = {};
    this.isInitialized = false;
    this.pluginManager = new PluginManager();
  }

  /**
   * Initialize DatabaseManager with connections and plugins
   * @returns {Promise<DatabaseManager>} Initialized DatabaseManager instance
   */
  async init() {
    if (this.isInitialized) return this;
    const { 
      connections = {}, 
      default: defaultConnection = "primary", 
      plugins = {},
      pluginManager = {}
    } = this.config;

    // Initialize plugin manager
    this.pluginManager.initialize(pluginManager);

    // Initialize plugins if configured
    if (plugins.enabled !== false) {
      this._initializePlugins(plugins);
    }

    // Initialize database connections
    for (const [name, connectionConfig] of Object.entries(connections)) {
      if (connectionConfig.enabled === false) {
        continue;
      }

      try {
        const DriverClass = await getDriver(connectionConfig.type);
        if (!DriverClass) {
          throw new Error(`Unsupported database type: ${connectionConfig.type}`);
        }

        const driver = new DriverClass(connectionConfig);
        const connectionManager = new ConnectionManager(driver, connectionConfig);

        await connectionManager.connect();

        const transactionManager = new TransactionManager(connectionManager, connectionConfig.type);

        this.connectionManagers[name] = connectionManager;
        this.transactionManagers[name] = transactionManager;
        this.connections[name] = connectionManager.connection;

      } catch (error) {
        throw error;
      }
    }

    if (!this.connectionManagers[defaultConnection]) {
      throw new Error(`Default connection "${defaultConnection}" not found`);
    }

    this.defaultConnectionName = defaultConnection;
    this.defaultConnectionManager = this.connectionManagers[defaultConnection];
    this.defaultTransactionManager = this.transactionManagers[defaultConnection];

    this.isInitialized = true;
    return this;
  }

  /**
   * Initialize all plugins based on configuration
   * @param {Object} pluginsConfig - Plugins configuration
   * @private
   */
  _initializePlugins(pluginsConfig) {
    // Core plugins
    const corePlugins = {
      cache: CachePlugin,
      // audit: AuditPlugin,
      encryption: EncryptionPlugin,
      sync: SyncPlugin,
      hook: HookPlugin,
      optimisticLock: OptimisticLockPlugin,
      softDelete: SoftDeletePlugin,
      sharding: ShardingPlugin,
      versioning: VersioningPlugin,
      json: JsonPlugin,
    };

    // Advanced plugins
    const advancedPlugins = {
      performance: PerformancePlugin,
      graphql: GraphQLPlugin,
      resilience: ResiliencePlugin,
      batch: BatchOperationPlugin,
      cte: CtePlugin,
      window: WindowFunctionPlugin,
      fullTextSearch: FullTextSearchPlugin,
      geospatial: GeospatialPlugin,
      distributed: DistributedPlugin,
    };

    // Register core plugins
    for (const [name, PluginClass] of Object.entries(corePlugins)) {
      if (pluginsConfig[name] !== false) {
        this.pluginManager.register(name, PluginClass, {
          enabled: true,
          priority: 100,
          config: pluginsConfig[name] || {},
        });
      }
    }

    // Register advanced plugins
    for (const [name, PluginClass] of Object.entries(advancedPlugins)) {
      if (pluginsConfig[name] !== false) {
        this.pluginManager.register(name, PluginClass, {
          enabled: true,
          priority: 90,
          config: pluginsConfig[name] || {},
        });
      }
    }

    // Initialize all registered plugins
    this.pluginManager.initializeAll();
  }

  /**
   * Get QueryBuilder with all plugins attached
   * @param {string} tableName - Table name
   * @param {string} connectionName - Connection name (optional)
   * @returns {QueryBuilder} QueryBuilder instance with all plugins
   */
  table(tableName, connectionName = this.defaultConnectionName) {
    if (!this.isInitialized) {
      throw new Error("DatabaseManager must be initialized before use");
    }

    const connectionManager = this.getConnectionManager(connectionName);

    const driver =
      typeof connectionManager.getDriver === "function"
        ? connectionManager.getDriver()
        : null;

    const dialect =
      typeof connectionManager.getDialect === "function"
        ? connectionManager.getDialect()
        : connectionManager.type || "mysql";

    // Create QueryBuilder instance
    const qb = new QueryBuilder(tableName, driver, dialect);

    // Attach all plugins to QueryBuilder
    this._attachAllPluginsToQueryBuilder(qb, connectionManager);

    // Unified execute method - all SELECT queries return array
    qb.execute = async () => {
      let sql = "";
      let bindings = [];

      if (typeof qb.toSQL === "function") {
        const result = qb.toSQL();
        sql =
          typeof result === "string"
            ? result
            : result.sql || result.query || "";
        bindings = Array.isArray(result?.bindings)
          ? result.bindings
          : qb.getBindings?.() || qb.bindings || [];
      } else if (typeof qb.build === "function") {
        sql = qb.build();
        bindings = qb.getBindings?.() || qb.bindings || [];
      }

      if (!sql) {
        throw new Error("QueryBuilder: Unable to generate SQL statement");
      }

      const sqlUpper = String(sql).trim().toUpperCase();
      const isSelect =
        qb.type === "select" ||
        (typeof qb.isSelect === "function" && qb.isSelect()) ||
        sqlUpper.startsWith("SELECT") ||
        sqlUpper.startsWith("SHOW");

      const result = isSelect
        ? await connectionManager.query(sql, bindings)
        : await connectionManager.execute(sql, bindings);

      // Key: SELECT queries uniformly return array
      if (isSelect) {
        return Array.isArray(result) ? result : result.rows || result;
      }

      return result; // INSERT/UPDATE/DELETE return original result object
    };

    return qb;
  }

  /**
   * Attach all plugins to QueryBuilder instance
   * @param {QueryBuilder} qb - QueryBuilder instance
   * @param {ConnectionManager} connectionManager - Connection manager
   * @private
   */
  _attachAllPluginsToQueryBuilder(qb, connectionManager) {
    // Get all enabled plugins from plugin manager
    const enabledPlugins = this.pluginManager.getEnabledPlugins();
    
    // Attach each plugin to QueryBuilder
    for (const [pluginName, pluginClass] of Object.entries(enabledPlugins)) {
      try {
        const pluginInstance = new pluginClass(qb);
        pluginInstance.init();
        
        // Store plugin reference on QueryBuilder
        qb[`${pluginName}Plugin`] = pluginInstance;
        
      } catch (error) {
        console.error(`❌ Failed to attach ${pluginName} plugin:`, error.message);
      }
    }
  }

  /**
   * Get connection manager by name
   * @param {string} name - Connection name
   * @returns {ConnectionManager} Connection manager instance
   */
  getConnectionManager(name = this.defaultConnectionName) {
    const manager = this.connectionManagers[name];
    if (!manager) throw new Error(`Connection "${name}" not found`);
    return manager;
  }

  /**
   * Get transaction manager by name
   * @param {string} name - Connection name
   * @returns {TransactionManager} Transaction manager instance
   */
  getTransactionManager(name = this.defaultConnectionName) {
    const manager = this.transactionManagers[name];
    if (!manager)
      throw new Error(`Transaction manager for "${name}" not found`);
    return manager;
  }

  /**
   * Execute raw SQL query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @param {string} connectionName - Connection name
   * @returns {Promise} Query result
   */
  async query(sql, params = [], connectionName) {
    const manager = this.getConnectionManager(connectionName);
    return await manager.query(sql, params);
  }

  /**
   * Execute raw SQL statement
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @param {string} connectionName - Connection name
   * @returns {Promise} Execution result
   */
  async execute(sql, params = [], connectionName) {
    const manager = this.getConnectionManager(connectionName);
    return await manager.execute(sql, params);
  }

  /**
   * Execute transaction
   * @param {Function} callback - Transaction callback
   * @param {string} connectionName - Connection name
   * @returns {Promise} Transaction result
   */
  async transaction(callback, connectionName = this.defaultConnectionName) {
    const manager = this.getTransactionManager(connectionName);
    return await manager.transaction(callback);
  }

  /**
   * Close all database connections
   * @returns {Promise<void>}
   */
  async close() {
    for (const [name, manager] of Object.entries(this.connectionManagers)) {
      try {
        await manager.close();
      } catch (e) {
        console.error(`❌ Failed to close ${name}:`, e.message);
      }
    }
    this.isInitialized = false;
  }

  /**
   * Health check for all connections
   * @returns {Promise<Object>} Health status for each connection
   */
  async healthCheck() {
    const health = {};
    for (const [name, manager] of Object.entries(this.connectionManagers)) {
      try {
        health[name] = await manager.healthCheck();
      } catch (error) {
        health[name] = { status: "error", error: error.message };
      }
    }
    return health;
  }

  /**
   * Get metrics for all connections
   * @returns {Object} Connection metrics
   */
  getMetrics() {
    const metrics = {};
    for (const [name, manager] of Object.entries(this.connectionManagers)) {
      metrics[name] = manager.getMetrics?.() || {};
    }
    return metrics;
  }

  /**
   * Get plugin manager instance
   * @returns {PluginManager} Plugin manager instance
   */
  getPluginManager() {
    return this.pluginManager;
  }

  /**
   * Register custom plugin
   * @param {string} name - Plugin name
   * @param {BasePlugin} pluginClass - Plugin class
   * @param {Object} options - Plugin options
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  registerPlugin(name, pluginClass, options = {}) {
    if (!pluginClass || typeof pluginClass !== 'function') {
      throw new Error("Plugin must be a class constructor");
    }
    
    this.pluginManager.register(name, pluginClass, options);
    return this;
  }

  /**
   * Enable specific plugin
   * @param {string} pluginName - Plugin name
   * @param {Object} options - Plugin options
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  enablePlugin(pluginName, options = {}) {
    this.pluginManager.enable(pluginName, options);
    return this;
  }

  /**
   * Disable specific plugin
   * @param {string} pluginName - Plugin name
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  disablePlugin(pluginName) {
    this.pluginManager.disable(pluginName);
    return this;
  }

  /**
   * Unregister plugin
   * @param {string} pluginName - Plugin name
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  unregisterPlugin(pluginName) {
    this.pluginManager.unregister(pluginName);
    return this;
  }

  /**
   * Get plugin by name
   * @param {string} pluginName - Plugin name
   * @returns {BasePlugin|null} Plugin instance or null
   */
  getPlugin(pluginName) {
    return this.pluginManager.get(pluginName);
  }

  /**
   * Get all registered plugins
   * @returns {Object} All registered plugins
   */
  getPlugins() {
    return this.pluginManager.getAll();
  }

  /**
   * Get enabled plugins
   * @returns {Array} Enabled plugins
   */
  getEnabledPlugins() {
    return this.pluginManager.getEnabled();
  }

  /**
   * Check if plugin is enabled
   * @param {string} pluginName - Plugin name
   * @returns {boolean} True if plugin is enabled
   */
  isPluginEnabled(pluginName) {
    return this.pluginManager.isEnabled(pluginName);
  }

  /**
   * Get plugin information
   * @param {string} pluginName - Plugin name
   * @returns {Object} Plugin information
   */
  getPluginInfo(pluginName) {
    return this.pluginManager.getPluginInfo(pluginName);
  }

  /**
   * Get plugin status
   * @returns {Object} Plugin status
   */
  getPluginStatus() {
    return this.pluginManager.getStatus();
  }

  /**
   * Load plugin configuration
   * @param {Object} config - Plugin configuration
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  loadPluginConfig(config) {
    this.pluginManager.loadConfig(config);
    return this;
  }

  /**
   * Save plugin configuration
   * @returns {Object} Plugin configuration
   */
  savePluginConfig() {
    return this.pluginManager.saveConfig();
  }

  /**
   * Hot reload plugin
   * @param {string} pluginName - Plugin name
   * @param {BasePlugin} newPluginClass - New plugin class
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  hotReloadPlugin(pluginName, newPluginClass) {
    this.pluginManager.hotReload(pluginName, newPluginClass);
    return this;
  }

  /**
   * Check plugin dependencies
   * @param {string} pluginName - Plugin name
   * @returns {Object} Dependency check result
   */
  checkPluginDependencies(pluginName) {
    return this.pluginManager.checkDependencies(pluginName);
  }

  /**
   * Get plugin dependency graph
   * @returns {Object} Dependency graph
   */
  getPluginDependencyGraph() {
    return this.pluginManager.getDependencyGraph();
  }

  /**
   * Validate plugin
   * @param {BasePlugin} pluginClass - Plugin class
   * @returns {Object} Validation result
   */
  validatePlugin(pluginClass) {
    return this.pluginManager.validatePlugin(pluginClass);
  }

  /**
   * Register all plugins at once
   * @param {Array} plugins - Array of plugin configurations
   * @returns {DatabaseManager} DatabaseManager instance for chaining
   */
  registerAllPlugins(plugins) {
    this.pluginManager.registerAll(plugins);
    return this;
  }

  /**
   * Get plugins by priority
   * @returns {Array} Plugins sorted by priority
   */
  getPluginsByPriority() {
    return this.pluginManager.getPluginsByPriority();
  }

  /**
   * Cleanup plugin system
   * @returns {Promise<void>}
   */
  async cleanupPlugins() {
    await this.pluginManager.cleanup();
  }
}

export default DatabaseManager;
