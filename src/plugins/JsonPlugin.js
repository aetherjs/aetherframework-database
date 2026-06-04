/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/JsonPlugin
 */
import { BasePlugin } from './BasePlugin.js';

/**
 * Json Plugin - Provides database-agnostic JSON field operations.
 * Translates JSON methods to the appropriate SQL functions for the current dialect.
 */
export class JsonPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
  }

  _registerMethods() {
    // Register JSON methods to QueryBuilder
    this.queryBuilder.whereJsonContains = this.whereJsonContains.bind(this);
    this.queryBuilder.whereJsonLength = this.whereJsonLength.bind(this);
    this.queryBuilder.whereJsonHasKey = this.whereJsonHasKey.bind(this);
    this.queryBuilder.jsonSet = this.jsonSet.bind(this);
    this.queryBuilder.selectJson = this.selectJson.bind(this);
    this.queryBuilder.jsonExtract = this.jsonExtract.bind(this); // 修复：添加 jsonExtract 方法
    this.queryBuilder.jsonInsert = this.jsonInsert.bind(this);
    this.queryBuilder.jsonReplace = this.jsonReplace.bind(this);
    this.queryBuilder.jsonRemove = this.jsonRemove.bind(this);
    this.queryBuilder.jsonMerge = this.jsonMerge.bind(this);
    this.queryBuilder.whereJsonContainsPath = this.whereJsonContainsPath.bind(this);
  }

  /**
   * WHERE clause: Check if a JSON column contains a specific value.
   * @param {string} column - The JSON column name.
   * @param {*} value - The value to check for.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  whereJsonContains(column, value) {
    const wrappedColumn = this.queryBuilder.wrapColumn(column);
    const jsonValue = JSON.stringify(value);

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        this.queryBuilder.whereRaw(`JSON_CONTAINS(${wrappedColumn}, ?)`, [jsonValue]);
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        this.queryBuilder.whereRaw(`${wrappedColumn} @> ?::jsonb`, [jsonValue]);
        break;
      default:
        throw new Error(`JSON_CONTAINS operation not supported for dialect: ${this.queryBuilder.dialect}`);
    }
    return this.queryBuilder;
  }

  /**
   * WHERE clause: Compare the length of a JSON array.
   * @param {string} column - The JSON column name.
   * @param {string} operator - Comparison operator (>, <, =, >=, <=).
   * @param {number} value - The length value to compare against.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  whereJsonLength(column, operator, value) {
    const wrappedColumn = this.queryBuilder.wrapColumn(column);

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        this.queryBuilder.whereRaw(`JSON_LENGTH(${wrappedColumn}) ${operator} ?`, [value]);
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        this.queryBuilder.whereRaw(`jsonb_array_length(${wrappedColumn}) ${operator} ?`, [value]);
        break;
      default:
        throw new Error(`JSON_LENGTH operation not supported for dialect: ${this.queryBuilder.dialect}`);
    }
    return this.queryBuilder;
  }

  /**
   * WHERE clause: Check if a JSON column has a specific key.
   * @param {string} column - The JSON column name.
   * @param {string} key - The key to check for.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  whereJsonHasKey(column, key) {
    const wrappedColumn = this.queryBuilder.wrapColumn(column);

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        this.queryBuilder.whereRaw(`JSON_CONTAINS_PATH(${wrappedColumn}, 'one', ?)`, [`$.${key}`]);
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        this.queryBuilder.whereRaw(`${wrappedColumn} ?? ?`, [key]);
        break;
      default:
        throw new Error(`JSON_HAS_KEY operation not supported for dialect: ${this.queryBuilder.dialect}`);
    }
    return this.queryBuilder;
  }

  /**
   * SET clause: Update a specific path within a JSON column.
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path (e.g., 'user.name').
   * @param {*} value - The value to set at the path.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  jsonSet(column, path, value) {
    if (!this.queryBuilder.query.jsonUpdates) {
      this.queryBuilder.query.jsonUpdates = [];
    }
    this.queryBuilder.query.jsonUpdates.push({ column, path, value, operation: 'set' });
    return this.queryBuilder;
  }

  /**
   * SELECT clause: Extract a value from a JSON column.
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path to extract (e.g., 'user.name').
   * @param {string} alias - Optional alias for the selected value.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  selectJson(column, path, alias = null) {
    const wrappedColumn = this.queryBuilder.wrapColumn(column);
    const jsonPath = `$.${path}`;
    let selectExpr;

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        selectExpr = `JSON_UNQUOTE(JSON_EXTRACT(${wrappedColumn}, ?))`;
        this.queryBuilder.bindings.push(jsonPath);
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        selectExpr = `${wrappedColumn}->>?`;
        this.queryBuilder.bindings.push(path);
        break;
      case 'mssql':
      case 'sqlserver':
        selectExpr = `JSON_VALUE(${wrappedColumn}, ?)`;
        this.queryBuilder.bindings.push(`$${path}`);
        break;
      default:
        throw new Error(`JSON_EXTRACT operation not supported for dialect: ${this.queryBuilder.dialect}`);
    }

    const finalAlias = alias || `${column}_${path.replace(/\./g, '_')}`;
    const finalSelectExpr = `${selectExpr} AS ${finalAlias}`;

    if (this.queryBuilder.query.columns.length === 0 || this.queryBuilder.query.columns === '*') {
      this.queryBuilder.query.columns = [finalSelectExpr];
    } else {
      this.queryBuilder.query.columns.push(finalSelectExpr);
    }

    return this.queryBuilder;
  }

  /**
   * Extract a value from a JSON column (alias for selectJson)
   * @param {string} column - The JSON column name
   * @param {string} path - The JSON path to extract
   * @param {string} [alias] - Optional alias for the extracted value
   * @returns {QueryBuilder} The QueryBuilder instance for chaining
   */
  jsonExtract(column, path, alias = null) {
    // 直接调用 selectJson 方法，因为功能相同
    return this.selectJson(column, path, alias);
  }

  /**
   * WHERE clause: Check if a JSON column contains a specific path.
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path to check (e.g., 'user.address.city').
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  whereJsonContainsPath(column, path) {
    const wrappedColumn = this.queryBuilder.wrapColumn(column);
    const jsonPath = `$.${path}`;

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        this.queryBuilder.whereRaw(`JSON_CONTAINS_PATH(${wrappedColumn}, 'one', ?)`, [jsonPath]);
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        this.queryBuilder.whereRaw(`${wrappedColumn} ?? ?`, [path]);
        break;
      default:
        throw new Error(`JSON_CONTAINS_PATH operation not supported for dialect: ${this.queryBuilder.dialect}`);
    }
    return this.queryBuilder;
  }

  // --- The following methods would require modifying the SQL building process ---
  // They are registered but their implementation would need to integrate with
  // the QueryBuilder's `toSQL()` or `buildUpdateSQL()` methods.

  /**
   * JSON_INSERT operation (insert if path does not exist).
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path.
   * @param {*} value - The value to insert.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  jsonInsert(column, path, value) {
    if (!this.queryBuilder.query.jsonUpdates) {
      this.queryBuilder.query.jsonUpdates = [];
    }
    this.queryBuilder.query.jsonUpdates.push({ column, path, value, operation: 'json_insert' });
    return this.queryBuilder;
  }

  /**
   * JSON_REPLACE operation (replace if path exists).
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path.
   * @param {*} value - The value to replace with.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  jsonReplace(column, path, value) {
    if (!this.queryBuilder.query.jsonUpdates) {
      this.queryBuilder.query.jsonUpdates = [];
    }
    this.queryBuilder.query.jsonUpdates.push({ column, path, value, operation: 'json_replace' });
    return this.queryBuilder;
  }

  /**
   * JSON_REMOVE operation.
   * @param {string} column - The JSON column name.
   * @param {string} path - The JSON path to remove.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  jsonRemove(column, path) {
    if (!this.queryBuilder.query.jsonUpdates) {
      this.queryBuilder.query.jsonUpdates = [];
    }
    this.queryBuilder.query.jsonUpdates.push({ column, path, operation: 'json_remove' });
    return this.queryBuilder;
  }

  /**
   * JSON_MERGE operation (merge two JSON documents).
   * @param {string} column - The JSON column name.
   * @param {Object|Array} value - The JSON value to merge.
   * @returns {QueryBuilder} The QueryBuilder instance for chaining.
   */
  jsonMerge(column, value) {
    if (!this.queryBuilder.query.jsonUpdates) {
      this.queryBuilder.query.jsonUpdates = [];
    }
    this.queryBuilder.query.jsonUpdates.push({ column, value, operation: 'json_merge' });
    return this.queryBuilder;
  }

  /**
   * Helper method to be called by QueryBuilder when building UPDATE SQL for JSON operations.
   * This should be integrated into the main QueryBuilder's `buildUpdateSQL` method.
   * @private
   */
  _buildJsonUpdateClause() {
    if (!this.queryBuilder.query.jsonUpdates || this.queryBuilder.query.jsonUpdates.length === 0) {
      return '';
    }

    const updates = [];
    this.queryBuilder.query.jsonUpdates.forEach(update => {
      const wrappedColumn = this.queryBuilder.wrapColumn(update.column);
      const jsonPath = `$.${update.path}`;
      const placeholder = '?';

      switch (update.operation) {
        case 'set':
          // This is the most common operation, syntax varies by DB
          switch (this.queryBuilder.dialect) {
            case 'mysql':
            case 'mariadb':
              updates.push(`${wrappedColumn} = JSON_SET(${wrappedColumn}, ?, ?)`);
              this.queryBuilder.bindings.push(jsonPath, JSON.stringify(update.value));
              break;
            case 'postgresql':
            case 'postgres':
            case 'pg':
            case 'cockroachdb':
              updates.push(`${wrappedColumn} = jsonb_set(${wrappedColumn}, ?, ?)`);
              this.queryBuilder.bindings.push(`{${update.path.split('.').join(',')}}`, JSON.stringify(update.value));
              break;
          }
          break;
        case 'json_insert':
        case 'json_replace':
        case 'json_remove':
        case 'json_merge':
          // Implementations for these would follow similar patterns
          // For brevity, they are omitted here but would be added in a full implementation.
          console.warn(`JSON operation '${update.operation}' not fully implemented in plugin example.`);
          break;
      }
    });

    return updates.join(', ');
  }

  /**
   * Returns the plugin's capabilities for the current dialect.
   * @returns {Object} An object describing supported JSON features.
   */
  getCapabilities() {
    const capabilities = {
      jsonContains: false,
      jsonLength: false,
      jsonHasKey: false,
      jsonSet: false,
      jsonExtract: false
    };

    switch (this.queryBuilder.dialect) {
      case 'mysql':
      case 'mariadb':
        capabilities.jsonContains = true;
        capabilities.jsonLength = true;
        capabilities.jsonHasKey = true;
        capabilities.jsonSet = true;
        capabilities.jsonExtract = true;
        break;
      case 'postgresql':
      case 'postgres':
      case 'pg':
      case 'cockroachdb':
        capabilities.jsonContains = true;
        capabilities.jsonLength = true;
        capabilities.jsonHasKey = true;
        capabilities.jsonSet = true;
        capabilities.jsonExtract = true;
        break;
      case 'mssql':
      case 'sqlserver':
        capabilities.jsonContains = false; // Limited support
        capabilities.jsonLength = false;
        capabilities.jsonHasKey = false;
        capabilities.jsonSet = true; // Via JSON_MODIFY
        capabilities.jsonExtract = true; // Via JSON_VALUE
        break;
    }
    return capabilities;
  }
}
