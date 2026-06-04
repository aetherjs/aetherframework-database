/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/PluginManager
 */

import { EventEmitter } from "events";

/**
 * PluginManager - Manages QueryBuilder plugin system
 * Provides plugin registration, loading, unloading, and event management
 */
export class PluginManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.plugins = new Map(); // Store registered plugin classes
    this.pluginInstances = new Map(); // Store plugin instances
    this.methods = new Map(); // Store plugin methods
    this.hooks = new Map(); // Store hook functions
    this.middlewares = new Map(); // Store middleware functions
    this.initialized = false;
  }

  /**
   * Initialize plugin manager
   * @param {Object} config - Plugin manager configuration
   * @returns {PluginManager} PluginManager instance
   */
  initialize(config = {}) {
    if (this.initialized) return this;

    this.config = { ...this.config, ...config };
    this.initialized = true;
    
    this.emit("initialized", { config: this.config });

    
    return this;
  }

  /**
   * Register a plugin
   * @param {string} name - Plugin name
   * @param {Function} PluginClass - Plugin class constructor
   * @param {Object} options - Plugin options
   * @returns {PluginManager} PluginManager instance
   */
  register(name, PluginClass, options = {}) {
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered`);
    }

    // Validate plugin class
    if (!PluginClass || typeof PluginClass !== "function") {
      throw new Error(`Plugin "${name}" must be a class constructor`);
    }

    // Check if plugin extends BasePlugin
    const pluginProto = PluginClass.prototype;
    if (!pluginProto || typeof pluginProto._registerMethods !== "function") {
      console.warn(`Plugin "${name}" may not extend BasePlugin properly`);
    }

    // Store plugin class and options
    this.plugins.set(name, {
      class: PluginClass,
      options: {
        name,
        enabled: options.enabled !== false,
        priority: options.priority || 0,
        dependencies: options.dependencies || [],
        config: options.config || {},
        registeredAt: new Date(),
      },
    });

    this.emit("plugin:registered", { name, PluginClass, options });

    
    return this;
  }

  /**
   * Enable a plugin
   * @param {string} name - Plugin name
   * @param {Object} options - Plugin options
   * @returns {PluginManager} PluginManager instance
   */
  enable(name, options = {}) {
    const pluginInfo = this.plugins.get(name);
    if (!pluginInfo) {
      throw new Error(`Plugin "${name}" not found`);
    }

    if (pluginInfo.options.enabled) {
      return this;
    }

    // Check dependencies
    this._checkDependencies(name);

    pluginInfo.options.enabled = true;
    pluginInfo.options.config = { ...pluginInfo.options.config, ...options };

    this.emit("plugin:enabled", { name, options: pluginInfo.options });

    
    return this;
  }

  /**
   * Disable a plugin
   * @param {string} name - Plugin name
   * @returns {PluginManager} PluginManager instance
   */
  disable(name) {
    const pluginInfo = this.plugins.get(name);
    if (!pluginInfo) {
      throw new Error(`Plugin "${name}" not found`);
    }

    if (!pluginInfo.options.enabled) {
      return this;
    }

    pluginInfo.options.enabled = false;

    // Cleanup plugin instance if it exists
    if (this.pluginInstances.has(name)) {
      const instance = this.pluginInstances.get(name);
      if (instance && typeof instance.cleanup === "function") {
        instance.cleanup();
      }
      this.pluginInstances.delete(name);
    }

    this.emit("plugin:disabled", { name });

    
    return this;
  }

  /**
   * Unregister a plugin
   * @param {string} name - Plugin name
   * @returns {PluginManager} PluginManager instance
   */
  unregister(name) {
    const pluginInfo = this.plugins.get(name);
    if (!pluginInfo) {
      return this;
    }

    // Check if other plugins depend on this plugin
    for (const [otherName, otherPlugin] of this.plugins) {
      if (otherName !== name && otherPlugin.options.dependencies.includes(name)) {
        throw new Error(
          `Cannot unregister plugin "${name}" because "${otherName}" depends on it`
        );
      }
    }

    // Disable first
    this.disable(name);

    // Remove from registry
    this.plugins.delete(name);

    this.emit("plugin:unregistered", { name });

    
    return this;
  }

  /**
   * Check plugin dependencies
   * @param {string} pluginName - Plugin name
   * @private
   */
  _checkDependencies(pluginName) {
    const pluginInfo = this.plugins.get(pluginName);
    if (!pluginInfo) return;

    const visited = new Set();
    const stack = new Set();
    const missing = [];
    const circular = [];

    const check = (name, path = []) => {
      if (visited.has(name)) return;

      if (stack.has(name)) {
        circular.push([...path, name]);
        return;
      }

      const plugin = this.plugins.get(name);
      if (!plugin) {
        missing.push(name);
        return;
      }

      stack.add(name);
      path.push(name);

      for (const dep of plugin.options.dependencies) {
        check(dep, [...path]);
      }

      stack.delete(name);
      visited.add(name);
    };

    check(pluginName);

    if (missing.length > 0) {
      throw new Error(
        `Plugin "${pluginName}" missing dependencies: ${missing.join(", ")}`
      );
    }

    if (circular.length > 0) {
      throw new Error(
        `Plugin "${pluginName}" has circular dependencies: ${circular
          .map((path) => path.join(" -> "))
          .join(", ")}`
      );
    }
  }

  /**
   * Get plugin class
   * @param {string} name - Plugin name
   * @returns {Function|null} Plugin class or null
   */
  get(name) {
    const pluginInfo = this.plugins.get(name);
    return pluginInfo ? pluginInfo.class : null;
  }

  /**
   * Get or create plugin instance for a specific QueryBuilder
   * @param {string} name - Plugin name
   * @param {QueryBuilder} queryBuilder - QueryBuilder instance
   * @returns {BasePlugin|null} Plugin instance or null
   */
  getInstance(name, queryBuilder) {
    // Create a unique key for this plugin instance (plugin name + queryBuilder reference)
    const instanceKey = `${name}_${queryBuilder._instanceId || Date.now()}`;
    
    if (this.pluginInstances.has(instanceKey)) {
      return this.pluginInstances.get(instanceKey);
    }

    const PluginClass = this.get(name);
    if (!PluginClass) return null;

    const instance = new PluginClass(queryBuilder);
    this.pluginInstances.set(instanceKey, instance);
    return instance;
  }

  /**
   * Check if plugin exists
   * @param {string} name - Plugin name
   * @returns {boolean} True if plugin exists
   */
  has(name) {
    return this.plugins.has(name);
  }

  /**
   * Check if plugin is enabled
   * @param {string} name - Plugin name
   * @returns {boolean} True if plugin is enabled
   */
  isEnabled(name) {
    const pluginInfo = this.plugins.get(name);
    return pluginInfo ? pluginInfo.options.enabled : false;
  }

  /**
   * Get all registered plugins
   * @returns {Array} All registered plugins
   */
  getAll() {
    return Array.from(this.plugins.values()).map((info) => ({
      name: info.options.name,
      class: info.class,
      options: info.options,
    }));
  }

  /**
   * Get enabled plugins
   * @returns {Array} Enabled plugins
   */
  getEnabled() {
    return Array.from(this.plugins.values())
      .filter((info) => info.options.enabled)
      .map((info) => info.class);
  }

  /**
   * Get enabled plugin names mapping
   * @returns {Object} Enabled plugins name mapping
   */
  getEnabledPlugins() {
    const enabledPlugins = {};
    for (const [name, info] of this.plugins) {
      if (info.options.enabled) {
        enabledPlugins[name] = info.class;
      }
    }
    return enabledPlugins;
  }

  /**
   * Get plugin information
   * @param {string} name - Plugin name
   * @returns {Object|null} Plugin information or null
   */
  getPluginInfo(name) {
    const pluginInfo = this.plugins.get(name);
    if (!pluginInfo) return null;

    const PluginClass = pluginInfo.class;
    const proto = PluginClass.prototype;
    const methods = [];

    // Get all methods from prototype
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== "constructor" && typeof proto[key] === "function") {
        methods.push(key);
      }
    }

    return {
      name: pluginInfo.options.name,
      version: pluginInfo.options.version || "1.0.0",
      enabled: pluginInfo.options.enabled,
      priority: pluginInfo.options.priority,
      dependencies: pluginInfo.options.dependencies,
      config: pluginInfo.options.config,
      registeredAt: pluginInfo.options.registeredAt,
      methods: methods,
    };
  }

  /**
   * Initialize all plugins for a specific QueryBuilder
   * @param {QueryBuilder} queryBuilder - QueryBuilder instance
   * @returns {Promise<void>}
   */
  async initializePluginsForQueryBuilder(queryBuilder) {
    if (!this.initialized) {
      throw new Error("PluginManager must be initialized first");
    }

    if (!queryBuilder) {
      throw new Error("QueryBuilder is required for plugin initialization");
    }

    const enabledPlugins = this.getEnabled();
    
    for (const PluginClass of enabledPlugins) {
      try {
        // Create plugin instance with QueryBuilder
        const pluginInstance = new PluginClass(queryBuilder);
        
        // Initialize the plugin
        await pluginInstance.init();
        
        // Store plugin instance with unique key
        const pluginName = pluginInstance.pluginName || PluginClass.name;
        const instanceKey = `${pluginName}_${queryBuilder._instanceId || Date.now()}`;
        this.pluginInstances.set(instanceKey, pluginInstance);

      } catch (error) {

        throw error;
      }
    }
  }

  /**
   * Initialize all registered plugins (without QueryBuilder)
   * This method only registers plugins, doesn't create instances
   * @returns {Promise<void>}
   */
  async initializeAll() {
    if (!this.initialized) {
      throw new Error("PluginManager must be initialized first");
    }

    const enabledPlugins = this.getEnabled();
    
    for (const PluginClass of enabledPlugins) {
      try {
        // Just log registration, don't create instances
        const pluginName = PluginClass.prototype.pluginName || PluginClass.name;
      } catch (error) {
        throw error;
      }
    }
  }
  /**
   * Get plugin configuration
   * @param {string} pluginName - Plugin name
   * @returns {Object|null} Plugin configuration or null if not found
   */
  getPluginConfig(pluginName) {
    const plugin = this.plugins.get(pluginName);
    return plugin ? plugin.config : null;
  }
  /**
   * Register method to QueryBuilder
   * @param {string} name - Method name
   * @param {Function} method - Method function
   * @param {Object} options - Method options
   * @returns {PluginManager} PluginManager instance
   */
  registerMethod(name, method, options = {}) {
    if (typeof method !== "function") {
      throw new Error(`Method "${name}" must be a function`);
    }

    // Check if method already exists
    if (this.methods.has(name)) {
      if (options.override) {
        console.warn(`Method "${name}" will be overridden`);
      } else {
        throw new Error(`Method "${name}" already exists`);
      }
    }

    // Store method
    this.methods.set(name, {
      method,
      plugin: options.plugin,
      description: options.description,
      addedAt: new Date(),
    });

    this.emit("method:registered", { name, method, options });
    return this;
  }

  /**
   * Remove method
   * @param {string} name - Method name
   * @returns {PluginManager} PluginManager instance
   */
  unregisterMethod(name) {
    const methodInfo = this.methods.get(name);
    if (!methodInfo) {
      return this;
    }

    // Remove from storage
    this.methods.delete(name);

    this.emit("method:unregistered", { name, methodInfo });
    return this;
  }

  /**
   * Register hook
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   * @param {Object} options - Hook options
   * @returns {PluginManager} PluginManager instance
   */
  registerHook(event, handler, options = {}) {
    if (typeof handler !== "function") {
      throw new Error(`Hook handler "${event}" must be a function`);
    }

    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }

    const hook = {
      handler,
      plugin: options.plugin,
      priority: options.priority || 0,
      once: options.once || false,
      addedAt: new Date(),
    };

    // Insert sorted by priority
    const hooks = this.hooks.get(event);
    const index = hooks.findIndex((h) => h.priority < hook.priority);
    if (index === -1) {
      hooks.push(hook);
    } else {
      hooks.splice(index, 0, hook);
    }

    this.emit("hook:registered", { event, hook, options });
    return this;
  }

  /**
   * Trigger hook
   * @param {string} event - Event name
   * @param {...any} args - Arguments
   * @returns {Promise<Array>} Results from all hooks
   */
  async triggerHook(event, ...args) {
    if (!this.hooks.has(event)) {
      return [];
    }

    const hooks = this.hooks.get(event);
    const results = [];

    for (const hook of hooks) {
      try {
        const result = await hook.handler(...args);
        results.push(result);

        // If it's a one-time hook, remove it
        if (hook.once) {
          this.unregisterHook(event, hook.handler);
        }
      } catch (error) {
        console.error(`Hook "${event}" execution error:`, error);
        this.emit("hook:error", { event, hook, error, args });
      }
    }

    this.emit("hook:triggered", { event, results, args });
    return results;
  }

  /**
   * Remove hook
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   * @returns {PluginManager} PluginManager instance
   */
  unregisterHook(event, handler) {
    if (!this.hooks.has(event)) {
      return this;
    }

    const hooks = this.hooks.get(event);
    const index = hooks.findIndex((h) => h.handler === handler);

    if (index !== -1) {
      const removed = hooks.splice(index, 1);
      this.emit("hook:unregistered", { event, hook: removed });
    }

    if (hooks.length === 0) {
      this.hooks.delete(event);
    }

    return this;
  }

  /**
   * Register middleware
   * @param {string} type - Middleware type
   * @param {Function} middleware - Middleware function
   * @param {Object} options - Middleware options
   * @returns {PluginManager} PluginManager instance
   */
  registerMiddleware(type, middleware, options = {}) {
    if (typeof middleware !== "function") {
      throw new Error(`Middleware "${type}" must be a function`);
    }

    if (!this.middlewares.has(type)) {
      this.middlewares.set(type, []);
    }

    const mw = {
      middleware,
      plugin: options.plugin,
      priority: options.priority || 0,
      addedAt: new Date(),
    };

    // Insert sorted by priority
    const middlewares = this.middlewares.get(type);
    const index = middlewares.findIndex((m) => m.priority < mw.priority);
    if (index === -1) {
      middlewares.push(mw);
    } else {
      middlewares.splice(index, 0, mw);
    }

    this.emit("middleware:registered", { type, middleware: mw, options });
    return this;
  }

  /**
   * Execute middleware
   * @param {string} type - Middleware type
   * @param {*} context - Context object
   * @param {...any} args - Additional arguments
   * @returns {Promise<*>} Result after middleware processing
   */
  async executeMiddleware(type, context, ...args) {
    if (!this.middlewares.has(type)) {
      return context;
    }

    const middlewares = this.middlewares.get(type);
    let currentIndex = 0;

    const next = async () => {
      if (currentIndex >= middlewares.length) {
        return context;
      }

      const mw = middlewares[currentIndex++];
      try {
        return await mw.middleware(context, next, ...args);
      } catch (error) {
        console.error(`Middleware "${type}" execution error:`, error);
        this.emit("middleware:error", { type, middleware: mw, error, args });
        throw error;
      }
    };

    const result = await next();
    this.emit("middleware:executed", { type, result, args });
    return result;
  }

  /**
   * Remove middleware
   * @param {string} type - Middleware type
   * @param {Function} middleware - Middleware function
   * @returns {PluginManager} PluginManager instance
   */
  unregisterMiddleware(type, middleware) {
    if (!this.middlewares.has(type)) {
      return this;
    }

    const middlewares = this.middlewares.get(type);
    const index = middlewares.findIndex((m) => m.middleware === middleware);

    if (index !== -1) {
      const removed = middlewares.splice(index, 1);
      this.emit("middleware:unregistered", { type, middleware: removed });
    }

    if (middlewares.length === 0) {
      this.middlewares.delete(type);
    }

    return this;
  }

  /**
   * Load plugin configuration
   * @param {Object} config - Plugin configuration
   * @returns {PluginManager} PluginManager instance
   */
  loadConfig(config) {
    if (!config || typeof config !== "object") {
      return this;
    }

    // Load plugin configuration
    if (config.plugins) {
      for (const [name, pluginConfig] of Object.entries(config.plugins)) {
        if (pluginConfig.enabled !== undefined) {
          const plugin = this.plugins.get(name);
          if (plugin) {
            if (pluginConfig.enabled) {
              this.enable(name);
            } else {
              this.disable(name);
            }
          }
        }

        // Update plugin configuration
        if (pluginConfig.config && this.plugins.has(name)) {
          const plugin = this.plugins.get(name);
          plugin.options.config = {
            ...plugin.options.config,
            ...pluginConfig.config,
          };
        }
      }
    }

    this.emit("config:loaded", { config });
    return this;
  }

  /**
   * Save plugin configuration
   * @returns {Object} Plugin configuration
   */
  saveConfig() {
    const config = {
      plugins: {},
    };

    for (const [name, plugin] of this.plugins) {
      config.plugins[name] = {
        enabled: plugin.options.enabled,
        config: plugin.options.config,
        version: plugin.options.version,
        priority: plugin.options.priority,
      };
    }

    return config;
  }

  /**
   * Hot reload plugin
   * @param {string} name - Plugin name
   * @param {Function} newPluginClass - New plugin class
   * @returns {PluginManager} PluginManager instance
   */
  hotReload(name, newPluginClass) {
    const oldPlugin = this.plugins.get(name);
    if (!oldPlugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    const wasEnabled = oldPlugin.options.enabled;

    // Disable old plugin
    if (wasEnabled) {
      this.disable(name);
    }

    // Unregister old plugin
    this.unregister(name);

    // Register new plugin
    this.register(name, newPluginClass, {
      version: newPluginClass.version || oldPlugin.options.version,
      enabled: wasEnabled,
      priority: oldPlugin.options.priority,
      dependencies: oldPlugin.options.dependencies,
      config: oldPlugin.options.config,
    });

    // Enable new plugin
    if (wasEnabled) {
      this.enable(name);
    }

    this.emit("plugin:reloaded", { name, oldPlugin, newPluginClass });
    return this;
  }

  /**
   * Check plugin dependencies
   * @param {string} name - Plugin name
   * @returns {Object} Dependency check result
   */
  checkDependencies(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return { valid: false, missing: [name], circular: [] };
    }

    const visited = new Set();
    const stack = new Set();
    const missing = [];
    const circular = [];

    const check = (pluginName, path = []) => {
      if (visited.has(pluginName)) {
        return;
      }

      if (stack.has(pluginName)) {
        circular.push([...path, pluginName]);
        return;
      }

      const depPlugin = this.plugins.get(pluginName);
      if (!depPlugin) {
        missing.push(pluginName);
        return;
      }

      stack.add(pluginName);
      path.push(pluginName);

      for (const dep of depPlugin.options.dependencies) {
        check(dep, [...path]);
      }

      stack.delete(pluginName);
      visited.add(pluginName);
    };

    check(name);

    return {
      valid: missing.length === 0 && circular.length === 0,
      missing,
      circular,
      dependencies: plugin.options.dependencies,
    };
  }

  /**
   * Get plugin status
   * @returns {Object} Plugin status
   */
  getStatus() {
    const status = {
      initialized: this.initialized,
      totalPlugins: this.plugins.size,
      enabledPlugins: Array.from(this.plugins.values()).filter(p => p.options.enabled).length,
      registeredMethods: this.methods.size,
      registeredHooks: Array.from(this.hooks.keys()).length,
      registeredMiddlewares: Array.from(this.middlewares.keys()).length,
      plugins: [],
    };

    for (const [name, plugin] of this.plugins) {
      const PluginClass = plugin.class;
      const proto = PluginClass.prototype;
      const methods = [];

      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key !== "constructor" && typeof proto[key] === "function") {
          methods.push(key);
        }
      }

      status.plugins.push({
        name,
        enabled: plugin.options.enabled,
        version: plugin.options.version || "1.0.0",
        priority: plugin.options.priority,
        dependencies: plugin.options.dependencies,
        methods: methods.length,
      });
    }

    return status;
  }

  /**
   * Cleanup plugin system
   */
  cleanup() {
    // Disable all plugins
    for (const [name, plugin] of this.plugins) {
      if (plugin.options.enabled) {
        this.disable(name);
      }
    }

    // Clear all collections
    this.plugins.clear();
    this.pluginInstances.clear();
    this.methods.clear();
    this.hooks.clear();
    this.middlewares.clear();

    this.initialized = false;
    this.emit("cleaned");
  }

  /**
   * Batch register plugins
   * @param {Array} plugins - Array of plugin configurations
   * @returns {PluginManager} PluginManager instance
   */
  registerAll(plugins) {
    if (!Array.isArray(plugins)) {
      throw new Error("Plugins must be an array");
    }

    for (const plugin of plugins) {
      if (!plugin.name || !plugin.class) {
        throw new Error("Plugin must contain name and class properties");
      }

      this.register(plugin.name, plugin.class, plugin.options || {});
    }

    return this;
  }

  /**
   * Get plugins sorted by priority
   * @returns {Array} Sorted plugins list
   */
  getPluginsByPriority() {
    return Array.from(this.plugins.values()).sort(
      (a, b) => b.options.priority - a.options.priority
    );
  }

  /**
   * Get plugin dependency graph
   * @returns {Object} Dependency graph
   */
  getDependencyGraph() {
    const graph = {
      nodes: [],
      edges: [],
    };

    for (const [name, plugin] of this.plugins) {
      graph.nodes.push({
        id: name,
        label: name,
        enabled: plugin.options.enabled,
        version: plugin.options.version || "1.0.0",
      });

      for (const dep of plugin.options.dependencies) {
        graph.edges.push({
          from: name,
          to: dep,
          type: "depends_on",
        });
      }
    }

    return graph;
  }

  /**
   * Validate plugin compatibility
   * @param {Function} PluginClass - Plugin class
   * @returns {Object} Compatibility check result
   */
  validatePlugin(PluginClass) {
    const errors = [];
    const warnings = [];

    // Check required methods
    const requiredMethods = ["_registerMethods"];
    for (const method of requiredMethods) {
      if (typeof PluginClass.prototype[method] !== "function") {
        errors.push(`Missing required method: ${method}`);
      }
    }

    // Check plugin name
    if (!PluginClass.prototype.pluginName || typeof PluginClass.prototype.pluginName !== "string") {
      warnings.push("Plugin should have a unique pluginName property");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// Default export
export default PluginManager;
