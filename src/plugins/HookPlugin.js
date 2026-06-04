/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/HoolPlugin
 */
import { BasePlugin } from './BasePlugin.js';

export class HookPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.hooks = {};
    this.validationRules = {};
  }

  /**
   * Register plugin methods to QueryBuilder
   * @protected
   */
  _registerMethods() {
    // Register hook management methods
    this.queryBuilder.addHook = this.addHook.bind(this);
    this.queryBuilder.triggerHook = this.triggerHook.bind(this);
    this.queryBuilder.setValidationRules = this.setValidationRules.bind(this);
    this.queryBuilder.validateData = this.validateData.bind(this);
    
    // Register specific hook shortcuts
    this.queryBuilder.beforeInsert = (callback) => this.addHook('beforeInsert', callback);
    this.queryBuilder.afterInsert = (callback) => this.addHook('afterInsert', callback);
    this.queryBuilder.beforeUpdate = (callback) => this.addHook('beforeUpdate', callback);
    this.queryBuilder.afterUpdate = (callback) => this.addHook('afterUpdate', callback);
    this.queryBuilder.beforeDelete = (callback) => this.addHook('beforeDelete', callback);
    this.queryBuilder.afterDelete = (callback) => this.addHook('afterDelete', callback);
    this.queryBuilder.beforeSelect = (callback) => this.addHook('beforeSelect', callback);
    this.queryBuilder.afterSelect = (callback) => this.addHook('afterSelect', callback);
    this.queryBuilder.onBeforeInsert = (callback) => this.addHook('beforeInsert', callback);
    this.queryBuilder.onAfterInsert = (callback) => this.addHook('afterInsert', callback);
    this.queryBuilder.onBeforeUpdate = (callback) => this.addHook('beforeUpdate', callback);
    this.queryBuilder.onAfterUpdate = (callback) => this.addHook('afterUpdate', callback);
    this.queryBuilder.onBeforeDelete = (callback) => this.addHook('beforeDelete', callback);
    this.queryBuilder.onAfterDelete = (callback) => this.addHook('afterDelete', callback);
    this.queryBuilder.onBeforeSelect = (callback) => this.addHook('beforeSelect', callback);
    this.queryBuilder.onAfterSelect = (callback) => this.addHook('afterSelect', callback);
  }

  /**
   * Add a hook for specific event
   * @param {string} event - Hook event name
   * @param {Function} callback - Hook callback function
   * @returns {QueryBuilder} Query builder instance
   */
  addHook(event, callback) {
    if (!this.hooks[event]) {
      this.hooks[event] = [];
    }
    this.hooks[event].push(callback);
    return this.queryBuilder;
  }

  /**
   * Trigger hooks for specific event
   * @param {string} event - Hook event name
   * @param {*} data - Data to pass to hooks
   * @returns {Promise<void>}
   */
  async triggerHook(event, data) {
    if (!this.hooks[event]) {
      return;
    }

    for (const hook of this.hooks[event]) {
      const result = await hook(data, this.queryBuilder);
      if (result === false) {
        throw new Error(`Hook ${event} returned false, operation cancelled`);
      }
    }
  }

  /**
   * Set validation rules for data
   * @param {Object} rules - Validation rules object
   * @returns {QueryBuilder} Query builder instance
   */
  setValidationRules(rules) {
    this.validationRules = rules;
    return this.queryBuilder;
  }

  /**
   * Validate data against rules
   * @param {Object} data - Data to validate
   * @returns {Array} Array of validation errors
   */
  validateData(data) {
    const errors = [];

    for (const [field, rule] of Object.entries(this.validationRules)) {
      const value = data[field];

      // Check required field
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation if value is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      if (rule.type) {
        const typeCheck = this._validateType(value, rule.type);
        if (!typeCheck.valid) {
          errors.push(`${field} must be ${rule.type}, got ${typeCheck.actual}`);
          continue;
        }
      }

      // Minimum value validation
      if (rule.min !== undefined) {
        if (typeof value === 'number' && value < rule.min) {
          errors.push(`${field} must be at least ${rule.min}`);
        } else if (typeof value === 'string' && value.length < rule.min) {
          errors.push(`${field} must be at least ${rule.min} characters`);
        }
      }

      // Maximum value validation
      if (rule.max !== undefined) {
        if (typeof value === 'number' && value > rule.max) {
          errors.push(`${field} must be at most ${rule.max}`);
        } else if (typeof value === 'string' && value.length > rule.max) {
          errors.push(`${field} must be at most ${rule.max} characters`);
        }
      }

      // Pattern validation
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${field} format is invalid`);
      }

      // Enum validation
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
      }

      // Custom validation function
      if (rule.validate && typeof rule.validate === 'function') {
        const customResult = rule.validate(value, data);
        if (customResult !== true) {
          errors.push(`${field}: ${customResult}`);
        }
      }
    }

    return errors;
  }

  /**
   * Validate data type
   * @private
   */
  _validateType(value, expectedType) {
    const actualType = typeof value;
    
    // Handle special cases
    if (expectedType === 'array' && Array.isArray(value)) {
      return { valid: true, actual: 'array' };
    }
    
    if (expectedType === 'object' && value !== null && !Array.isArray(value) && actualType === 'object') {
      return { valid: true, actual: 'object' };
    }
    
    if (expectedType === 'integer' && Number.isInteger(value)) {
      return { valid: true, actual: 'integer' };
    }
    
    if (expectedType === 'float' && typeof value === 'number' && !Number.isInteger(value)) {
      return { valid: true, actual: 'float' };
    }
    
    if (expectedType === 'date' && value instanceof Date) {
      return { valid: true, actual: 'date' };
    }
    
    if (expectedType === 'email' && typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { valid: true, actual: 'email' };
    }
    
    if (expectedType === 'url' && typeof value === 'string' && /^https?:\/\/[^\s$.?#].[^\s]*$/.test(value)) {
      return { valid: true, actual: 'url' };
    }
    
    return { valid: actualType === expectedType, actual: actualType };
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      ...super.getMetadata(),
      description: 'Hook and validation plugin for QueryBuilder',
      hooks: Object.keys(this.hooks),
      validationRules: Object.keys(this.validationRules)
    };
  }
}
