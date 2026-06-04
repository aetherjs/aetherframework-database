/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/PerformancePlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * Performance Plugin - Provides query analysis, cost estimation, and index usage suggestions
 */
export class PerformancePlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "PerformancePlugin";
  }

  _registerMethods() {
    // Register performance analysis methods to QueryBuilder
    this.queryBuilder.explain = this.explain.bind(this);
    this.queryBuilder.analyze = this.analyze.bind(this);
    this.queryBuilder.getPerformanceMetrics = this.getPerformanceMetrics.bind(this);
    this.queryBuilder.estimateQueryCost = this.estimateQueryCost.bind(this);
    this.queryBuilder.getUsedIndexes = this.getUsedIndexes.bind(this);
    this.queryBuilder.getJoinStrategy = this.getJoinStrategy.bind(this);
    this.queryBuilder.getSortMethod = this.getSortMethod.bind(this);
  }

  /**
   * Explain query execution plan
   * @returns {Promise<Object>} Explain plan
   */
  async explain() {
    const { sql, bindings } = this.queryBuilder.toSQL();
    const explainSql = `EXPLAIN ${sql}`;
    return this.queryBuilder.executeQuery(explainSql, bindings);
  }

  /**
   * Analyze query performance
   * @returns {Promise<Object>} Analysis results
   */
  async analyze() {
    const { sql, bindings } = this.queryBuilder.toSQL();
    const analyzeSql = `ANALYZE ${sql}`;
    return this.queryBuilder.executeQuery(analyzeSql, bindings);
  }

  /**
   * Get query performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const { sql } = this.queryBuilder.toSQL();

    return {
      table: this.queryBuilder.tableName,
      type: this.queryBuilder.query.type,
      estimatedCost: this.estimateQueryCost(),
      indexesUsed: this.getUsedIndexes(),
      joinStrategy: this.getJoinStrategy(),
      sortMethod: this.getSortMethod(),
      filterConditions: this.queryBuilder.query.where.length,
      hasSubqueries: this.queryBuilder.subQueries.size > 0,
      hasAggregations: this.queryBuilder.query.groupBy.length > 0,
      sqlLength: sql.length,
      bindingsCount: this.queryBuilder.bindings.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Estimate query cost
   * @returns {number} Estimated cost
   */
  estimateQueryCost() {
    let cost = 1; // Base cost

    // Add cost for joins
    cost += this.queryBuilder.query.joins.length * 10;

    // Add cost for WHERE conditions
    cost += this.queryBuilder.query.where.length * 2;

    // Add cost for GROUP BY
    cost += this.queryBuilder.query.groupBy.length * 5;

    // Add cost for ORDER BY
    cost += this.queryBuilder.query.orderBy.length * 3;

    // Add cost for subqueries
    cost += this.queryBuilder.subQueries.size * 20;

    // Add cost for UNION
    cost += this.queryBuilder.query.union.length * 15;

    // Add cost for DISTINCT
    if (this.queryBuilder.query.distinct) cost += 5;

    // Add cost for LIMIT/OFFSET
    if (this.queryBuilder.query.limit !== null) cost += 2;
    if (this.queryBuilder.query.offset !== null) cost += 3;

    return cost;
  }

  /**
   * Get used indexes
   * @returns {Array} List of used indexes
   */
  getUsedIndexes() {
    const indexes = new Set();

    // Analyze WHERE condition fields
    this.queryBuilder.query.where.forEach((condition) => {
      if (condition.column && condition.type === "basic") {
        indexes.add(`${this.queryBuilder.tableName}.${condition.column}`);
      }
    });

    // Analyze JOIN condition fields
    this.queryBuilder.query.joins.forEach((join) => {
      if (join.first)
        indexes.add(`${join.table}.${join.first.split(".") || join.first}`);
      if (join.second)
        indexes.add(
          `${this.queryBuilder.tableName}.${join.second.split(".") || join.second}`,
        );
    });

    // Analyze ORDER BY fields
    this.queryBuilder.query.orderBy.forEach((order) => {
      if (order.column && !order.raw) {
        indexes.add(`${this.queryBuilder.tableName}.${order.column}`);
      }
    });

    // Analyze GROUP BY fields
    this.queryBuilder.query.groupBy.forEach((column) => {
      indexes.add(`${this.queryBuilder.tableName}.${column}`);
    });

    return Array.from(indexes);
  }

  /**
   * Get join strategy
   * @returns {Array} Join strategies
   */
  getJoinStrategy() {
    if (this.queryBuilder.query.joins.length === 0) return ["none"];

    return this.queryBuilder.query.joins.map((join) => ({
      type: join.type,
      table: join.table,
      condition: `${join.first} ${join.operator} ${join.second}`,
    }));
  }

  /**
   * Get sort method
   * @returns {Array} Sort methods
   */
  getSortMethod() {
    if (this.queryBuilder.query.orderBy.length === 0) return ["none"];

    return this.queryBuilder.query.orderBy.map((order) => ({
      column: order.raw ? "raw" : order.column,
      direction: order.raw ? "custom" : order.direction,
      usingIndex: this.getUsedIndexes().some((idx) =>
        idx.includes(order.column),
      ),
    }));
  }
}
