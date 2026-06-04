/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/BasePlugin
 */
/**
 * Base Plugin - Provides common functionality for all plugins
 * All plugins should extend this class
 */
export class BasePlugin {
  /**
   * Constructor for BasePlugin
   * @param {Object} queryBuilder - QueryBuilder instance
   */
  constructor(queryBuilder) {
    this.queryBuilder = queryBuilder;
    this.pluginName = this.constructor.name;
    this.initialized = false;
    this.methods = {}; // Store methods to register
    this.hooks = {}; // Store hook callbacks
    this.middlewares = {}; // Store middleware functions
  }

  /**
   * Initialize the plugin
   * This method should be called after plugin instantiation
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    
    // Validate queryBuilder
    if (!this.queryBuilder) {
      throw new Error(`${this.pluginName}: queryBuilder is required but was not provided.`);
    }
    
    this.initialized = true;
    this._registerMethods();
    this._bindMethods();
    this._registerHooks();
    this._registerMiddlewares();
    
  }

  /**
   * Register plugin methods to QueryBuilder
   * This method must be implemented by child classes
   * @protected
   */
  _registerMethods() {
    throw new Error('_registerMethods() must be implemented by plugin');
  }

  /**
   * Bind plugin methods to QueryBuilder instance
   * @protected
   */
  _bindMethods() {
    // Bind methods to QueryBuilder
    Object.entries(this.methods).forEach(([methodName, method]) => {
      if (typeof method === 'function') {
        // Check if method already exists
        if (this.queryBuilder[methodName]) {
          console.warn(`Method ${methodName} already exists in QueryBuilder, overriding with plugin method`);
        }
        // Bind to QueryBuilder instance
        this.queryBuilder[methodName] = method.bind(this);
      }
    });
  }

  /**
   * Register hooks for the plugin
   * Override this method to register hooks
   * @protected
   */
  _registerHooks() {
    // Default implementation - can be overridden by child classes
  }

  /**
   * Register middlewares for the plugin
   * Override this method to register middlewares
   * @protected
   */
  _registerMiddlewares() {
    // Default implementation - can be overridden by child classes
  }

  /**
   * Add method to plugin
   * @param {string} name - Method name
   * @param {Function} method - Method function
   * @returns {BasePlugin} Plugin instance for chaining
   */
  addMethod(name, method) {
    this.methods[name] = method;
    return this;
  }

  /**
   * Remove method from plugin
   * @param {string} name - Method name
   * @returns {BasePlugin} Plugin instance for chaining
   */
  removeMethod(name) {
    delete this.methods[name];
    return this;
  }

  /**
   * Register a hook
   * @param {string} event - Hook event name
   * @param {Function} handler - Hook handler function
   * @param {Object} options - Hook options
   * @param {number} options.priority - Hook priority (higher number = higher priority)
   * @param {boolean} options.once - Whether the hook should run only once
   * @returns {BasePlugin} Plugin instance for chaining
   */
  registerHook(event, handler, options = {}) {
    if (!this.hooks[event]) {
      this.hooks[event] = [];
    }
    
    this.hooks[event].push({
      handler,
      priority: options.priority || 0,
      once: options.once || false,
    });
    
    // Sort hooks by priority (higher priority first)
    this.hooks[event].sort((a, b) => b.priority - a.priority);
    
    return this;
  }

  /**
   * Trigger a hook
   * @param {string} event - Hook event name
   * @param {...any} args - Arguments to pass to hook handlers
   * @returns {Promise<Array>} Results from all hook handlers
   */
  async triggerHook(event, ...args) {
    if (!this.hooks[event]) {
      return [];
    }

    const results = [];
    const hooksToRemove = [];

    for (let i = 0; i < this.hooks[event].length; i++) {
      const hook = this.hooks[event][i];
      try {
        const result = await hook.handler(...args);
        results.push(result);
        
        if (hook.once) {
          hooksToRemove.push(i);
        }
      } catch (error) {
        console.error(`Error in hook "${event}" for plugin "${this.pluginName}":`, error);
        // Continue with other hooks even if one fails
      }
    }

    // Remove once hooks
    if (hooksToRemove.length > 0) {
      for (let i = hooksToRemove.length - 1; i >= 0; i--) {
        this.hooks[event].splice(hooksToRemove[i], 1);
      }
    }

    return results;
  }

  /**
   * Register a middleware
   * @param {string} type - Middleware type
   * @param {Function} middleware - Middleware function
   * @param {Object} options - Middleware options
   * @param {number} options.priority - Middleware priority (higher number = higher priority)
   * @returns {BasePlugin} Plugin instance for chaining
   */
  registerMiddleware(type, middleware, options = {}) {
    if (!this.middlewares[type]) {
      this.middlewares[type] = [];
    }
    
    this.middlewares[type].push({
      middleware,
      priority: options.priority || 0,
    });
    
    // Sort middlewares by priority (higher priority first)
    this.middlewares[type].sort((a, b) => b.priority - a.priority);
    
    return this;
  }

