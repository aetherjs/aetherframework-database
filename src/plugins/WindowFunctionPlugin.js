/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/WindowFunctionPlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * 窗口函数插件 - 提供标准 SQL 窗口函数的链式调用支持
 */
export class WindowFunctionPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "WindowFunctionPlugin";
  }

  _registerMethods() {
    // 注册窗口函数方法到 QueryBuilder
    this.queryBuilder.windowFrame = this.windowFrame.bind(this);
    this.queryBuilder.ntile = this.ntile.bind(this);
    this.queryBuilder.partitionBy = this.partitionBy.bind(this);
    this.queryBuilder.over = this.over.bind(this);
    this.queryBuilder.rowNumber = this.rowNumber.bind(this);
    this.queryBuilder.rank = this.rank.bind(this);
    this.queryBuilder.denseRank = this.denseRank.bind(this);
    this.queryBuilder.lead = this.lead.bind(this);
    this.queryBuilder.lag = this.lag.bind(this);
    this.queryBuilder.firstValue = this.firstValue.bind(this);
    this.queryBuilder.lastValue = this.lastValue.bind(this);
    this.queryBuilder.nthValue = this.nthValue.bind(this);
    this.queryBuilder.cumeDist = this.cumeDist.bind(this);
    this.queryBuilder.percentRank = this.percentRank.bind(this);
  }

  /**
   * 定义窗口框架
   * @param {Object} frame - 窗口框架配置
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  windowFrame(frame) {
    if (!this.queryBuilder.query.window) {
      this.queryBuilder.query.window = {};
    }
    this.queryBuilder.query.window.frame = frame;
    return this.queryBuilder;
  }

  /**
   * NTILE 窗口函数
   * @param {number} buckets - 桶数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  ntile(buckets, alias = "ntile", windowName = null) {
    return this.over("NTILE", [buckets], windowName, alias);
  }

  /**
   * 窗口分区
   * @param {...string} columns - 分区列
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  partitionBy(...columns) {
    if (!this.queryBuilder.query.window) {
      this.queryBuilder.query.window = {};
    }
    this.queryBuilder.query.window.partitionBy = columns;
    return this.queryBuilder;
  }

  /**
   * 应用窗口函数
   * @param {string} functionName - 窗口函数名
   * @param {Array} args - 函数参数
   * @param {string} windowName - 窗口名称
   * @param {string} alias - 列别名
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  over(functionName, args = [], windowName = null, alias = null) {
    const argsStr =
      args.length > 0
        ? args.map((arg) => this.queryBuilder.wrapColumn(arg)).join(", ")
        : "*";
    
    const windowClause = windowName ? `OVER (${windowName})` : "OVER ()";
    const selectExpr = `${functionName}(${argsStr}) ${windowClause}`;

    if (alias) {
      this.queryBuilder.query.columns.push(`${selectExpr} as ${alias}`);
    } else {
      this.queryBuilder.query.columns.push(selectExpr);
    }

    return this.queryBuilder;
  }

  /**
   * 行号窗口函数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  rowNumber(alias = "row_number", windowName = null) {
    return this.over("ROW_NUMBER", [], windowName, alias);
  }

  /**
   * 排名窗口函数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  rank(alias = "rank", windowName = null) {
    return this.over("RANK", [], windowName, alias);
  }

  /**
   * 密集排名窗口函数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  denseRank(alias = "dense_rank", windowName = null) {
    return this.over("DENSE_RANK", [], windowName, alias);
  }

  /**
   * LEAD 窗口函数
   * @param {string} column - 列名
   * @param {number} offset - 偏移量（默认：1）
   * @param {*} defaultValue - 默认值
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  lead(column, offset = 1, defaultValue = null, alias = null, windowName = null) {
    const args = [this.queryBuilder.wrapColumn(column), offset];
    if (defaultValue !== null) {
      args.push(defaultValue);
    }

    const finalAlias = alias || `lead_${column}`;
    return this.over("LEAD", args, windowName, finalAlias);
  }

  /**
   * LAG 窗口函数
   * @param {string} column - 列名
   * @param {number} offset - 偏移量（默认：1）
   * @param {*} defaultValue - 默认值
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  lag(column, offset = 1, defaultValue = null, alias = null, windowName = null) {
    const args = [this.queryBuilder.wrapColumn(column), offset];
    if (defaultValue !== null) {
      args.push(defaultValue);
    }

    const finalAlias = alias || `lag_${column}`;
    return this.over("LAG", args, windowName, finalAlias);
  }

  /**
   * FIRST_VALUE 窗口函数
   * @param {string} column - 列名
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  firstValue(column, alias = null, windowName = null) {
    const finalAlias = alias || `first_value_${column}`;
    return this.over(
      "FIRST_VALUE",
      [this.queryBuilder.wrapColumn(column)],
      windowName,
      finalAlias
    );
  }

  /**
   * LAST_VALUE 窗口函数
   * @param {string} column - 列名
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  lastValue(column, alias = null, windowName = null) {
    const finalAlias = alias || `last_value_${column}`;
    return this.over(
      "LAST_VALUE",
      [this.queryBuilder.wrapColumn(column)],
      windowName,
      finalAlias
    );
  }

  /**
   * NTH_VALUE 窗口函数
   * @param {string} column - 列名
   * @param {number} n - 第 N 个值
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  nthValue(column, n, alias = null, windowName = null) {
    const finalAlias = alias || `nth_value_${column}_${n}`;
    return this.over(
      "NTH_VALUE",
      [this.queryBuilder.wrapColumn(column), n],
      windowName,
      finalAlias
    );
  }

  /**
   * 累积分布窗口函数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  cumeDist(alias = "cume_dist", windowName = null) {
    return this.over("CUME_DIST", [], windowName, alias);
  }

  /**
   * 百分比排名窗口函数
   * @param {string} alias - 列别名
   * @param {string} windowName - 窗口名称
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  percentRank(alias = "percent_rank", windowName = null) {
    return this.over("PERCENT_RANK", [], windowName, alias);
  }

  /**
   * 构建窗口函数 SQL
   * @param {Object} windowConfig - 窗口配置
   * @returns {string} SQL 片段
   */
  buildWindowSQL(windowConfig) {
    if (!windowConfig) return "";

    const parts = [];

    if (windowConfig.partitionBy && windowConfig.partitionBy.length > 0) {
      const partitionColumns = windowConfig.partitionBy
        .map((col) => this.queryBuilder.wrapColumn(col))
        .join(", ");
      parts.push(`PARTITION BY ${partitionColumns}`);
    }

    if (windowConfig.orderBy && windowConfig.orderBy.length > 0) {
      const orderColumns = windowConfig.orderBy
        .map((order) => {
          if (typeof order === "object" && order.raw) {
            return order.raw;
          }
          return `${this.queryBuilder.wrapColumn(order.column)} ${order.direction}`;
        })
        .join(", ");
      parts.push(`ORDER BY ${orderColumns}`);
    }

    if (windowConfig.frame) {
      parts.push(this.buildWindowFrameSQL(windowConfig.frame));
    }

    return parts.length > 0 ? `(${parts.join(" ")})` : "()";
  }

  /**
   * 构建窗口框架 SQL
   * @param {Object} frame - 窗口框架配置
   * @returns {string} SQL 片段
   */
  buildWindowFrameSQL(frame) {
    if (!frame) return "";

    const { type = "ROWS", start, end } = frame;
    let frameStr = `${type}`;

    if (start) {
      frameStr += ` ${this.buildWindowFrameBound(start)}`;
      if (end) {
        frameStr += ` AND ${this.buildWindowFrameBound(end)}`;
      }
    }

    return frameStr;
  }

  /**
   * 构建窗口框架边界
   * @param {Object|string} bound - 边界配置
   * @returns {string} SQL 片段
   */
  buildWindowFrameBound(bound) {
    if (typeof bound === "string") {
      return bound;
    }

    if (bound.type === "PRECEDING") {
      return `${bound.value} PRECEDING`;
    } else if (bound.type === "FOLLOWING") {
      return `${bound.value} FOLLOWING`;
    } else if (bound.type === "CURRENT_ROW") {
      return "CURRENT ROW";
    } else if (bound.type === "UNBOUNDED") {
      return "UNBOUNDED PRECEDING";
    }

    return "CURRENT ROW";
  }

  /**
   * 获取支持的窗口函数列表
   * @returns {Array} 支持的窗口函数
   */
  getSupportedFunctions() {
    return [
      "ROW_NUMBER",
      "RANK",
      "DENSE_RANK",
      "NTILE",
      "LEAD",
      "LAG",
      "FIRST_VALUE",
      "LAST_VALUE",
      "NTH_VALUE",
      "CUME_DIST",
      "PERCENT_RANK",
      "AVG",
      "SUM",
      "COUNT",
      "MIN",
      "MAX",
    ];
  }
}
