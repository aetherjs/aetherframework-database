/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/ResiliencePlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * Resilience Plugin - Provides query retry, timeout control, and transaction management
 */
export class ResiliencePlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "ResiliencePlugin";
  }

  _registerMethods() {
    // Register resilience methods to QueryBuilder
    this.queryBuilder.executeWithRetry = this.executeWithRetry.bind(this);
    this.queryBuilder.isRetryableError = this.isRetryableError.bind(this);
    this.queryBuilder.executeWithTimeout = this.executeWithTimeout.bind(this);
    this.queryBuilder.executeInTransaction = this.executeInTransaction.bind(this);
  }

  /**
   * Execute query with retry logic
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} retryDelay - Delay between retries in milliseconds
   * @returns {Promise<Object>} Query result
   */
  async executeWithRetry(maxRetries = 3, retryDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.queryBuilder.execute();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error) || attempt === maxRetries) {
          throw error;
        }



        // Wait before retrying
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * attempt),
        );
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if error is retryable
   */
  isRetryableError(error) {
    const retryableMessages = [
      "deadlock",
      "timeout",
      "connection",
      "lock",
      "busy",
      "try again",
      "retry",
      "temporary",
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some((msg) => errorMessage.includes(msg));
  }

  /**
   * Execute query with timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Query result
   */
  async executeWithTimeout(timeout = 30000) {
    return Promise.race([
      this.queryBuilder.execute(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Query timeout after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  }

  /**
   * Execute query with transaction
   * @param {Function} callback - Transaction callback
   * @returns {Promise<Object>} Transaction result
   */
  async executeInTransaction(callback) {
    try {
      await this.queryBuilder.connection.beginTransaction();

      const result = await callback(this.queryBuilder);

      await this.queryBuilder.connection.commit();
      return result;
    } catch (error) {
      await this.queryBuilder.connection.rollback();
      throw error;
    }
  }
}
