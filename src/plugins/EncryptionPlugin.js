/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/EncryptionPlugin
 */
import crypto from 'crypto';
import { BasePlugin } from './BasePlugin.js';

/**
 * Encryption Plugin - Provides data encryption/decryption functionality
 * Supports AES-256-GCM encryption for sensitive fields
 */
export class EncryptionPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.encryptionKey = null;
    this.encryptedFields = new Set();
    this.encryptionAlgorithm = 'aes-256-gcm';
  }

  _registerMethods() {
    // Register encryption methods to QueryBuilder
    this.queryBuilder.setEncryptionKey = this.setEncryptionKey.bind(this);
    this.queryBuilder.encryptField = this.encryptField.bind(this);
    this.queryBuilder.encryptData = this.encryptData.bind(this);
    this.queryBuilder.decryptData = this.decryptData.bind(this);
    this.queryBuilder.isEncryptionEnabled = this.isEncryptionEnabled.bind(this);
  }

  /**
   * Set encryption key
   * @param {string|Buffer} key - Encryption key (32 bytes for AES-256)
   * @returns {QueryBuilder} Query builder instance
   */
  setEncryptionKey(key) {
    if (typeof key === 'string') {
      // Ensure key is 32 bytes for AES-256
      const keyBuffer = Buffer.from(key, 'utf8');
      if (keyBuffer.length !== 32) {
        throw new Error('Encryption key must be 32 bytes for AES-256');
      }
      this.encryptionKey = keyBuffer;
    } else if (Buffer.isBuffer(key)) {
      if (key.length !== 32) {
        throw new Error('Encryption key must be 32 bytes for AES-256');
      }
      this.encryptionKey = key;
    } else {
      throw new Error('Encryption key must be a string or Buffer');
    }
    
    // Add encryption hooks
    this._addEncryptionHooks();
    return this.queryBuilder;
  }

  /**
   * Mark field for encryption
   * @param {string} fieldName - Field name to encrypt
   * @returns {QueryBuilder} Query builder instance
   */
  encryptField(fieldName) {
    this.encryptedFields.add(fieldName);
    return this.queryBuilder;
  }

  /**
   * Encrypt data before insertion/update
   * @param {Object} data - Data to encrypt
   * @returns {Object} Encrypted data
   */
  encryptData(data) {
    if (!this.encryptionKey || this.encryptedFields.size === 0) {
      return data;
    }

    const encrypted = { ...data };

    for (const field of this.encryptedFields) {
      if (encrypted[field] !== undefined && encrypted[field] !== null) {
        try {
          const iv = crypto.randomBytes(16);
          const cipher = crypto.createCipheriv(
            this.encryptionAlgorithm,
            this.encryptionKey,
            iv
          );

          let encryptedText = cipher.update(
            String(encrypted[field]),
            'utf8',
            'hex'
          );
          encryptedText += cipher.final('hex');
          const authTag = cipher.getAuthTag();

          // Store format: iv:authTag:encryptedText
          encrypted[field] = 
            `${iv.toString('hex')}:${authTag.toString('hex')}:${encryptedText}`;
        } catch (error) {
          console.error(`Failed to encrypt field ${field}:`, error.message);
          throw new Error(`Encryption failed for field ${field}`);
        }
      }
    }

    return encrypted;
  }

  /**
   * Decrypt data after retrieval
   * @param {Object} data - Data to decrypt
   * @returns {Object} Decrypted data
   */
  decryptData(data) {
    if (!this.encryptionKey || this.encryptedFields.size === 0) {
      return data;
    }

    const decrypted = { ...data };

    for (const field of this.encryptedFields) {
      if (decrypted[field] && decrypted[field].includes(':')) {
        try {
          const [ivHex, authTagHex, encryptedText] = decrypted[field].split(':');
          const iv = Buffer.from(ivHex, 'hex');
          const authTag = Buffer.from(authTagHex, 'hex');
          
          const decipher = crypto.createDecipheriv(
            this.encryptionAlgorithm,
            this.encryptionKey,
            iv
          );
          decipher.setAuthTag(authTag);

          let decryptedText = decipher.update(encryptedText, 'hex', 'utf8');
          decryptedText += decipher.final('utf8');

          decrypted[field] = decryptedText;
        } catch (error) {
          console.warn(`Failed to decrypt field ${field}:`, error.message);
          decrypted[field] = null;
        }
      }
    }

    return decrypted;
  }

  /**
   * Check if encryption is enabled
   * @returns {boolean} True if encryption is enabled
   */
  isEncryptionEnabled() {
    return this.encryptionKey !== null && this.encryptedFields.size > 0;
  }

  /**
   * Add encryption hooks to QueryBuilder
   * @private
   */
  _addEncryptionHooks() {
    // Hook for encrypting data before insert/update
    this.queryBuilder.addHook('beforeInsert', async (data) => {
      return this.encryptData(data);
    });

    this.queryBuilder.addHook('beforeUpdate', async (data) => {
      return this.encryptData(data);
    });

    // Hook for decrypting data after select
    this.queryBuilder.addHook('afterSelect', async (result) => {
      if (Array.isArray(result)) {
        return result.map(row => this.decryptData(row));
      } else if (result && typeof result === 'object') {
        return this.decryptData(result);
      }
      return result;
    });
  }

  /**
   * Generate encryption key
   * @param {number} length - Key length in bytes (default: 32)
   * @returns {Buffer} Generated key
   */
  static generateKey(length = 32) {
    return crypto.randomBytes(length);
  }

  /**
   * Get plugin metadata
   * @returns {Object} Plugin metadata
   */
  getMetadata() {
    return {
      name: 'EncryptionPlugin',
      version: '1.0.0',
      description: 'Provides AES-256-GCM encryption for sensitive data fields',
      dependencies: ['crypto'],
      features: [
        'Field-level encryption',
        'AES-256-GCM algorithm',
        'Automatic encryption/decryption hooks',
        'Key management'
      ]
    };
  }
}
