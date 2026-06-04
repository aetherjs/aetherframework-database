/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/GrapthQLPlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * GraphQL Plugin - Provides GraphQL-style field selection and relation loading
 */
export class GraphQLPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "GraphQLPlugin";
    this.graphqlFields = null;
  }

  _registerMethods() {
    // Register GraphQL-style methods to QueryBuilder
    this.queryBuilder.selectFields = this.selectFields.bind(this);
    this.queryBuilder.extractGraphQLFields = this.extractGraphQLFields.bind(this);
    this.queryBuilder.with = this.with.bind(this);
    this.queryBuilder.executeWithRelations = this.executeWithRelations.bind(this);
    this.queryBuilder.loadRelation = this.loadRelation.bind(this);
  }

  /**
   * GraphQL-style field selection
   * @param {string|Array|Object} fields - Fields to select
   * @returns {QueryBuilder} Query builder instance
   */
  selectFields(fields) {
    if (typeof fields === "string") {
      // Comma-separated string
      this.queryBuilder.query.columns = fields.split(",").map((f) => f.trim());
    } else if (Array.isArray(fields)) {
      // Array of fields
      this.queryBuilder.query.columns = fields;
    } else if (typeof fields === "object") {
      // GraphQL-style object with nested fields
      this.graphqlFields = fields;
      this.queryBuilder.query.columns = this.extractGraphQLFields(fields);
    }
    return this.queryBuilder;
  }

  /**
   * Extract fields from GraphQL-style selection
   * @param {Object} fields - GraphQL fields object
   * @param {string} prefix - Field prefix
   * @returns {Array} Extracted fields
   */
  extractGraphQLFields(fields, prefix = "") {
    const extracted = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === true || value === 1) {
        // Simple field
        extracted.push(prefix ? `${prefix}.${key}` : key);
      } else if (typeof value === "object") {
        // Nested field or sub-query
        if (value.fields) {
          // Sub-query with fields
          const subFields = this.extractGraphQLFields(value.fields, key);
          extracted.push(...subFields);
        } else {
          // Nested object
          const nestedFields = this.extractGraphQLFields(value, key);
          extracted.push(...nestedFields);
        }
      }
    }

    return extracted;
  }

  /**
   * Include related data (eager loading)
   * @param {string|Object} relations - Relations to include
   * @returns {QueryBuilder} Query builder instance
   */
  with(relations) {
    if (typeof relations === "string") {
      this.queryBuilder.query.with = [relations];
    } else if (Array.isArray(relations)) {
      this.queryBuilder.query.with = relations;
    } else if (typeof relations === "object") {
      this.queryBuilder.query.with = Object.keys(relations);
      this.graphqlFields = relations;
    }
    return this.queryBuilder;
  }

  /**
   * Execute query with GraphQL-style field selection
   * @returns {Promise<Object>} Query result with nested relations
   */
  async executeWithRelations() {
    const result = await this.queryBuilder.execute();

    if (!this.queryBuilder.query.with || !result.rows || result.rows.length === 0) {
      return result;
    }

    // Load relations for each row
    for (const relation of this.queryBuilder.query.with) {
      await this.loadRelation(result.rows, relation);
    }

    return result;
  }

  /**
   * Load relation for rows
   * @param {Array} rows - Parent rows
   * @param {string} relation - Relation name
   * @returns {Promise<void>}
   */
  async loadRelation(rows, relation) {
    const relationConfig = this.graphqlFields?.[relation];
    if (!relationConfig) return;

    // Extract parent IDs
    const parentIds = rows.map((row) => row.id).filter((id) => id);
    if (parentIds.length === 0) return;

    // Build relation query
    const relationQuery = new this.queryBuilder.constructor(
      relation,
      this.queryBuilder.connection,
      this.queryBuilder.dialect,
    );

    // Apply GraphQL field selection if specified
    if (relationConfig.fields) {
      relationQuery.selectFields(relationConfig.fields);
    }

    // Add WHERE condition for relation
    const foreignKey =
      relationConfig.foreignKey || `${this.queryBuilder.tableName.slice(0, -1)}_id`;
    const relatedRows = await relationQuery
      .whereIn(foreignKey, parentIds)
      .get();

    // Group related rows by foreign key
    const relatedByParent = {};
    relatedRows.forEach((row) => {
      const parentId = row[foreignKey];
      if (!relatedByParent[parentId]) {
        relatedByParent[parentId] = [];
      }
      relatedByParent[parentId].push(row);
    });

    // Attach related rows to parent rows
    rows.forEach((row) => {
      row[relation] = relatedByParent[row.id] || [];
    });
  }
}
