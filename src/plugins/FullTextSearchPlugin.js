/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/FullTextSearchPlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * 全文搜索插件 - 封装不同数据库的全文搜索语法
 */
export class FullTextSearchPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "FullTextSearchPlugin";
  }

  _registerMethods() {
    // 注册全文搜索方法到 QueryBuilder
    this.queryBuilder.fullTextSearch = this.fullTextSearch.bind(this);
    this.queryBuilder.orderByRelevance = this.orderByRelevance.bind(this);
    this.queryBuilder.matchAgainst = this.matchAgainst.bind(this);
    this.queryBuilder.fullTextBoolean = this.fullTextBoolean.bind(this);
    this.queryBuilder.fullTextQueryExpansion = this.fullTextQueryExpansion.bind(this);
  }

  /**
   * 全文搜索
   * @param {string|Array} columns - 要搜索的列
   * @param {string} searchTerm - 搜索词
   * @param {string} mode - 搜索模式 (natural, boolean)
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  fullTextSearch(columns, searchTerm, mode = "natural") {
    this.queryBuilder.query.fullTextSearch = {
      columns: Array.isArray(columns) ? columns : [columns],
      searchTerm,
      mode: mode.toLowerCase(),
    };
    return this.queryBuilder;
  }

  /**
   * 按相关性排序（全文搜索）
   * @param {string|Array} columns - 用于相关性的列
   * @param {string} searchTerm - 搜索词
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  orderByRelevance(columns, searchTerm) {
    this.queryBuilder.query.orderByRelevance = { columns, searchTerm };
    return this.queryBuilder;
  }

  /**
   * 使用 MATCH AGAINST 进行全文搜索
   * @param {string|Array} columns - 要搜索的列
   * @param {string} searchTerm - 搜索词
   * @param {string} mode - 搜索模式 (natural, boolean, query expansion)
   * @param {boolean} withQueryExpansion - 是否使用查询扩展
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  matchAgainst(columns, searchTerm, mode = "natural", withQueryExpansion = false) {
    const columnList = Array.isArray(columns)
      ? columns.map((col) => this.queryBuilder.wrapColumn(col)).join(", ")
      : this.queryBuilder.wrapColumn(columns);

    let modeClause = "";
    if (mode === "boolean") {
      modeClause = "IN BOOLEAN MODE";
    } else if (mode === "query expansion" || withQueryExpansion) {
      modeClause = "WITH QUERY EXPANSION";
    }

    this.queryBuilder.query.where.push({
      type: "fulltext",
      raw: `MATCH(${columnList}) AGAINST(? ${modeClause})`,
      boolean: "and",
    });

    this.queryBuilder.bindings.push(searchTerm);
    return this.queryBuilder;
  }

  /**
   * 布尔模式全文搜索
   * @param {string|Array} columns - 要搜索的列
   * @param {string} searchTerm - 带有布尔运算符的搜索词
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  fullTextBoolean(columns, searchTerm) {
    return this.matchAgainst(columns, searchTerm, "boolean");
  }

  /**
   * 查询扩展全文搜索
   * @param {string|Array} columns - 要搜索的列
   * @param {string} searchTerm - 搜索词
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  fullTextQueryExpansion(columns, searchTerm) {
    return this.matchAgainst(columns, searchTerm, "query expansion", true);
  }

  /**
   * 构建全文搜索 SQL
   * @param {Object} fullTextSearch - 全文搜索配置
   * @returns {string} SQL 片段
   */
  buildFullTextSearchSQL(fullTextSearch) {
    const { columns, searchTerm, mode } = fullTextSearch;
    const columnList = Array.isArray(columns)
      ? columns.map((col) => this.queryBuilder.wrapColumn(col)).join(", ")
      : this.queryBuilder.wrapColumn(columns);

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      let modeClause = "";
      if (mode === "boolean") {
        modeClause = "IN BOOLEAN MODE";
      } else if (mode === "query expansion") {
        modeClause = "WITH QUERY EXPANSION";
      }

      return `MATCH(${columnList}) AGAINST(? ${modeClause})`;
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      const searchVector = Array.isArray(columns)
        ? columns.map((col) => `to_tsvector(${col})`).join(" || ")
        : `to_tsvector(${this.queryBuilder.wrapColumn(columns)})`;

      return `${searchVector} @@ plainto_tsquery(?)`;
    } else {
      // 对于不支持全文搜索的数据库，使用 LIKE 模式
      const columnArray = Array.isArray(columns) ? columns : [columns];
      const likeConditions = columnArray.map((col) => {
        return `${this.queryBuilder.wrapColumn(col)} LIKE ?`;
      });

      return `(${likeConditions.join(" OR ")})`;
    }
  }

  /**
   * 构建相关性排序 SQL
   * @param {Object} orderByRelevance - 相关性排序配置
   * @returns {string} SQL 片段
   */
  buildOrderByRelevanceSQL(orderByRelevance) {
    const { columns, searchTerm } = orderByRelevance;
    const columnList = Array.isArray(columns)
      ? columns.map((col) => this.queryBuilder.wrapColumn(col)).join(", ")
      : this.queryBuilder.wrapColumn(columns);

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      return `MATCH(${columnList}) AGAINST(?) DESC`;
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      const searchVector = Array.isArray(columns)
        ? columns.map((col) => `to_tsvector(${col})`).join(" || ")
        : `to_tsvector(${this.queryBuilder.wrapColumn(columns)})`;

      return `ts_rank(${searchVector}, plainto_tsquery(?)) DESC`;
    } else {
      return null; // 不支持相关性排序
    }
  }
}