  /**
   * Execute middlewares
   * @param {string} type - Middleware type
   * @param {*} context - Context object
   * @param {...any} args - Additional arguments
   * @returns {Promise<*>} Result after middleware processing
   */
  async executeMiddlewares(type, context, ...args) {
    if (!this.middlewares[type]) {
      return context;
    }

    let index = 0;
    const middlewares = this.middlewares[type];

    const next = async () => {
      if (index >= middlewares.length) {
        return context;
      }

      const mw = middlewares[index++];
      try {
        return await mw.middleware(context, next, ...args);
      } catch (error) {
        console.error(`Error in middleware "${type}" for plugin "${this.pluginName}":`, error);
        throw error;
      }
    };

    return await next();
  }

  /**
   * Cleanup plugin resources
   * This method should be called when plugin is being removed
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Remove bound methods from QueryBuilder
    Object.keys(this.methods).forEach(methodName => {
      if (this.queryBuilder[methodName]) {
        delete this.queryBuilder[methodName];
      }
    });

    // Clear hooks and middlewares
    this.hooks = {};
    this.middlewares = {};
    this.methods = {};
    this.initialized = false;
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: this.pluginName,
      version: '1.0.0',
      description: 'Base plugin class',
      dependencies: [],
      methods: Object.keys(this.methods),
      hooks: Object.keys(this.hooks),
      middlewares: Object.keys(this.middlewares),
    };
  }

  /**
   * Validate plugin configuration
   * @param {Object} config - Plugin configuration
   * @returns {Object} Validation result
   */
  validateConfig(config) {
    const errors = [];
    const warnings = [];

    // Check required methods
    if (typeof this._registerMethods !== 'function') {
      errors.push('Plugin must implement _registerMethods() method');
    }

    // Check plugin name
    if (!this.pluginName || this.pluginName === 'BasePlugin') {
      warnings.push('Plugin should have a unique name');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get plugin configuration
   * @returns {Object} Plugin configuration
   */
  getConfig() {
    return {
      name: this.pluginName,
      enabled: this.initialized,
      methods: Object.keys(this.methods),
      hooks: Object.keys(this.hooks),
      middlewares: Object.keys(this.middlewares),
    };
  }

  /**
   * Check if plugin is initialized
   * @returns {boolean} True if plugin is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get plugin name
   * @returns {string} Plugin name
   */
  getName() {
    return this.pluginName;
  }

  /**
   * Get all registered methods
   * @returns {Array<string>} Array of method names
   */
  getMethods() {
    return Object.keys(this.methods);
  }

  /**
   * Get all registered hooks
   * @returns {Object} Object containing hook events and handlers
   */
  getHooks() {
    return this.hooks;
  }

  /**
   * Get all registered middlewares
   * @returns {Object} Object containing middleware types and handlers
   */
  getMiddlewares() {
    return this.middlewares;
  }

  /**
   * Check if a method exists
   * @param {string} methodName - Method name to check
   * @returns {boolean} True if method exists
   */
  hasMethod(methodName) {
    return this.methods.hasOwnProperty(methodName);
  }

  /**
   * Check if a hook exists for an event
   * @param {string} event - Hook event name
   * @returns {boolean} True if hook exists for the event
   */
  hasHook(event) {
    return this.hooks.hasOwnProperty(event) && this.hooks[event].length > 0;
  }

  /**
   * Check if a middleware exists for a type
   * @param {string} type - Middleware type
   * @returns {boolean} True if middleware exists for the type
   */
  hasMiddleware(type) {
    return this.middlewares.hasOwnProperty(type) && this.middlewares[type].length > 0;
  }

  /**
   * Get QueryBuilder instance
   * @returns {Object} QueryBuilder instance
   */
  getQueryBuilder() {
    return this.queryBuilder;
  }

  /**
   * Set QueryBuilder instance
   * @param {Object} queryBuilder - QueryBuilder instance
   * @returns {BasePlugin} Plugin instance for chaining
   */
  setQueryBuilder(queryBuilder) {
    this.queryBuilder = queryBuilder;
    return this;
  }

  /**
   * Reload plugin
   * This method can be used to reload plugin configuration
   * @returns {Promise<void>}
   */
  async reload() {
    await this.cleanup();
    await this.init();
  }

  /**
   * Get plugin status
   * @returns {Object} Plugin status information
   */
  getStatus() {
    return {
      name: this.pluginName,
      initialized: this.initialized,
      methodsCount: Object.keys(this.methods).length,
      hooksCount: Object.keys(this.hooks).length,
      middlewaresCount: Object.keys(this.middlewares).length,
      queryBuilder: this.queryBuilder ? 'Connected' : 'Not connected'
    };
  }
}
