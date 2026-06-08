/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/QueryBuilder
 */

import { EventEmitter } from "events";

/**
 * Core Query Builder - Provides fluent interface for building SQL queries
 * Supports multiple database dialects with clean, focused API
 */
class QueryBuilder extends EventEmitter {
  /**
   * Create a new QueryBuilder instance
   * @param {string} tableName - Table name
   * @param {Object} connection - Database connection
   * @param {string} dialect - Database dialect (mysql, postgresql, sqlite, etc.)
   */
  constructor(tableName, connection, dialect = "mysql") {
    super();

    this.dialect = dialect.toLowerCase();
    this.tableName = tableName;
    this.connection = connection;

    // Supported database dialects
    const supportedDialects = [
      "mysql",
      "mariadb",
      "postgresql",
      "postgres",
      "pg",
      "sqlite",
      "sqlite3",
      "mssql",
      "sqlserver",
      "oracle",
      "cockroachdb",
      "cockroach",
      "clickhouse",
    ];

    if (!supportedDialects.includes(this.dialect)) {
      throw new Error(`Unsupported database dialect: ${this.dialect}`);
    }

    // Initialize dialect adapter
    this.adapter = new DialectAdapter(this.dialect);

    // Initialize query structure
    this.query = {
      type: "select",
      columns: ["*"],
      where: [],
      orderBy: [],
      limit: null,
      offset: null,
      joins: [],
      groupBy: [],
      having: [],
      distinct: false,
      lock: null,
      data: null,
      returning: null,
      union: [],
      with: [],
      cte: [],
    };

    this.bindings = [];
    this.paramIndex = 1;
    this.subQueries = new Map();
  }

  // ==================== CORE CHAINING METHODS ====================

  /**
   * Select columns
   * @param {...string} columns - Columns to select
   * @returns {QueryBuilder} Query builder instance
   */
  select(...columns) {
    if (columns.length === 0) {
      this.query.columns = ["*"];
    } else {
      this.query.columns = columns.flat();
    }
    return this;
  }

  /**
   * Add WHERE condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {*} value - Value to compare
   * @returns {QueryBuilder} Query builder instance
   */
  where(column, operatorOrValue, value) {
    let operator = operatorOrValue;
    let val = value;

    if (arguments.length === 2) {
      val = operatorOrValue;
      operator = "=";
    }

    this.query.where.push({
      column,
      operator,
      value: val,
      boolean: "and",
      type: "basic",
    });

    if (val !== undefined && val !== null) {
      this.bindings.push(val);
    }
    return this;
  }

  /**
   * Add OR WHERE condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {*} value - Value to compare
   * @returns {QueryBuilder} Query builder instance
   */
  orWhere(column, operator, value) {
    this.query.where.push({
      column,
      operator,
      value,
      boolean: "or",
    });

    if (value !== undefined && value !== null) {
      this.bindings.push(value);
    }

    return this;
  }

  /**
   * Add WHERE NULL condition
   * @param {string} column - Column name
   * @returns {QueryBuilder} Query builder instance
   */
  whereNull(column) {
    this.query.where.push({
      column,
      operator: "IS",
      value: null,
      boolean: "and",
      type: "null",
    });
    return this;
  }

  /**
   * Add WHERE NOT NULL condition
   * @param {string} column - Column name
   * @returns {QueryBuilder} Query builder instance
   */
  whereNotNull(column) {
    this.query.where.push({
      column,
      operator: "IS NOT",
      value: null,
      boolean: "and",
      type: "notnull",
    });
    return this;
  }

  /**
   * Add WHERE IN condition
   * @param {string} column - Column name
   * @param {Array} values - Array of values
   * @returns {QueryBuilder} Query builder instance
   */
  whereIn(column, values) {
    this.query.where.push({
      column,
      operator: "IN",
      value: values,
      boolean: "and",
      type: "in",
    });
    this.bindings.push(...values);
    return this;
  }

  /**
   * Add WHERE NOT IN condition
   * @param {string} column - Column name
   * @param {Array} values - Array of values
   * @returns {QueryBuilder} Query builder instance
   */
  whereNotIn(column, values) {
    this.query.where.push({
      column,
      operator: "NOT IN",
      value: values,
      boolean: "and",
      type: "notin",
    });
    this.bindings.push(...values);
    return this;
  }

  /**
   * Add WHERE BETWEEN condition
   * @param {string} column - Column name
   * @param {Array} values - Array with [min, max] values
   * @param {string} boolean - Boolean operator (and, or)
   * @param {boolean} not - Whether to use NOT BETWEEN
   * @returns {QueryBuilder} Query builder instance
   */
  whereBetween(column, values, boolean = "and", not = false) {
    if (!Array.isArray(values) || values.length !== 2) {
      throw new Error("whereBetween requires an array with exactly two values");
    }

    this.query.where.push({
      type: "between",
      column,
      values,
      boolean,
      not,
    });

    this.bindings.push(...values);
    return this;
  }

  /**
   * Add WHERE LIKE condition
   * @param {string} column - Column name
   * @param {string} pattern - LIKE pattern
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereLike(column, pattern, boolean = "and") {
    this.query.where.push({
      column,
      operator: "LIKE",
      value: pattern,
      boolean,
    });
    this.bindings.push(pattern);
    return this;
  }

  /**
   * Add raw WHERE condition
   * @param {string} sql - Raw SQL condition
   * @param {Array} bindings - Bindings for raw SQL
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereRaw(sql, bindings = [], boolean = "and") {
    this.query.where.push({
      raw: sql,
      boolean,
    });
    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add ORDER BY clause
   * @param {string|Object|Array} column - Column name or ordering object
   * @param {string} direction - Sort direction (ASC, DESC)
   * @returns {QueryBuilder} Query builder instance
   */
  orderBy(column, direction = "ASC") {
    if (!this.query.orderBy) this.query.orderBy = [];

    // Support orderBy({ age: 'desc', name: 'asc' })
    if (
      typeof column === "object" &&
      column !== null &&
      !Array.isArray(column)
    ) {
      Object.entries(column).forEach(([col, dir]) => {
        this.orderBy(col, dir);
      });
      return this;
    }

    // Support orderBy(['age', 'name'])
    if (Array.isArray(column)) {
      column.forEach((item) => this.orderBy(item));
      return this;
    }

    // Support orderBy({column: 'age', direction: 'desc'})
    if (typeof column === "object" && column.column) {
      const dir = (column.direction || direction).toUpperCase();
      this.query.orderBy.push({
        column: column.column,
        direction: ["ASC", "DESC"].includes(dir) ? dir : "ASC",
      });
      return this;
    }

    // Regular call: orderBy('age', 'desc')
    if (typeof column === "string") {
      const dir = String(direction).toUpperCase();
      this.query.orderBy.push({
        column,
        direction: ["ASC", "DESC"].includes(dir) ? dir : "ASC",
      });
    }

    return this;
  }

  /**
   * Add raw ORDER BY clause
   * @param {string} sql - Raw SQL ORDER BY expression
   * @param {Array} bindings - Bindings for raw SQL
   * @returns {QueryBuilder} Query builder instance
   */
  orderByRaw(sql, bindings = []) {
    if (!this.query.orderBy) this.query.orderBy = [];
    this.query.orderBy.push({ raw: sql });
    if (bindings.length > 0) this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add LIMIT clause
   * @param {number} value - Limit value
   * @returns {QueryBuilder} Query builder instance
   */
  limit(value) {
    this.query.limit = value;
    return this;
  }

  /**
   * Add OFFSET clause
   * @param {number} value - Offset value
   * @returns {QueryBuilder} Query builder instance
   */
  offset(value) {
    this.query.offset = value;
    return this;
  }

  /**
   * Add DISTINCT clause
   * @returns {QueryBuilder} Query builder instance
   */
  distinct() {
    this.query.distinct = true;
    return this;
  }

  /**
   * Add GROUP BY clause
   * @param {...string} columns - Columns to group by
   * @returns {QueryBuilder} Query builder instance
   */
  groupBy(...columns) {
    this.query.groupBy.push(...columns);
    return this;
  }

  /**
   * Add HAVING condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {*} value - Value to compare
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  having(column, operator, value, boolean = "and") {
    this.query.having.push({
      column,
      operator,
      value,
      boolean,
    });

    if (value !== undefined && value !== null) {
      this.bindings.push(value);
    }

    return this;
  }

  // ==================== JOIN METHODS ====================

  /**
   * Join tables
   * @param {string} table - Table to join
   * @param {string} first - First column
   * @param {string} operator - Comparison operator
   * @param {string} second - Second column
   * @param {string} type - Join type (inner, left, right, cross)
   * @returns {QueryBuilder} Query builder instance
   */
  join(table, first, operator, second, type = "inner") {
    this.query.joins.push({
      type,
      table,
      first,
      operator,
      second,
    });
    return this;
  }

  /**
   * Left join tables
   * @param {string} table - Table to join
   * @param {string} first - First column
   * @param {string} operator - Comparison operator
   * @param {string} second - Second column
   * @returns {QueryBuilder} Query builder instance
   */
  leftJoin(table, first, operator, second) {
    return this.join(table, first, operator, second, "left");
  }

  /**
   * Right join tables
   * @param {string} table - Table to join
   * @param {string} first - First column
   * @param {string} operator - Comparison operator
   * @param {string} second - Second column
   * @returns {QueryBuilder} Query builder instance
   */
  rightJoin(table, first, operator, second) {
    return this.join(table, first, operator, second, "right");
  }

  /**
   * Cross join tables
   * @param {string} table - Table to join
   * @returns {QueryBuilder} Query builder instance
   */
  crossJoin(table) {
    return this.join(table, null, null, null, "cross");
  }

  // ==================== CRUD OPERATIONS ====================

  /**
   * Set query type to INSERT
   * @param {Object|Array} data - Data to insert
   * @returns {QueryBuilder} Query builder instance
   */
  insert(data) {
    this.query.type = "insert";
    this.query.data = null;
    this.query.isBatch = false;

    if (Array.isArray(data)) {
      if (data.length === 0) {
        throw new Error("Batch insert data array cannot be empty");
      }
      this.query.data = data;
      this.query.isBatch = true;
    } else if (typeof data === "object" && data !== null) {
      this.query.data = [data];
      this.query.isBatch = false;
    } else {
      throw new Error(
        "insert() method must accept an object or array of objects",
      );
    }

    return this;
  }

  /**
   * Set query type to UPDATE
   * @param {Object} data - Data to update
   * @returns {QueryBuilder} Query builder instance
   */
  update(data) {
    this.query.type = "update";
    this.query.data = data;
    return this;
  }

  // ==================== AGGREGATE FUNCTIONS ====================

  /**
   * Count rows
   * @param {string} column - Column to count (default: '*')
   * @param {string} alias - Column alias
   * @returns {QueryBuilder} Query builder instance
   */
  count(column = "*", alias = null) {
    const countExpr = `COUNT(${column === "*" ? "*" : this.wrapColumn(column)})`;
    const selectExpr = alias ? `${countExpr} as ${alias}` : countExpr;

    if (this.query.columns.length === 1 && this.query.columns === "*") {
      this.query.columns = [selectExpr];
    } else {
      this.query.columns.push(selectExpr);
    }

    return this;
  }

  /**
   * Sum of column values
   * @param {string} column - Column to sum
   * @param {string} alias - Column alias
   * @returns {QueryBuilder} Query builder instance
   */
  sum(column, alias = null) {
    const sumExpr = `SUM(${this.wrapColumn(column)})`;
    const selectExpr = alias ? `${sumExpr} as ${alias}` : sumExpr;

    if (this.query.columns.length === 1 && this.query.columns === "*") {
      this.query.columns = [selectExpr];
    } else {
      this.query.columns.push(selectExpr);
    }

    return this;
  }

  /**
   * Average of column values
   * @param {string} column - Column to average
   * @param {string} alias - Column alias
   * @returns {QueryBuilder} Query builder instance
   */
  avg(column, alias = null) {
    const avgExpr = `AVG(${this.wrapColumn(column)})`;
    const selectExpr = alias ? `${avgExpr} as ${alias}` : avgExpr;

    if (this.query.columns.length === 1 && this.query.columns === "*") {
      this.query.columns = [selectExpr];
    } else {
      this.query.columns.push(selectExpr);
    }

    return this;
  }

  /**
   * Minimum value of column
   * @param {string} column - Column to get minimum
   * @param {string} alias - Column alias
   * @returns {QueryBuilder} Query builder instance
   */
  min(column, alias = null) {
    const minExpr = `MIN(${this.wrapColumn(column)})`;
    const selectExpr = alias ? `${minExpr} as ${alias}` : minExpr;

    if (this.query.columns.length === 1 && this.query.columns === "*") {
      this.query.columns = [selectExpr];
    } else {
      this.query.columns.push(selectExpr);
    }

    return this;
  }

  /**
   * Maximum value of column
   * @param {string} column - Column to get maximum
   * @param {string} alias - Column alias
   * @returns {QueryBuilder} Query builder instance
   */
  max(column, alias = null) {
    const maxExpr = `MAX(${this.wrapColumn(column)})`;
    const selectExpr = alias ? `${maxExpr} as ${alias}` : maxExpr;

    if (this.query.columns.length === 1 && this.query.columns === "*") {
      this.query.columns = [selectExpr];
    } else {
      this.query.columns.push(selectExpr);
    }

    return this;
  }

  // ==================== EXECUTION METHODS ====================

  /**
   * Execute the query
   * @returns {Promise<Object>} Query result
   */
  async execute() {
    const { sql, bindings } = this.toSQL();
    return this.executeQuery(sql, bindings);
  }

  /**
   * Execute SELECT query and get all results
   * @returns {Promise<Array>} Query results
   */
  async get() {
    this.query.type = "select";
    const result = await this.execute();
    return result.rows || result || [];
  }

  /**
   * Execute SELECT query and get first result
   * @returns {Promise<Object|null>} First result or null
   */
  async first() {
    this.query.type = "select";
    this.limit(1);
    const result = await this.execute();

    // 修复语法：正确处理数组和对象格式的结果
    if (Array.isArray(result)) {
      return result.length > 0 ? result : null;
    } else if (result && result.rows) {
      return result.rows.length > 0 ? result.rows : null;
    } else if (result && Array.isArray(result)) {
      return result.length > 0 ? result : null;
    }
    return null;
  }

  /**
   * Execute COUNT query
   * @returns {Promise<number>} Count result
   */
  async count() {
    this.query.type = "select";
    this.query.columns = ["COUNT(*) as count"];
    const result = await this.execute();

    // 修复语法：正确处理不同的结果格式
    let count = 0;

    if (result && result.rows && result.rows.length > 0) {
      // 格式：{ rows: [{ count: 5 }] }
      count = result.rows.count;
    } else if (result && Array.isArray(result) && result.length > 0) {
      // 格式：[{ count: 5 }]
      count = result.count;
    } else if (result && result.count !== undefined) {
      // 格式：{ count: 5 }
      count = result.count;
    }

    return parseInt(count) || 0;
  }

  /**
   * Check if record exists
   * @returns {Promise<boolean>} True if exists
   */
  async exists() {
    this.query.type = "select";
    this.query.columns = ["1 as exists"];
    this.query.limit = 1;
    const result = await this.execute();
    return (result.rows?.length || result.length) > 0;
  }

  // ==================== SQL BUILDING METHODS ====================

  /**
   * Generate SQL and bindings
   * @returns {Object} SQL and bindings
   */
  toSQL() {
    let sql = "";
    const originalBindings = [...this.bindings];
    this.bindings = [];

    switch (this.query.type) {
      case "select":
        sql = this.buildSelectSQL();
        break;
      case "insert":
        sql = this.buildInsertSQL();
        break;
      case "update":
        sql = this.buildUpdateSQL();
        break;
      case "delete":
        sql = this.buildDeleteSQL();
        break;
      default:
        throw new Error(`Unsupported query type: ${this.query.type}`);
    }

    const result = { sql, bindings: [...this.bindings] };
    this.bindings = originalBindings;
    return result;
  }

  /**
   * Build SELECT SQL with dialect-specific optimizations
   * @returns {string} SELECT SQL
   */
  buildSelectSQL() {
    const columns = this.query.columns
      .map((col) =>
        typeof col === "object" && col.raw ? col.raw : this.wrapColumn(col),
      )
      .join(", ");

    let sql = `SELECT ${this.query.distinct ? "DISTINCT " : ""}${columns} FROM ${this.wrapTable(this.tableName)}`;

    // Add JOIN clause
    if (this.query.joins.length > 0) {
      sql += this.buildJoinClause();
    }

    // Add WHERE clause
    if (this.query.where.length > 0) {
      const whereClause = this.buildWhereClause();
      sql += ` WHERE ${whereClause}`;
    }

    // Add GROUP BY clause
    if (this.query.groupBy.length > 0) {
      sql += this.buildGroupByClause();
    }

    // Add HAVING clause
    if (this.query.having.length > 0) {
      sql += this.buildHavingClause();
    }

    // Add ORDER BY clause
    if (this.query.orderBy.length > 0) {
      const orderByClause = this.query.orderBy
        .map((order) =>
          typeof order === "object" && order.raw
            ? order.raw
            : `${this.wrapColumn(order.column)} ${order.direction}`,
        )
        .join(", ");
      sql += ` ORDER BY ${orderByClause}`;
    }

    // Add LIMIT and OFFSET with dialect-specific syntax
    if (this.query.limit !== null || this.query.offset !== null) {
      sql += this.buildLimitOffset(this.query.limit, this.query.offset);
    }

    // Add LOCK clause if specified
    if (this.query.lock) {
      sql += ` ${this.query.lock}`;
    }

    return sql;
  }

  /**
   * Build INSERT SQL with flexible batch insert support
   * @returns {string} INSERT SQL
   */
  buildInsertSQL() {
    if (
      !this.query.data ||
      !Array.isArray(this.query.data) ||
      this.query.data.length === 0
    ) {
      throw new Error("No data to insert");
    }

    const data = this.query.data;
    const isBatch = data.length > 1;

    if (isBatch) {
      return this._buildBatchInsertSQL(data);
    } else {
      return this._buildSingleInsertSQL(data[0]);
    }
  }

  /**
   * Build SQL for single row insert (optimized)
   * @param {Object} row - Single row data
   * @returns {string} INSERT SQL
   * @private
   */
  _buildSingleInsertSQL(row) {
    const columns = Object.keys(row);
    const columnString = columns.map((col) => this.wrapColumn(col)).join(", ");
    const placeholders = columns.map(() => "?").join(", ");

    this.bindings = Object.values(row);

    return `INSERT INTO ${this.wrapTable(this.tableName)} (${columnString}) VALUES (${placeholders})`;
  }

  /**
   * Build SQL for batch insert (optimized)
   * @param {Array} rows - Array of row data
   * @returns {string} Batch INSERT SQL
   * @private
   */
  _buildBatchInsertSQL(rows) {
    const firstRow = rows[0];
    const columns = Object.keys(firstRow);
    const columnString = columns.map((col) => this.wrapColumn(col)).join(", ");

    const placeholderTemplate = `(${columns.map(() => "?").join(", ")})`;

    const placeholders = [];
    this.bindings = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      placeholders.push(placeholderTemplate);

      // 按列顺序添加绑定值
      for (const col of columns) {
        this.bindings.push(row[col] !== undefined ? row[col] : null);
      }
    }

    return `INSERT INTO ${this.wrapTable(this.tableName)} (${columnString}) VALUES ${placeholders.join(", ")}`;
  }

  /**
   * Build UPDATE SQL with dialect-specific features
   * @returns {string} UPDATE SQL
   */
  buildUpdateSQL() {
    if (!this.query.data) {
      throw new Error("No data to update");
    }

    const setParts = Object.keys(this.query.data).map(
      (col) => `${this.wrapColumn(col)} = ?`,
    );
    const setValues = Object.values(this.query.data);

    const originalWhereBindings = [...this.bindings];
    this.bindings = [];

    let whereClause = "";
    if (this.query.where && this.query.where.length > 0) {
      whereClause = this.buildWhereClause();
    }

    const whereBindings = [...this.bindings];
    this.bindings = [...setValues, ...whereBindings];

    let sql = `UPDATE ${this.wrapTable(this.tableName)} SET ${setParts.join(", ")}`;
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }

    // Add RETURNING clause for supported databases
    if (this.query.returning && this.supportsReturning()) {
      const returningColumns = this.query.returning
        .map((col) => this.wrapColumn(col))
        .join(", ");
      sql += ` RETURNING ${returningColumns}`;
    }

    return sql;
  }

  /**
   * Set the query type to 'delete'.
   * This initiates the construction of a DELETE statement.
   * @returns {QueryBuilder} The current QueryBuilder instance for chaining.
   */
  delete() {
    this.query.type = "delete";
    return this;
  }

  /**
   * Force delete without triggering warnings for missing WHERE clauses.
   * Use with caution as it can lead to accidental full table deletes.
   * @returns {QueryBuilder} The current QueryBuilder instance for chaining.
   */
  forceDelete() {
    this.query.type = "delete";
    this.query.skipWhereWarning = true;
    return this;
  }

  /**
   * Prepare a delete operation for a batch of IDs.
   * Automatically handles large arrays by splitting them into batches if necessary.
   * @param {string} column - The column name to match against (usually 'id').
   * @param {Array} values - An array of values to delete.
   * @param {number} batchSize - The size of each batch for large arrays (default: 100).
   * @returns {QueryBuilder} The current QueryBuilder instance for chaining.
   */
  deleteInBatch(column, values, batchSize = 100) {
    this.query.type = "delete";
    // Reuse the optimized whereIn logic which handles batching automatically
    return this.whereIn(column, values, batchSize);
  }

  /**
   * Specify an index hint for the DELETE operation.
   * This can significantly improve performance by forcing the database to use a specific index.
   * @param {string} indexName - The name of the index to use.
   * @returns {QueryBuilder} The current QueryBuilder instance for chaining.
   */
  useIndex(indexName) {
    this.query.useIndex = indexName;
    return this;
  }

  /**
   * Build DELETE SQL with dialect-specific features
   * @returns {string} DELETE SQL
   */
  buildDeleteSQL() {
    // Reset bindings for the new query construction
    this.bindings = [];

    // Start building the base DELETE statement
    let sql = `DELETE FROM ${this.wrapTable(this.tableName)}`;

    // Apply index hint if specified
    if (this.query.useIndex) {
      if (this.dialect === "mysql" || this.dialect === "mariadb") {
        sql += ` USE INDEX (${this.query.useIndex})`;
      } else if (
        this.dialect === "postgresql" ||
        this.dialect === "postgres" ||
        this.dialect === "pg"
      ) {
        // PostgreSQL uses different syntax or planner hints
        sql += ` /*+ Index(${this.tableName} ${this.query.useIndex}) */`;
      } else if (this.dialect === "mssql" || this.dialect === "sqlserver") {
        sql += ` WITH (INDEX(${this.query.useIndex}))`;
      }
    }

    // Append WHERE clause if conditions exist
    if (this.query.where.length > 0) {
      sql += ` WHERE ${this.buildWhereClause()}`;
    } else if (!this.query.skipWhereWarning) {
      // 优化：只在开发环境显示警告
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[Warning] Executing DELETE without WHERE clause. Use forceDelete() to suppress this warning.",
        );
      }
    }

    // Add database-specific optimization hints
    if (this.dialect === "mysql" || this.dialect === "mariadb") {
      // Hint to MySQL to prioritize this delete operation
      sql += " /*+ DELETE_PRIORITY(HIGH) */";
    } else if (
      this.dialect === "postgresql" ||
      this.dialect === "postgres" ||
      this.dialect === "pg"
    ) {
      // Hint for PostgreSQL query planner
      sql += " /*+ IndexScan */";
    }

    // Add RETURNING clause for supported databases
    if (this.query.returning && this.supportsReturning()) {
      const returningColumns = this.query.returning
        .map((col) => this.wrapColumn(col))
        .join(", ");
      sql += ` RETURNING ${returningColumns}`;
    }

    return sql;
  }

  /**
   * Execute query with performance monitoring
   * @returns {Promise<Object>} Query result with performance metrics
   */
  async executeWithPerformance() {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    try {
      const result = await this.execute();

      const endTime = Date.now();
      const endMemory = process.memoryUsage();

      const performance = {
        duration: endTime - startTime,
        memory: {
          rss: endMemory.rss - startMemory.rss,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        },
        queryType: this.query.type,
        rowsAffected: result.affectedRows || result.rowCount || 0,
        timestamp: new Date().toISOString(),
      };

      // 记录慢查询
      if (performance.duration > 100) {
        // 超过100ms视为慢查询
        console.warn(`Slow query detected: ${performance.duration}ms`, {
          sql: this.toSQL().sql,
          ...performance,
        });
      }

      return {
        result,
        performance,
      };
    } catch (error) {
      const endTime = Date.now();
      console.error(
        `Query failed after ${endTime - startTime}ms:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Optimize query based on performance analysis
   * @returns {QueryBuilder} Optimized query builder
   */
  optimize() {
    const metrics = this.getPerformanceMetrics();

    if (metrics.needsOptimization) {

      // 自动优化建议
      if (this.query.type === "select" && this.query.columns.includes("*")) {
        console.warn(
          "Consider specifying columns instead of using SELECT *",
        );
      }

      if (this.query.where.length > 10) {
        console.warn("Consider adding indexes for WHERE conditions");
      }

      if (this.query.joins.length > 3) {
        console.warn("Multiple JOINs detected, ensure proper indexes exist");
      }
    }

    return this;
  }

  /**
   * Execute the DELETE query with performance monitoring.
   * Logs duration, memory usage, and affected rows.
   * Warns if the operation takes longer than 1 second.
   * @returns {Promise<Object>} The result of the execution including performance metrics.
   */
  async deleteWithMonitoring() {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    try {
      // Execute the actual query
      const result = await this.execute();

      const endTime = Date.now();
      const endMemory = process.memoryUsage();

      // Calculate performance metrics
      const performance = {
        duration: endTime - startTime,
        memoryDiff: {
          rss: endMemory.rss - startMemory.rss,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        },
        rowsAffected: result.affectedRows || 0,
      };

      // Warn if the operation is slow
      if (performance.duration > 1000) {
        console.warn(
          "DELETE operation took over 1 second. Consider optimizing indexes or using batch deletion.",
        );
      }

      return { result, performance };
    } catch (error) {
      console.error("DELETE Execution Failed:", error);
      throw error;
    }
  }

  /**
   * Smart Delete: Automatically decides between single execution and batch deletion.
   * Analyzes the estimated row count and switches to batch mode if the threshold is exceeded.
   * @param {Object} options - Configuration options for batch deletion.
   * @param {number} options.batchSize - Number of rows to delete per batch (default: 1000).
   * @param {number} options.delay - Delay in ms between batches to reduce lock contention (default: 100).
   * @param {boolean} options.useTransaction - Whether to wrap each batch in a transaction (default: true).
   * @param {number} options.threshold - Row count threshold to trigger batch mode (default: 1000).
   * @returns {Promise<Object>} Result of the deletion operation.
   */
  async smartDelete(options = {}) {
    const {
      batchSize = 1000,
      delay = 100,
      useTransaction = true,
      threshold = 1000,
    } = options;

    // Estimate the number of rows to be deleted
    const plan = await this.getExecutionPlan();

    // If estimated rows exceed threshold, use batch deletion
    if (plan.metrics.estimatedRows > threshold) {
      return this.deleteInBatches(batchSize, delay, useTransaction);
    }

    // Otherwise, execute as a single standard delete
    return this.execute();
  }

  /**
   * Delete records in batches to prevent locking issues and high memory usage.
   * @param {number} batchSize - Number of rows to delete per batch.
   * @param {number} delay - Delay in milliseconds between batches.
   * @param {boolean} useTransaction - Whether to use transactions for each batch.
   * @returns {Promise<Object>} Summary of the deletion process.
   */
  async deleteInBatches(batchSize = 1000, delay = 100, useTransaction = true) {
    // Clone the current query to get the total count without modifying the original builder
    const countQuery = this.clone();
    countQuery.query.columns = ["COUNT(*) as total"];
    // Clear order by and limit for accurate counting
    countQuery.query.orderBy = [];
    countQuery.query.limit = null;

    const countResult = await countQuery.first();
    const total = parseInt(countResult.total);

    let deleted = 0;
    const primaryKey = this.getPrimaryKeyColumn(); // Assumes a method exists to get PK

    while (deleted < total) {
      // Create a batch query
      const batchQuery = this.clone()
        .limit(batchSize)
        .orderBy(primaryKey, "ASC");

      // Execute the batch
      if (useTransaction) {
        await batchQuery.executeInTransaction();
      } else {
        await batchQuery.execute();
      }

      deleted += batchSize;

      // Optional delay to reduce database load and lock contention
      if (deleted < total) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { total, deleted };
  }

  /**
   * Build WHERE clause
   * @returns {string} WHERE clause
   */
  buildWhereClause() {
    const whereBindings = [];

    const whereClause = this.query.where
      .map((condition, index) => {
        if (condition.raw) {
          return condition.raw;
        }

        const prefix = index > 0 ? `${condition.boolean.toUpperCase()} ` : "";

        if (condition.type === "null" || condition.type === "notnull") {
          return `${prefix}${this.wrapColumn(condition.column)} ${condition.operator} NULL`;
        }

        if (condition.type === "in" || condition.type === "notin") {
          const placeholders = condition.value.map(() => "?").join(", ");
          whereBindings.push(...condition.value);
          return `${prefix}${this.wrapColumn(condition.column)} ${condition.operator} (${placeholders})`;
        }

        if (condition.type === "between") {
          const operator = condition.not ? "NOT BETWEEN" : "BETWEEN";
          whereBindings.push(...condition.values);
          return `${prefix}${this.wrapColumn(condition.column)} ${operator} ? AND ?`;
        }

        whereBindings.push(condition.value);
        return `${prefix}${this.wrapColumn(condition.column)} ${condition.operator} ?`;
      })
      .join(" ");

    this.bindings.push(...whereBindings);
    return whereClause;
  }

  /**
   * Build JOIN clause
   * @returns {string} JOIN clause
   */
  buildJoinClause() {
    const joinClauses = this.query.joins.map((join) => {
      if (join.type === "cross") {
        return `CROSS JOIN ${this.wrapTable(join.table)}`;
      }
      return `${join.type.toUpperCase()} JOIN ${this.wrapTable(join.table)} ON ${this.wrapColumn(join.first)} ${join.operator} ${this.wrapColumn(join.second)}`;
    });

    return " " + joinClauses.join(" ");
  }

  /**
   * Build GROUP BY clause
   * @returns {string} GROUP BY clause
   */
  buildGroupByClause() {
    const groupByClause = this.query.groupBy
      .map((item) =>
        typeof item === "object" && item.raw ? item.raw : this.wrapColumn(item),
      )
      .join(", ");

    return ` GROUP BY ${groupByClause}`;
  }

  /**
   * Build HAVING clause
   * @returns {string} HAVING clause
   */
  buildHavingClause() {
    const havingConditions = this.query.having.map((condition) => {
      if (condition.raw) {
        return condition.raw;
      }
      if (condition.value === null) {
        return `${condition.column} ${condition.operator} NULL`;
      }
      return `${condition.column} ${condition.operator} ?`;
    });

    return ` HAVING ${havingConditions.join(" AND ")}`;
  }

  // ==================== HELPER METHODS ====================
  /**
   * Wrap column name for SQL using dialect adapter
   * @param {string} column - Column name
   * @returns {string} Wrapped column name
   */
  wrapColumn(column) {
    if (
      column.includes("(") ||
      column.includes(")") ||
      column.includes(" as ") ||
      column.toLowerCase().includes("distinct") ||
      column.includes("*")
    ) {
      return column;
    }

    if (column.includes(".")) {
      return column
        .split(".")
        .map((part) => {
          if (part === "*") return "*";
          return this.adapter.quoteIdentifier(part);
        })
        .join(".");
    }

    return this.adapter.quoteIdentifier(column);
  }

  /**
   * Wrap table name for SQL using dialect adapter
   * @param {string} table - Table name
   * @returns {string} Wrapped table name
   */
  wrapTable(table) {
    if (table.includes(".")) {
      return table
        .split(".")
        .map((part) => this.adapter.quoteIdentifier(part))
        .join(".");
    }

    return this.adapter.quoteIdentifier(table);
  }

  /**
   * Quote identifier using dialect adapter
   * @param {string} identifier - Identifier to quote
   * @returns {string} Quoted identifier
   */
  quoteIdentifier(identifier) {
    return this.adapter.quoteIdentifier(identifier);
  }

  /**
   * Execute query and return results in random order using dialect-specific random function
   * @returns {Promise<Array>} Randomly ordered results
   */
  async inRandomOrder() {
    this.orderByRaw(this.adapter.getRandomFunction());
    return this.get();
  }

  /**
   * Get the appropriate closing quote character for the current dialect
   * @returns {string} Closing quote character
   */
  getQuoteEndChar() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
      case "clickhouse":
        return "`";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
      case "sqlite":
      case "sqlite3":
      case "oracle":
        return '"';
      case "mssql":
      case "sqlserver":
        return "]";
      default:
        return "";
    }
  }

  /**
   * Check if an identifier needs quoting
   * @param {string} identifier - Identifier to check
   * @returns {boolean} True if quoting is needed
   */
  needsQuoting(identifier) {
    // Check for reserved keywords
    const keywords = this.getReservedKeywords();
    const upperIdentifier = identifier.toUpperCase();

    // Check for special characters or spaces
    if (/[^a-zA-Z0-9_]/.test(identifier)) {
      return true;
    }

    // Check if it's a reserved keyword
    if (keywords.includes(upperIdentifier)) {
      return true;
    }

    // Check if it starts with a number
    if (/^\d/.test(identifier)) {
      return true;
    }

    return false;
  }

  /**
   * Get reserved keywords for the current dialect
   * @returns {string[]} Array of reserved keywords
   */
  getReservedKeywords() {
    // Common SQL reserved words
    const commonKeywords = [
      "SELECT",
      "FROM",
      "WHERE",
      "INSERT",
      "UPDATE",
      "DELETE",
      "CREATE",
      "DROP",
      "ALTER",
      "TABLE",
      "INDEX",
      "VIEW",
      "JOIN",
      "LEFT",
      "RIGHT",
      "INNER",
      "OUTER",
      "GROUP",
      "BY",
      "ORDER",
      "HAVING",
      "LIMIT",
      "OFFSET",
      "UNION",
      "ALL",
      "DISTINCT",
      "AS",
      "ON",
      "AND",
      "OR",
      "NOT",
      "NULL",
      "IS",
      "IN",
      "BETWEEN",
      "LIKE",
      "EXISTS",
    ];

    // Dialect-specific reserved words
    const dialectKeywords = {
      mysql: ["AUTO_INCREMENT", "ENGINE", "CHARSET", "COLLATE", "RAND"],
      mariadb: ["AUTO_INCREMENT", "ENGINE", "CHARSET", "COLLATE", "RAND"],
      postgresql: ["SERIAL", "BIGSERIAL", "RETURNING", "ILIKE", "RANDOM"],
      postgres: ["SERIAL", "BIGSERIAL", "RETURNING", "ILIKE", "RANDOM"],
      pg: ["SERIAL", "BIGSERIAL", "RETURNING", "ILIKE", "RANDOM"],
      sqlite: ["AUTOINCREMENT", "TEMPORARY", "RANDOM"],
      sqlite3: ["AUTOINCREMENT", "TEMPORARY", "RANDOM"],
      mssql: ["IDENTITY", "TOP", "OUTPUT", "WITH"],
      sqlserver: ["IDENTITY", "TOP", "OUTPUT", "WITH"],
      oracle: ["SEQUENCE", "DUAL", "ROWNUM", "SYSDATE"],
      cockroachdb: ["RETURNING", "RANDOM"],
      cockroach: ["RETURNING", "RANDOM"],
      clickhouse: ["ENGINE", "ORDER BY", "PRIMARY KEY"],
    };

    return [...commonKeywords, ...(dialectKeywords[this.dialect] || [])];
  }

  /**
   * Safely escape identifier to prevent SQL injection
   * @param {string} identifier - Raw identifier
   * @returns {string} Safe identifier
   */
  safeIdentifier(identifier) {
    // Remove potentially dangerous characters
    let safeId = identifier.replace(/[;'"\\]/g, "");

    // Apply dialect-specific escaping
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
        safeId = safeId.replace(/`/g, "``");
        break;
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        safeId = safeId.replace(/"/g, '""');
        break;
      case "mssql":
      case "sqlserver":
        safeId = safeId.replace(/\]/g, "]]");
        break;
      case "oracle":
        safeId = safeId.replace(/"/g, '""');
        break;
    }

    return safeId;
  }

  /**
   * Get parameter placeholder for the current dialect
   * @param {number} index - Parameter index (1-based)
   * @returns {string} Parameter placeholder
   */
  getParameterPlaceholder(index) {
    switch (this.dialect) {
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return `$${index}`;
      case "mssql":
      case "sqlserver":
        return `@p${index}`;
      case "oracle":
        return `:p${index}`;
      default:
        return "?";
    }
  }

  /**
   * Build LIMIT/OFFSET clause with dialect-specific syntax
   * @param {number|null} limit - Limit value
   * @param {number|null} offset - Offset value
   * @returns {string} LIMIT/OFFSET clause
   */
  buildLimitOffset(limit, offset) {
    let clause = "";

    if (this.dialect === "mssql" || this.dialect === "sqlserver") {
      // SQL Server uses OFFSET/FETCH syntax
      if (offset !== null) {
        clause += ` OFFSET ${offset} ROWS`;
      }
      if (limit !== null) {
        if (offset !== null) {
          clause += ` FETCH NEXT ${limit} ROWS ONLY`;
        } else {
          clause += ` FETCH FIRST ${limit} ROWS ONLY`;
        }
      }
    } else if (this.dialect === "oracle") {
      // Oracle uses ROWNUM or FETCH FIRST syntax
      if (limit !== null) {
        const limitValue = limit;
        const offsetValue = offset || 0;
        clause = ` FETCH FIRST ${limitValue} ROWS ONLY`;
        if (offsetValue > 0) {
          clause = ` OFFSET ${offsetValue} ROWS FETCH NEXT ${limitValue} ROWS ONLY`;
        }
      }
    } else {
      // Standard SQL syntax for MySQL, PostgreSQL, SQLite, etc.
      if (limit !== null) {
        clause += ` LIMIT ${limit}`;
      }
      if (offset !== null) {
        clause += ` OFFSET ${offset}`;
      }
    }

    return clause;
  }

  /**
   * Get random function for the current dialect
   * @returns {string} Random function name
   */
  getRandomFunction() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
        return "RAND()";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
      case "sqlite":
      case "sqlite3":
        return "RANDOM()";
      case "mssql":
      case "sqlserver":
        return "NEWID()";
      case "oracle":
        return "DBMS_RANDOM.VALUE";
      case "clickhouse":
        return "rand()";
      default:
        return "RAND()";
    }
  }

  /**
   * Check if RETURNING clause is supported
   * @returns {boolean} True if RETURNING is supported
   */
  supportsReturning() {
    return [
      "postgresql",
      "postgres",
      "pg",
      "cockroachdb",
      "cockroach",
      "oracle",
    ].includes(this.dialect);
  }

  /**
   * Check if WITH clause (CTE) is supported
   * @returns {boolean} True if WITH clause is supported
   */
  supportsWithClause() {
    return [
      "postgresql",
      "postgres",
      "pg",
      "cockroachdb",
      "cockroach",
      "mssql",
      "sqlserver",
      "oracle",
    ].includes(this.dialect);
  }

  /**
   * Check if specific feature is supported
   * @param {string} feature - Feature to check
   * @returns {boolean} True if feature is supported
   */
  supportsFeature(feature) {
    const featureSupport = {
      returning: this.supportsReturning(),
      with: this.supportsWithClause(),
      window_functions: [
        "postgresql",
        "postgres",
        "pg",
        "cockroachdb",
        "cockroach",
        "mssql",
        "sqlserver",
        "oracle",
      ].includes(this.dialect),
      json_functions: [
        "mysql",
        "mariadb",
        "postgresql",
        "postgres",
        "pg",
        "cockroachdb",
        "cockroach",
      ].includes(this.dialect),
      fulltext_search: [
        "mysql",
        "mariadb",
        "postgresql",
        "postgres",
        "pg",
      ].includes(this.dialect),
      spatial_data: [
        "mysql",
        "mariadb",
        "postgresql",
        "postgres",
        "pg",
      ].includes(this.dialect),
    };

    return featureSupport[feature] || false;
  }

  /**
   * Quote identifier based on database dialect
   * @param {string} identifier - Identifier to quote
   * @returns {string} Quoted identifier
   */
  quoteIdentifier(identifier) {
    // Handle raw expressions or already quoted identifiers
    if (
      identifier.includes("(") ||
      identifier.includes(")") ||
      identifier.includes(" as ") ||
      identifier.includes("`") ||
      identifier.includes('"') ||
      identifier.includes("[") ||
      identifier.includes("]")
    ) {
      return identifier;
    }

    // Handle qualified identifiers (e.g., "database.table.column")
    if (identifier.includes(".")) {
      return identifier
        .split(".")
        .map((part) => this._quoteIdentifierPart(part))
        .join(".");
    }

    return this._quoteIdentifierPart(identifier);
  }

  /**
   * Internal method to quote a single identifier part
   * @param {string} identifier - Identifier part to quote
   * @returns {string} Quoted identifier part
   * @private
   */
  _quoteIdentifierPart(identifier) {
    // Trim whitespace
    identifier = identifier.trim();

    // Return if already quoted
    if (
      (identifier.startsWith("`") && identifier.endsWith("`")) ||
      (identifier.startsWith('"') && identifier.endsWith('"')) ||
      (identifier.startsWith("[") && identifier.endsWith("]"))
    ) {
      return identifier;
    }

    // Apply dialect-specific quoting rules
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
      case "clickhouse":
        return `\`${identifier}\``;

      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return `"${identifier}"`;

      case "sqlite":
      case "sqlite3":
        // SQLite supports both backticks and double quotes, but double quotes are standard
        return `"${identifier}"`;

      case "mssql":
      case "sqlserver":
        return `[${identifier}]`;

      case "oracle":
        // Oracle typically uses uppercase and double quotes
        return `"${identifier.toUpperCase()}"`;

      default:
        // For unsupported dialects, return unquoted identifier with warning
        console.warn(
          `Unsupported dialect: ${this.dialect}, returning unquoted identifier`,
        );
        return identifier;
    }
  }

  /**
   * Execute raw SQL query
   * @param {string} sql - SQL query
   * @param {Array} bindings - Query bindings
   * @returns {Promise<Object>} Query result
   */
  async executeQuery(sql, bindings = []) {
    try {
      if (!this.connection?.query && !this.connection?.execute) {
        throw new Error(
          "Database connection does not have query or execute method",
        );
      }

      const executeMethod = this.connection.execute || this.connection.query;
      const result = await executeMethod.call(this.connection, sql, bindings);

      // Emit query event
      this.emit("query", { sql, bindings, result });

      return result;
    } catch (error) {
      this.emit("query:error", { sql, bindings, error });
      throw error;
    }
  }

  /**
   * Clone the query builder
   * @returns {QueryBuilder} Cloned query builder instance
   */
  clone() {
    const cloned = new QueryBuilder(
      this.tableName,
      this.connection,
      this.dialect,
    );

    cloned.query = JSON.parse(JSON.stringify(this.query));
    cloned.bindings = [...this.bindings];
    cloned.paramIndex = this.paramIndex;
    cloned.subQueries = new Map(this.subQueries);

    return cloned;
  }

  /**
   * Add raw SQL to SELECT clause
   * @param {string} expression - Raw SQL expression
   * @param {Array} bindings - Bindings for raw SQL
   * @returns {QueryBuilder} Query builder instance
   */
  selectRaw(expression, bindings = []) {
    this.query.columns.push({ raw: expression });
    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add raw value
   * @param {string} value - Raw value
   * @returns {Object} Raw value object
   */
  raw(value) {
    return { raw: value };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Paginate results
   * @param {number} page - Page number (1-based)
   * @param {number} perPage - Items per page
   * @returns {QueryBuilder} Query builder instance
   */
  paginate(page = 1, perPage = 20) {
    const safePage = Math.max(1, page);
    const safePerPage = Math.min(Math.max(1, perPage), 100);

    this.query.limit = safePerPage;
    this.query.offset = (safePage - 1) * safePerPage;

    return this;
  }

  /**
   * Get paginated results with metadata
   * @param {number} page - Page number (1-based)
   * @param {number} perPage - Items per page
   * @returns {Promise<Object>} Paginated results with metadata
   */
  async paginateWithMetadata(page = 1, perPage = 20) {
    const countQuery = this.clone();
    countQuery.query.columns = ["COUNT(*) as total"];
    countQuery.query.limit = null;
    countQuery.query.offset = null;
    countQuery.query.orderBy = [];

    const countResult = await countQuery.first();
    const total = parseInt(countResult.total);

    this.paginate(page, perPage);
    const data = await this.get();

    const totalPages = Math.ceil(total / perPage);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data,
      pagination: {
        page,
        perPage,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null,
      },
    };
  }

  /**
   * Increment column value
   * @param {string} column - Column name
   * @param {number} amount - Amount to increment
   * @returns {QueryBuilder} Query builder instance
   */
  increment(column, amount = 1) {
    this.query.type = "update";
    if (!this.query.data) this.query.data = {};
    this.query.data[column] = this.raw(
      `${this.wrapColumn(column)} + ${amount}`,
    );
    return this;
  }

  /**
   * Decrement column value
   * @param {string} column - Column name
   * @param {number} amount - Amount to decrement
   * @returns {QueryBuilder} Query builder instance
   */
  decrement(column, amount = 1) {
    this.query.type = "update";
    if (!this.query.data) this.query.data = {};
    this.query.data[column] = this.raw(
      `${this.wrapColumn(column)} - ${amount}`,
    );
    return this;
  }

  /**
   * Add raw GROUP BY clause
   * @param {string} expression - Raw GROUP BY expression
   * @param {Array} bindings - Bindings for raw expression
   * @returns {QueryBuilder} Query builder instance
   */
  groupByRaw(expression, bindings = []) {
    this.query.groupBy.push({ raw: expression });
    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add raw HAVING clause
   * @param {string} sql - Raw SQL HAVING clause
   * @param {Array} bindings - Bindings for raw SQL
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  havingRaw(sql, bindings = [], boolean = "and") {
    this.query.having.push({
      raw: sql,
      boolean,
    });

    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add WHERE column comparison
   * @param {string} first - First column
   * @param {string} operator - Comparison operator
   * @param {string} second - Second column
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereColumn(first, operator, second, boolean = "and") {
    this.query.where.push({
      type: "column",
      first,
      operator,
      second,
      boolean,
    });
    return this;
  }

  /**
   * Add WHERE EXISTS subquery
   * @param {Function} callback - Subquery callback
   * @param {string} boolean - Boolean operator (and, or)
   * @param {boolean} not - Whether to use NOT EXISTS
   * @returns {QueryBuilder} Query builder instance
   */
  whereExists(callback, boolean = "and", not = false) {
    const subQuery = new QueryBuilder("", this.connection, this.dialect);
    callback(subQuery);
    const { sql, bindings } = subQuery.toSQL();

    this.query.where.push({
      type: "exists",
      sql: `(${sql})`,
      boolean,
      not,
    });

    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add WHERE NOT EXISTS subquery
   * @param {Function} callback - Subquery callback
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereNotExists(callback, boolean = "and") {
    return this.whereExists(callback, boolean, true);
  }

  /**
   * Add WHERE subquery condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {Function} callback - Subquery callback
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereSub(column, operator, callback, boolean = "and") {
    const subQuery = new QueryBuilder("", this.connection, this.dialect);
    callback(subQuery);
    const { sql, bindings } = subQuery.toSQL();

    this.query.where.push({
      type: "subquery",
      column,
      operator,
      sql: `(${sql})`,
      boolean,
    });
  }

  /**
   * Add OR WHERE column comparison
   * @param {string} first - First column
   * @param {string} operator - Comparison operator
   * @param {string} second - Second column
   * @returns {QueryBuilder} Query builder instance
   */
  orWhereColumn(first, operator, second) {
    return this.whereColumn(first, operator, second, "or");
  }

  /**
   * Add WHERE date condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {Date|string} value - Date value
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereDate(column, operator, value, boolean = "and") {
    const dateValue =
      value instanceof Date ? value.toISOString().split("T") : value;
    this.query.where.push({
      type: "date",
      column,
      operator,
      value: dateValue,
      boolean,
    });
    this.bindings.push(dateValue);
    return this;
  }

  /**
   * Add WHERE time condition
   * @param {string} column - Column
   * @param {string} operator - Comparison operator
   * @param {Date|string} value - Time value
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereTime(column, operator, value, boolean = "and") {
    const timeValue =
      value instanceof Date ? value.toISOString().split("T").split(".") : value;
    this.query.where.push({
      type: "time",
      column,
      operator,
      value: timeValue,
      boolean,
    });
    this.bindings.push(timeValue);
    return this;
  }

  /**
   * Add WHERE year condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {number|string} value - Year value
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereYear(column, operator, value, boolean = "and") {
    this.query.where.push({
      type: "year",
      column,
      operator,
      value,
      boolean,
    });
    this.bindings.push(value);
    return this;
  }

  /**
   * Add WHERE month condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {number|string} value - Month value
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereMonth(column, operator, value, boolean = "and") {
    this.query.where.push({
      type: "month",
      column,
      operator,
      value,
      boolean,
    });
    this.bindings.push(value);
    return this;
  }

  /**
   * Add WHERE day condition
   * @param {string} column - Column name
   * @param {string} operator - Comparison operator
   * @param {number|string} value - Day value
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereDay(column, operator, value, boolean = "and") {
    this.query.where.push({
      type: "day",
      column,
      operator,
      value,
      boolean,
    });
    this.bindings.push(value);
    return this;
  }

  /**
   * Add WHERE condition group
   * @param {Function} callback - Group callback
   * @param {string} boolean - Boolean operator (and, or)
   * @returns {QueryBuilder} Query builder instance
   */
  whereGroup(callback, boolean = "and") {
    const groupQuery = new QueryBuilder("", this.connection, this.dialect);
    callback(groupQuery);
    const { sql, bindings } = groupQuery.toSQL();

    this.query.where.push({
      type: "group",
      sql: `(${sql})`,
      boolean,
    });

    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add OR WHERE condition group
   * @param {Function} callback - Group callback
   * @returns {QueryBuilder} Query builder instance
   */
  orWhereGroup(callback) {
    return this.whereGroup(callback, "or");
  }

  /**
   * Add UNION query
   * @param {Function|QueryBuilder} query - Query to union
   * @param {boolean} all - Whether to use UNION ALL
   * @returns {QueryBuilder} Query builder instance
   */
  union(query, all = false) {
    const unionQuery =
      typeof query === "function"
        ? new QueryBuilder("", this.connection, this.dialect)
        : query;

    if (typeof query === "function") {
      query(unionQuery);
    }

    const { sql, bindings } = unionQuery.toSQL();

    this.query.union.push({
      query: sql,
      all,
      bindings,
    });

    this.bindings.push(...bindings);
    return this;
  }

  /**
   * Add UNION ALL query
   * @param {Function|QueryBuilder} query - Query to union
   * @returns {QueryBuilder} Query builder instance
   */
  unionAll(query) {
    return this.union(query, true);
  }

  /**
   * Add WITH clause (Common Table Expression)
   * @param {string} name - CTE name
   * @param {Function|string} query - CTE query or SQL
   * @param {Array} columns - CTE column names
   * @param {boolean} recursive - Whether CTE is recursive
   * @returns {QueryBuilder} Query builder instance
   */
  with(name, query, columns = [], recursive = false) {
    let cteQuery;
    let cteBindings = [];

    if (typeof query === "function") {
      const qb = new QueryBuilder("", this.connection, this.dialect);
      query(qb);
      const result = qb.toSQL();
      cteQuery = result.sql;
      cteBindings = result.bindings;
    } else if (typeof query === "string") {
      cteQuery = query;
    } else if (query instanceof QueryBuilder) {
      const result = query.toSQL();
      cteQuery = result.sql;
      cteBindings = result.bindings;
    } else {
      throw new Error(
        "CTE query must be a function, string, or QueryBuilder instance",
      );
    }

    this.query.with.push({
      name,
      query: cteQuery,
      columns,
      recursive,
    });

    this.bindings.push(...cteBindings);
    return this;
  }

  /**
   * Add recursive WITH clause
   * @param {string} name - CTE name
   * @param {Function} query - CTE query function
   * @param {Array} columns - CTE column names
   * @returns {QueryBuilder} Query builder instance
   */
  withRecursive(name, query, columns = []) {
    return this.with(name, query, columns, true);
  }

  /**
   * Add LOCK clause
   * @param {string} lock - Lock type (FOR UPDATE, FOR SHARE, etc.)
   * @returns {QueryBuilder} Query builder instance
   */
  lock(lock = "FOR UPDATE") {
    this.query.lock = lock;
    return this;
  }

  /**
   * Add LOCK FOR UPDATE clause
   * @returns {QueryBuilder} Query builder instance
   */
  lockForUpdate() {
    return this.lock("FOR UPDATE");
  }

  /**
   * Add LOCK FOR SHARE clause
   * @returns {QueryBuilder} Query builder instance
   */
  lockForShare() {
    return this.lock("FOR SHARE");
  }

  /**
   * Add RETURNING clause (PostgreSQL only)
   * @param {...string} columns - Columns to return
   * @returns {QueryBuilder} Query builder instance
   */
  returning(...columns) {
    if (
      !["postgresql", "postgres", "pg", "cockroachdb", "cockroach"].includes(
        this.dialect,
      )
    ) {
      console.warn(
        "RETURNING clause is only supported in PostgreSQL and CockroachDB",
      );
    }
    this.query.returning = columns;
    return this;
  }

  /**
   * Execute query and return first result or default value
   * @param {*} defaultValue - Default value if no result
   * @returns {Promise<*>} First result or default value
   */
  async firstOr(defaultValue = null) {
    const result = await this.first();
    return result || defaultValue;
  }

  /**
   * Execute query and return first result or throw error
   * @param {string} message - Error message
   * @returns {Promise<Object>} First result
   * @throws {Error} If no result found
   */
  async firstOrFail(message = "No records found") {
    const result = await this.first();
    if (!result) {
      throw new Error(message);
    }
    return result;
  }

  /**
   * Execute query and return value of a single column
   * @param {string} column - Column name
   * @returns {Promise<*>} Column value
   */
  async value(column) {
    const result = await this.first();
    return result ? result[column] : null;
  }

  /**
   * Execute query and return plucked values
   * @param {string} column - Column name
   * @returns {Promise<Array>} Array of column values
   */
  async pluck(column) {
    const results = await this.get();
    return results.map((row) => row[column]);
  }

  /**
   * Execute query and return key-value pairs
   * @param {string} keyColumn - Key column name
   * @param {string} valueColumn - Value column name
   * @returns {Promise<Object>} Key-value object
   */
  async keyBy(keyColumn, valueColumn = null) {
    const results = await this.get();
    const keyValuePairs = {};

    results.forEach((row) => {
      const key = row[keyColumn];
      const value = valueColumn ? row[valueColumn] : row;
      keyValuePairs[key] = value;
    });

    return keyValuePairs;
  }

  /**
   * Execute query and return chunked results
   * @param {number} size - Chunk size
   * @param {Function} callback - Callback for each chunk
   * @returns {Promise<void>}
   */
  async chunk(size, callback) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const chunkQuery = this.clone();
      chunkQuery.paginate(page, size);
      const results = await chunkQuery.get();

      if (results.length > 0) {
        await callback(results, page);
        page++;
      } else {
        hasMore = false;
      }
    }
  }

  /**
   * Execute query and return cursor for streaming
   * @param {number} chunkSize - Chunk size for streaming
   * @returns {AsyncGenerator} Async generator for streaming results
   */
  async *cursor(chunkSize = 100) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const chunkQuery = this.clone();
      chunkQuery.paginate(page, chunkSize);
      const results = await chunkQuery.get();

      if (results.length > 0) {
        for (const result of results) {
          yield result;
        }
        page++;
      } else {
        hasMore = false;
      }
    }
  }

  /**
   * Execute query and return aggregated results
   * @param {string} keyColumn - Column to group by
   * @param {Function} aggregator - Aggregation function
   * @returns {Promise<Object>} Aggregated results
   */
  async aggregate(keyColumn, aggregator) {
    const results = await this.get();
    const aggregated = {};

    results.forEach((row) => {
      const key = row[keyColumn];
      if (!aggregated[key]) {
        aggregated[key] = [];
      }
      aggregated[key].push(row);
    });

    for (const key in aggregated) {
      aggregated[key] = aggregator(aggregated[key]);
    }

    return aggregated;
  }

  /**
   * Execute query and return results as map
   * @param {string} keyColumn - Column to use as key
   * @returns {Promise<Map>} Map of results
   */
  async map(keyColumn) {
    const results = await this.get();
    const map = new Map();

    results.forEach((row) => {
      map.set(row[keyColumn], row);
    });

    return map;
  }

  /**
   * Execute query and return results grouped by column
   * @param {string} groupColumn - Column to group by
   * @returns {Promise<Object>} Grouped results
   */
  async groupByColumn(groupColumn) {
    const results = await this.get();
    const grouped = {};

    results.forEach((row) => {
      const key = row[groupColumn];
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(row);
    });

    return grouped;
  }

  /**
   * Execute query and return results with index
   * @param {Function} indexer - Function to create index key
   * @returns {Promise<Object>} Indexed results
   */
  async indexBy(indexer) {
    const results = await this.get();
    const indexed = {};

    results.forEach((row) => {
      const key = indexer(row);
      indexed[key] = row;
    });

    return indexed;
  }

  /**
   * Execute query and return only distinct results
   * @param {...string} columns - Columns to distinct by
   * @returns {Promise<Array>} Distinct results
   */
  async distinctResults(...columns) {
    this.distinct();
    if (columns.length > 0) {
      this.select(...columns);
    }
    return this.get();
  }

  /**
   * Execute query and return results with limit
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} Limited results
   */
  async take(limit) {
    this.limit(limit);
    return this.get();
  }

  /**
   * Execute query and skip first N results
   * @param {number} offset - Number of results to skip
   * @returns {Promise<Array>} Results after skipping
   */
  async skip(offset) {
    this.offset(offset);
    return this.get();
  }

  /**
   * Execute query and return results in random order
   * @returns {Promise<Array>} Randomly ordered results
   */
  async inRandomOrder() {
    this.orderByRaw(this.dialect === "mysql" ? "RAND()" : "RANDOM()");
    return this.get();
  }

  /**
   * Execute query and return results with specific columns only
   * @param {...string} columns - Columns to select
   * @returns {Promise<Array>} Results with selected columns
   */
  async only(...columns) {
    this.select(...columns);
    return this.get();
  }

  /**
   * Execute query and return results without specific columns
   * @param {...string} columns - Columns to exclude
   * @returns {Promise<Array>} Results without excluded columns
   */
  async except(...columns) {
    const allColumns = await this.getColumnNames();
    const selectedColumns = allColumns.filter((col) => !columns.includes(col));
    this.select(...selectedColumns);
    return this.get();
  }

  /**
   * Get column names from table
   * @returns {Promise<Array>} Array of column names
   */
  async getColumnNames() {
    const originalColumns = this.query.columns;
    const originalType = this.query.type;

    this.query.type = "select";
    this.query.columns = ["*"];
    this.query.limit = 1;

    const result = await this.execute();
    const columns = result.fields
      ? result.fields.map((f) => f.name)
      : Object.keys(result || {});

    // Restore original state
    this.query.columns = originalColumns;
    this.query.type = originalType;

    return columns;
  }

  /**
   * Execute query and return results as JSON string
   * @returns {Promise<string>} JSON string of results
   */
  async toJson() {
    const results = await this.get();
    return JSON.stringify(results, null, 2);
  }

  /**
   * Execute query and return results as CSV string
   * @returns {Promise<string>} CSV string of results
   */
  async toCsv() {
    const results = await this.get();
    if (results.length === 0) {
      return "";
    }

    const headers = Object.keys(results);
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(","));

    // Add data rows
    results.forEach((row) => {
      const values = headers.map((header) => {
        const value = row[header];
        if (value === null || value === undefined) {
          return "";
        }
        const stringValue = String(value);
        // Escape quotes and wrap in quotes if contains comma or quotes
        if (stringValue.includes(",") || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvRows.push(values.join(","));
    });

    return csvRows.join("\n");
  }

  /**
   * Execute query and return results as array of arrays
   * @returns {Promise<Array>} Array of arrays
   */
  async toArray() {
    const results = await this.get();
    if (results.length === 0) {
      return [];
    }

    const headers = Object.keys(results);
    const array = [headers];

    results.forEach((row) => {
      const values = headers.map((header) => row[header]);
      array.push(values);
    });

    return array;
  }

  /**
   * Execute query and return results as key-value pairs
   * @param {string} keyColumn - Column to use as key
   * @param {string} valueColumn - Column to use as value
   * @returns {Promise<Object>} Key-value pairs
   */
  async toKeyValue(keyColumn, valueColumn) {
    const results = await this.get();
    const keyValue = {};

    results.forEach((row) => {
      keyValue[row[keyColumn]] = row[valueColumn];
    });

    return keyValue;
  }

  /**
   * Execute query and return results with applied transformation
   * @param {Function} transformer - Transformation function
   * @returns {Promise<Array>} Transformed results
   */
  async transform(transformer) {
    const results = await this.get();
    return results.map(transformer);
  }

  /**
   * Execute query and return results filtered by condition
   * @param {Function} filter - Filter function
   * @returns {Promise<Array>} Filtered results
   */
  async filter(filter) {
    const results = await this.get();
    return results.filter(filter);
  }

  /**
   * Execute query and return results sorted by comparator
   * @param {Function} comparator - Comparison function
   * @returns {Promise<Array>} Sorted results
   */
  async sort(comparator) {
    const results = await this.get();
    return results.sort(comparator);
  }

  /**
   * Execute query and return results reduced by reducer
   * @param {Function} reducer - Reduce function
   * @param {*} initialValue - Initial value for reduction
   * @returns {Promise<*>} Reduced value
   */
  async reduce(reducer, initialValue) {
    const results = await this.get();
    return results.reduce(reducer, initialValue);
  }

  /**
   * Execute query and return results mapped to new structure
   * @param {Function} mapper - Mapping function
   * @returns {Promise<Array>} Mapped results
   */
  async mapResults(mapper) {
    const results = await this.get();
    return results.map(mapper);
  }

  /**
   * Execute query and return results with applied side effect
   * @param {Function} sideEffect - Side effect function
   * @returns {Promise<Array>} Results after side effect
   */
  async tap(sideEffect) {
    const results = await this.get();
    sideEffect(results);
    return results;
  }

  /**
   * Execute query and return results with timing information
   * @returns {Promise<Object>} Results with timing
   */
  async withTiming() {
    const startTime = Date.now();
    const results = await this.get();
    const endTime = Date.now();

    return {
      results,
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
    };
  }

  /**
   * Execute query and return results with memory usage information
   * @returns {Promise<Object>} Results with memory usage
   */
  async withMemoryUsage() {
    const startMemory = process.memoryUsage();
    const results = await this.get();
    const endMemory = process.memoryUsage();

    return {
      results,
      memory: {
        start: startMemory,
        end: endMemory,
        diff: {
          rss: endMemory.rss - startMemory.rss,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
        },
      },
    };
  }

  /**
   * Execute query and return results with execution plan
   * @returns {Promise<Object>} Results with execution plan
   */
  async withExplain() {
    const explainResult = await this.explain();
    const results = await this.get();

    return {
      results,
      explain: explainResult,
    };
  }

  /**
   * Execute query and return results with count
   * @returns {Promise<Object>} Results with count
   */
  async withCount() {
    const countQuery = this.clone();
    countQuery.query.columns = ["COUNT(*) as total"];
    countQuery.query.limit = null;
    countQuery.query.offset = null;
    countQuery.query.orderBy = [];

    const countResult = await countQuery.first();
    const results = await this.get();

    return {
      results,
      count: parseInt(countResult.total),
    };
  }

  /**
   * Execute query and return results with pagination metadata
   * @param {number} page - Page number
   * @param {number} perPage - Items per page
   * @returns {Promise<Object>} Results with pagination
   */
  async withPagination(page = 1, perPage = 20) {
    return this.paginateWithMetadata(page, perPage);
  }

  /**
   * Execute query and return results with applied transformations
   * @param {Array<Function>} transformers - Array of transformer functions
   * @returns {Promise<Array>} Transformed results
   */
  async pipe(...transformers) {
    let results = await this.get();

    for (const transformer of transformers) {
      results = transformer(results);
    }

    return results;
  }

  /**
   * Execute query and return results with caching
   * @param {string} cacheKey - Cache key
   * @param {number} ttl - Time to live in seconds
   * @param {Function} cacheGetter - Cache getter function
   * @param {Function} cacheSetter - Cache setter function
   * @returns {Promise<Array>} Cached results
   */
  async withCache(cacheKey, ttl = 300, cacheGetter = null, cacheSetter = null) {
    if (cacheGetter) {
      const cached = await cacheGetter(cacheKey);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    }

    const results = await this.get();

    if (cacheSetter) {
      await cacheSetter(cacheKey, results, ttl);
    }

    return results;
  }

  /**
   * Execute query and return results with retry logic
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} delay - Delay between retries in milliseconds
   * @param {Function} retryCondition - Condition for retry
   * @returns {Promise<Array>} Results with retry
   */
  async withRetry(maxRetries = 3, delay = 1000, retryCondition = null) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.get();
      } catch (error) {
        lastError = error;

        if (retryCondition && !retryCondition(error)) {
          throw error;
        }

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute query and return results with timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Array>} Results with timeout
   */
  async withTimeout(timeout = 5000) {
    return Promise.race([
      this.get(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Query timeout after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  }

  /**
   * Execute query and return results with transaction
   * @param {Function} transactionCallback - Transaction callback
   * @returns {Promise<Array>} Results within transaction
   */
  async withTransaction(transactionCallback) {
    if (!this.connection.beginTransaction) {
      throw new Error("Database connection does not support transactions");
    }

    await this.connection.beginTransaction();

    try {
      const results = await this.get();
      await transactionCallback(results);
      await this.connection.commit();
      return results;
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  /**
   * Execute query and return results with error handling
   * @param {Function} errorHandler - Error handler function
   * @returns {Promise<Array>} Results or error handling result
   */
  async withErrorHandling(errorHandler) {
    try {
      return await this.get();
    } catch (error) {
      return errorHandler(error);
    }
  }

  /**
   * Execute query and return results with validation
   * @param {Function} validator - Validation function
   * @returns {Promise<Array>} Validated results
   */
  async withValidation(validator) {
    const results = await this.get();
    const validationResult = validator(results);

    if (validationResult !== true) {
      throw new Error(`Validation failed: ${validationResult}`);
    }

    return results;
  }

  /**
   * Execute query and return results with logging
   * @param {Function} logger - Logger function
   * @returns {Promise<Array>} Results with logging
   */
  async withLogging(logger = console.log) {
    const startTime = Date.now();
    const { sql, bindings } = this.toSQL();

    logger(`Executing query: ${sql}`);
    logger(`Bindings: ${JSON.stringify(bindings)}`);

    try {
      const results = await this.get();
      const endTime = Date.now();

      logger(`Query completed in ${endTime - startTime}ms`);
      logger(`Results count: ${results.length}`);

      return results;
    } catch (error) {
      logger(`Query failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute query and return results with profiling
   * @returns {Promise<Object>} Results with profiling information
   */
  async withProfiling() {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const { sql, bindings } = this.toSQL();
    const results = await this.get();

    const endTime = Date.now();
    const endMemory = process.memoryUsage();

    return {
      results,
      profile: {
        sql,
        bindings,
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
        memory: {
          start: startMemory,
          end: endMemory,
          diff: {
            rss: endMemory.rss - startMemory.rss,
            heapTotal: endMemory.heapTotal - startMemory.heapTotal,
            heapUsed: endMemory.heapUsed - startMemory.heapUsed,
            external: endMemory.external - startMemory.external,
          },
        },
        resultCount: results.length,
      },
    };
  }

  /**
   * Execute query and return results with all metadata
   * @returns {Promise<Object>} Results with full metadata
   */
  async withMetadata() {
    const profile = await this.withProfiling();
    const explain = await this.explain();
    const count = await this.count();

    return {
      ...profile,
      explain,
      count,
      query: this.query,
      dialect: this.dialect,
      table: this.tableName,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dump query information for debugging
   * @returns {Object} Query information
   */
  dump() {
    const { sql, bindings } = this.toSQL();

    return {
      sql,
      bindings,
      query: this.query,
      dialect: this.dialect,
      table: this.tableName,
      bindingsCount: bindings.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get SQL string for debugging
   * @returns {string} SQL string
   */
  toSql() {
    return this.toSQL().sql;
  }

  /**
   * Get query as string for logging
   * @returns {string} Query string representation
   */
  toString() {
    const { sql, bindings } = this.toSQL();
    return `QueryBuilder: ${sql} [${bindings.join(", ")}]`;
  }

  /**
   * Check if query has WHERE conditions
   * @returns {boolean} True if has WHERE conditions
   */
  hasWhere() {
    return this.query.where.length > 0;
  }

  /**
   * Check if query has JOINs
   * @returns {boolean} True if has JOINs
   */
  hasJoins() {
    return this.query.joins.length > 0;
  }

  /**
   * Check if query has GROUP BY
   * @returns {boolean} True if has GROUP BY
   */
  hasGroupBy() {
    return this.query.groupBy.length > 0;
  }

  /**
   * Check if query has ORDER BY
   * @returns {boolean} True if has ORDER BY
   */
  hasOrderBy() {
    return this.query.orderBy.length > 0;
  }

  /**
   * Check if query has LIMIT
   * @returns {boolean} True if has LIMIT
   */
  hasLimit() {
    return this.query.limit !== null;
  }

  /**
   * Check if query has OFFSET
   * @returns {boolean} True if has OFFSET
   */
  hasOffset() {
    return this.query.offset !== null;
  }

  /**
   * Get connection
   * @returns {Object} Database connection
   */
  getConnection() {
    return this.connection;
  }

  /**
   * Set connection
   * @param {Object} connection - Database connection
   * @returns {QueryBuilder} Query builder instance
   */
  setConnection(connection) {
    this.connection = connection;
    return this;
  }

  /**
   * Get bindings count
   * @returns {number} Number of bindings
   */
  getBindingsCount() {
    return this.bindings.length;
  }

  /**
   * Get query bindings
   * @returns {Array} Query bindings
   */
  getBindings() {
    return [...this.bindings];
  }

  /**
   * Clear all bindings
   * @returns {QueryBuilder} Query builder instance
   */
  clearBindings() {
    this.bindings = [];
    return this;
  }

  /**
   * Add binding to query
   * @param {*} value - Value to bind
   * @returns {QueryBuilder} Query builder instance
   */
  addBinding(value) {
    this.bindings.push(value);
    return this;
  }

  /**
   * Add multiple bindings to query
   * @param {Array} values - Values to bind
   * @returns {QueryBuilder} Query builder instance
   */
  addBindings(values) {
    if (Array.isArray(values) && values.length > 50) {
      this.bindings = this.bindings.concat(values);
    } else {
      this.bindings.push(...values);
    }
    return this;
  }
  /**
   * Set bindings for query
   * @param {Array} bindings - Bindings to set
   * @returns {QueryBuilder} Query builder instance
   */
  setBindings(bindings) {
    this.bindings = [...bindings];
    return this;
  }

  /**
   * Merge bindings from another query builder
   * @param {QueryBuilder} queryBuilder - Query builder to merge bindings from
   * @returns {QueryBuilder} Query builder instance
   */
  mergeBindings(queryBuilder) {
    this.bindings.push(...queryBuilder.getBindings());
    return this;
  }

  /**
   * Get query type
   * @returns {string} Query type
   */
  getQueryType() {
    return this.query.type;
  }

  /**
   * Set query type
   * @param {string} type - Query type (select, insert, update, delete)
   * @returns {QueryBuilder} Query builder instance
   */
  setQueryType(type) {
    const validTypes = ["select", "insert", "update", "delete"];
    if (!validTypes.includes(type)) {
      throw new Error(
        `Invalid query type: ${type}. Must be one of: ${validTypes.join(", ")}`,
      );
    }
    this.query.type = type;
    return this;
  }

  /**
   * Get table name
   * @returns {string} Table name
   */
  getTable() {
    return this.tableName;
  }

  /**
   * Set table name
   * @param {string} tableName - Table name
   * @returns {QueryBuilder} Query builder instance
   */
  setTable(tableName) {
    this.tableName = tableName;
    return this;
  }

  /**
   * Get database dialect
   * @returns {string} Database dialect
   */
  getDialect() {
    return this.dialect;
  }

  /**
   * Set database dialect
   * @param {string} dialect - Database dialect
   * @returns {QueryBuilder} Query builder instance
   */
  setDialect(dialect) {
    const supportedDialects = [
      "mysql",
      "mariadb",
      "postgresql",
      "postgres",
      "pg",
      "sqlite",
      "sqlite3",
      "mssql",
      "sqlserver",
      "oracle",
      "cockroachdb",
      "cockroach",
      "clickhouse",
    ];

    const normalizedDialect = dialect.toLowerCase();
    if (!supportedDialects.includes(normalizedDialect)) {
      throw new Error(`Unsupported database dialect: ${dialect}`);
    }

    this.dialect = normalizedDialect;
    return this;
  }

  /**
   * Get query structure
   * @returns {Object} Query structure
   */
  getQuery() {
    return JSON.parse(JSON.stringify(this.query));
  }

  /**
   * Set query structure
   * @param {Object} query - Query structure
   * @returns {QueryBuilder} Query builder instance
   */
  setQuery(query) {
    this.query = JSON.parse(JSON.stringify(query));
    return this;
  }

  /**
   * Get query columns
   * @returns {Array} Query columns
   */
  getColumns() {
    return [...this.query.columns];
  }

  /**
   * Set query columns
   * @param {Array} columns - Columns to select
   * @returns {QueryBuilder} Query builder instance
   */
  setColumns(columns) {
    this.query.columns = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  /**
   * Get WHERE conditions
   * @returns {Array} WHERE conditions
   */
  getWhereConditions() {
    return JSON.parse(JSON.stringify(this.query.where));
  }

  /**
   * Get ORDER BY clauses
   * @returns {Array} ORDER BY clauses
   */
  getOrderBy() {
    return JSON.parse(JSON.stringify(this.query.orderBy));
  }

  /**
   * Get LIMIT value
   * @returns {number|null} LIMIT value
   */
  getLimit() {
    return this.query.limit;
  }

  /**
   * Get OFFSET value
   * @returns {number|null} OFFSET value
   */
  getOffset() {
    return this.query.offset;
  }

  /**
   * Get JOIN clauses
   * @returns {Array} JOIN clauses
   */
  getJoins() {
    return JSON.parse(JSON.stringify(this.query.joins));
  }

  /**
   * Get GROUP BY clauses
   * @returns {Array} GROUP BY clauses
   */
  getGroupBy() {
    return JSON.parse(JSON.stringify(this.query.groupBy));
  }

  /**
   * Get HAVING conditions
   * @returns {Array} HAVING conditions
   */
  getHaving() {
    return JSON.parse(JSON.stringify(this.query.having));
  }

  /**
   * Check if query is SELECT
   * @returns {boolean} True if query is SELECT
   */
  isSelect() {
    return this.query.type === "select";
  }

  /**
   * Check if query is INSERT
   * @returns {boolean} True if query is INSERT
   */
  isInsert() {
    return this.query.type === "insert";
  }

  /**
   * Check if query is UPDATE
   * @returns {boolean} True if query is UPDATE
   */
  isUpdate() {
    return this.query.type === "update";
  }

  /**
   * Check if query is DELETE
   * @returns {boolean} True if query is DELETE
   */
  isDelete() {
    return this.query.type === "delete";
  }

  /**
   * Check if query is DISTINCT
   * @returns {boolean} True if query is DISTINCT
   */
  isDistinct() {
    return this.query.distinct === true;
  }

  /**
   * Check if query has LOCK
   * @returns {boolean} True if query has LOCK
   */
  hasLock() {
    return this.query.lock !== null;
  }

  /**
   * Check if query has RETURNING clause
   * @returns {boolean} True if query has RETURNING clause
   */
  hasReturning() {
    return this.query.returning !== null && this.query.returning.length > 0;
  }

  /**
   * Check if query has UNION
   * @returns {boolean} True if query has UNION
   */
  hasUnion() {
    return this.query.union.length > 0;
  }

  /**
   * Check if query has WITH clause
   * @returns {boolean} True if query has WITH clause
   */
  hasWith() {
    return this.query.with.length > 0;
  }

  /**
   * Check if query has CTE
   * @returns {boolean} True if query has CTE
   */
  hasCte() {
    return this.query.cte.length > 0;
  }

  /**
   * Get query statistics
   * @returns {Object} Query statistics
   */
  getStats() {
    return {
      type: this.query.type,
      table: this.tableName,
      dialect: this.dialect,
      columns: this.query.columns.length,
      whereConditions: this.query.where.length,
      joins: this.query.joins.length,
      groupBy: this.query.groupBy.length,
      havingConditions: this.query.having.length,
      orderBy: this.query.orderBy.length,
      limit: this.query.limit,
      offset: this.query.offset,
      distinct: this.query.distinct,
      bindingsCount: this.bindings.length,
      hasLock: this.query.lock !== null,
      hasReturning:
        this.query.returning !== null && this.query.returning.length > 0,
      unionCount: this.query.union.length,
      withCount: this.query.with.length,
      cteCount: this.query.cte.length,
    };
  }

  /**
   * Get query summary
   * @returns {Object} Query summary
   */
  getSummary() {
    const { sql, bindings } = this.toSQL();
    return {
      sql,
      bindingsCount: bindings.length,
      type: this.query.type,
      table: this.tableName,
      dialect: this.dialect,
      complexity: this.calculateComplexity(),
      estimatedRows: this.estimateRows(),
      hasSubqueries: this.hasSubqueries(),
    };
  }

  /**
   * Calculate query complexity score
   * @returns {number} Complexity score
   */
  calculateComplexity() {
    let score = 0;

    // Base complexity
    score += 1;

    // WHERE conditions
    score += this.query.where.length * 0.5;

    // JOINs
    score += this.query.joins.length * 1;

    // GROUP BY
    score += this.query.groupBy.length * 0.5;

    // HAVING conditions
    score += this.query.having.length * 0.5;

    // ORDER BY
    score += this.query.orderBy.length * 0.3;

    // Subqueries
    if (this.hasSubqueries()) {
      score += 2;
    }

    // UNION
    if (this.hasUnion()) {
      score += 1;
    }

    // WITH/CTE
    if (this.hasWith() || this.hasCte()) {
      score += 1.5;
    }

    return Math.round(score * 10) / 10;
  }

  /**
   * Estimate number of rows affected/returned
   * @returns {number|null} Estimated row count
   */
  estimateRows() {
    if (this.query.type === "select") {
      if (this.query.limit !== null) {
        return Math.min(this.query.limit, 1000);
      }
      return 1000; // Default estimate for SELECT
    } else if (this.query.type === "insert") {
      return this.query.data
        ? Array.isArray(this.query.data)
          ? this.query.data.length
          : 1
        : 1;
    } else if (this.query.type === "update" || this.query.type === "delete") {
      return this.query.where.length > 0 ? 10 : null; // Warning: no WHERE clause
    }
    return null;
  }

  /**
   * Check if query contains subqueries
   * @returns {boolean} True if contains subqueries
   */
  hasSubqueries() {
    // Check WHERE conditions for subqueries
    const hasSubqueryInWhere = this.query.where.some(
      (condition) =>
        condition.type === "exists" || condition.type === "subquery",
    );

    // Check HAVING conditions for subqueries
    const hasSubqueryInHaving = this.query.having.some(
      (condition) =>
        condition.type === "exists" || condition.type === "subquery",
    );

    return (
      hasSubqueryInWhere || hasSubqueryInHaving || this.query.union.length > 0
    );
  }

  /**
   * Validate query structure
   * @returns {Object} Validation result
   */
  validate() {
    const errors = [];
    const warnings = [];

    // Check for DELETE without WHERE clause
    if (this.query.type === "delete" && this.query.where.length === 0) {
      warnings.push("DELETE query without WHERE clause may affect all rows");
    }

    // Check for UPDATE without WHERE clause
    if (this.query.type === "update" && this.query.where.length === 0) {
      warnings.push("UPDATE query without WHERE clause may affect all rows");
    }

    // Check for SELECT * without LIMIT on large tables
    if (
      this.query.type === "select" &&
      this.query.columns.includes("*") &&
      this.query.limit === null
    ) {
      warnings.push("SELECT * without LIMIT may return large result set");
    }

    // Check for missing JOIN conditions
    const invalidJoins = this.query.joins.filter(
      (join) =>
        join.type !== "cross" &&
        (!join.first || !join.operator || !join.second),
    );
    if (invalidJoins.length > 0) {
      errors.push("Invalid JOIN conditions detected");
    }

    // Check for GROUP BY without aggregate functions
    if (this.query.groupBy.length > 0) {
      const hasAggregate = this.query.columns.some((col) => {
        const colStr = typeof col === "string" ? col : "";
        return (
          colStr.includes("COUNT(") ||
          colStr.includes("SUM(") ||
          colStr.includes("AVG(") ||
          colStr.includes("MIN(") ||
          colStr.includes("MAX(")
        );
      });
      if (!hasAggregate) {
        warnings.push("GROUP BY used without aggregate functions");
      }
    }

    // Check dialect-specific limitations
    if (this.dialect === "sqlite" || this.dialect === "sqlite3") {
      if (this.query.returning) {
        errors.push("RETURNING clause not supported in SQLite");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      complexity: this.calculateComplexity(),
      estimatedRows: this.estimateRows(),
    };
  }

  /**
   * Explain query execution plan
   * @returns {Promise<Object>} Explain plan
   */
  async explain() {
    const { sql, bindings } = this.toSQL();
    const explainSql = `EXPLAIN ${sql}`;

    try {
      const result = await this.executeQuery(explainSql, bindings);
      return {
        sql: explainSql,
        plan: result,
        dialect: this.dialect,
      };
    } catch (error) {
      return {
        sql: explainSql,
        error: error.message,
        dialect: this.dialect,
      };
    }
  }

  /**
   * Analyze query performance
   * @returns {Promise<Object>} Analysis results
   */
  async analyze() {
    if (
      this.dialect === "postgresql" ||
      this.dialect === "postgres" ||
      this.dialect === "pg"
    ) {
      const { sql, bindings } = this.toSQL();
      const analyzeSql = `EXPLAIN ANALYZE ${sql}`;

      try {
        const result = await this.executeQuery(analyzeSql, bindings);
        return {
          sql: analyzeSql,
          analysis: result,
          dialect: this.dialect,
        };
      } catch (error) {
        return {
          sql: analyzeSql,
          error: error.message,
          dialect: this.dialect,
        };
      }
    } else {
      return {
        error: "ANALYZE not supported for this dialect",
        dialect: this.dialect,
      };
    }
  }

  /**
   * Get query performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const stats = this.getStats();
    const complexity = this.calculateComplexity();
    const estimatedRows = this.estimateRows();

    return {
      complexityScore: complexity,
      estimatedRows,
      conditionCount: stats.whereConditions,
      joinCount: stats.joins,
      groupByCount: stats.groupBy,
      orderByCount: stats.orderBy,
      hasSubqueries: this.hasSubqueries(),
      hasUnion: stats.unionCount > 0,
      hasCte: stats.cteCount > 0,
      isComplex: complexity > 5,
      needsOptimization: complexity > 8 || stats.whereConditions > 10,
    };
  }

  /**
   * Get query optimization suggestions
   * @returns {Array} Optimization suggestions
   */
  getOptimizationSuggestions() {
    const suggestions = [];
    const metrics = this.getPerformanceMetrics();

    if (metrics.complexityScore > 8) {
      suggestions.push(
        "Query is complex. Consider breaking it into smaller queries.",
      );
    }

    if (metrics.whereConditions > 10) {
      suggestions.push(
        "Too many WHERE conditions. Consider using indexes or restructuring the query.",
      );
    }

    if (this.query.type === "select" && this.query.columns.includes("*")) {
      suggestions.push(
        "Using SELECT * may impact performance. Specify only needed columns.",
      );
    }

    if (
      this.query.type === "select" &&
      this.query.limit === null &&
      metrics.estimatedRows > 1000
    ) {
      suggestions.push(
        "Consider adding LIMIT clause to prevent large result sets.",
      );
    }

    if (this.query.joins.length > 3) {
      suggestions.push(
        "Multiple JOINs detected. Ensure proper indexes exist on join columns.",
      );
    }

    if (this.query.groupBy.length > 0 && !this.hasAggregateFunctions()) {
      suggestions.push(
        "GROUP BY without aggregate functions may not be necessary.",
      );
    }

    if (this.query.orderBy.length > 2) {
      suggestions.push(
        "Multiple ORDER BY clauses may impact performance. Consider if all are necessary.",
      );
    }

    return suggestions;
  }

  /**
   * Check if query has aggregate functions
   * @returns {boolean} True if has aggregate functions
   */
  hasAggregateFunctions() {
    return this.query.columns.some((col) => {
      const colStr = typeof col === "string" ? col : "";
      return (
        colStr.includes("COUNT(") ||
        colStr.includes("SUM(") ||
        colStr.includes("AVG(") ||
        colStr.includes("MIN(") ||
        colStr.includes("MAX(")
      );
    });
  }

  /**
   * Get query execution plan
   * @returns {Promise<Object>} Execution plan
   */
  async getExecutionPlan() {
    const explain = await this.explain();
    const analysis = await this.analyze();
    const metrics = this.getPerformanceMetrics();
    const suggestions = this.getOptimizationSuggestions();

    return {
      query: this.getSummary(),
      explain,
      analysis,
      metrics,
      suggestions,
      validation: this.validate(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset query to initial state
   * @returns {QueryBuilder} Query builder instance
   */
  reset() {
    this.query = {
      type: "select",
      columns: ["*"],
      where: [],
      orderBy: [],
      limit: null,
      offset: null,
      joins: [],
      groupBy: [],
      having: [],
      distinct: false,
      lock: null,
      data: null,
      returning: null,
      union: [],
      with: [],
      cte: [],
    };
    this.bindings = [];
    this.paramIndex = 1;
    this.subQueries.clear();

    return this;
  }

  /**
   * Create new query builder for same table
   * @returns {QueryBuilder} New query builder instance
   */
  newQuery() {
    return new QueryBuilder(this.tableName, this.connection, this.dialect);
  }

  /**
   * Create new query builder for different table
   * @param {string} tableName - Table name
   * @returns {QueryBuilder} New query builder instance
   */
  table(tableName) {
    return new QueryBuilder(tableName, this.connection, this.dialect);
  }

  /**
   * Log query for debugging
   * @param {Function} logger - Logger function (default: console.log)
   * @returns {QueryBuilder} Query builder instance
   */
  log(logger = console.log) {
    const { sql, bindings } = this.toSQL();
    logger(`SQL: ${sql}`);
    logger(`Bindings: ${JSON.stringify(bindings)}`);
    logger(`Dialect: ${this.dialect}`);
    logger(`Type: ${this.query.type}`);
    return this;
  }

  /**
   * Debug query by logging and returning self
   * @returns {QueryBuilder} Query builder instance
   */
  debug() {
    return this.log();
  }

  /**
   * Get query as JSON for serialization
   * @returns {Object} JSON representation of query
   */
  toJSON() {
    return {
      table: this.tableName,
      dialect: this.dialect,
      query: this.query,
      bindings: this.bindings,
      paramIndex: this.paramIndex,
      subQueries: Array.from(this.subQueries.entries()),
    };
  }

  /**
   * Create QueryBuilder from JSON
   * @param {Object} json - JSON representation
   * @param {Object} connection - Database connection
   * @returns {QueryBuilder} Query builder instance
   */
  static fromJSON(json, connection) {
    const qb = new QueryBuilder(json.table, connection, json.dialect);
    qb.query = json.query;
    qb.bindings = json.bindings;
    qb.paramIndex = json.paramIndex;
    qb.subQueries = new Map(json.subQueries);
    return qb;
  }

  /**
   * Execute query with error handling and retry logic
   * @param {Object} options - Options for execution
   * @param {number} options.maxRetries - Maximum retry attempts
   * @param {number} options.retryDelay - Delay between retries in ms
   * @param {Function} options.onRetry - Callback on retry
   * @returns {Promise<Object>} Query result
   */
  async executeWithRetry(options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;
    const onRetry = options.onRetry || (() => {});

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.execute();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        onRetry(attempt, error, retryDelay);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        // Exponential backoff
        retryDelay *= 2;
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
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
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some((msg) => errorMessage.includes(msg));
  }

  /**
   * Execute query with timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Query result
   */
  async executeWithTimeout(timeout = 5000) {
    return Promise.race([
      this.execute(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Query timeout after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  }

  /**
   * Execute query in transaction
   * @param {Function} callback - Transaction callback
   * @returns {Promise<Object>} Query result
   */
  async executeInTransaction(callback) {
    if (!this.connection.beginTransaction) {
      throw new Error("Database connection does not support transactions");
    }

    await this.connection.beginTransaction();

    try {
      const result = await this.execute();
      if (callback) {
        await callback(result);
      }
      await this.connection.commit();
      return result;
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  /**
   * Execute query with profiling
   * @returns {Promise<Object>} Query result with profiling info
   */
  async executeWithProfiling() {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const { sql, bindings } = this.toSQL();

    try {
      const result = await this.execute();
      const endTime = Date.now();
      const endMemory = process.memoryUsage();

      return {
        result,
        profile: {
          sql,
          bindings,
          timing: {
            startTime,
            endTime,
            duration: endTime - startTime,
          },
          memory: {
            start: startMemory,
            end: endMemory,
            diff: {
              rss: endMemory.rss - startMemory.rss,
              heapTotal: endMemory.heapTotal - startMemory.heapTotal,
              heapUsed: endMemory.heapUsed - startMemory.heapUsed,
              external: endMemory.external - startMemory.external,
            },
          },
        },
      };
    } catch (error) {
      const endTime = Date.now();
      throw {
        error,
        profile: {
          sql,
          bindings,
          timing: {
            startTime,
            endTime,
            duration: endTime - startTime,
          },
        },
      };
    }
  }
}
/**
 * Dialect adapter for handling database-specific SQL syntax
 */
class DialectAdapter {
  constructor(dialect) {
    this.dialect = dialect.toLowerCase();
  }

  /**
   * Quote identifier based on dialect
   * @param {string} identifier - Identifier to quote
   * @returns {string} Quoted identifier
   */
  quoteIdentifier(identifier) {
    // Handle raw expressions or already quoted identifiers
    if (
      identifier.includes("(") ||
      identifier.includes(")") ||
      identifier.includes(" as ") ||
      identifier.includes("`") ||
      identifier.includes('"') ||
      identifier.includes("[") ||
      identifier.includes("]")
    ) {
      return identifier;
    }

    // Handle qualified identifiers
    if (identifier.includes(".")) {
      return identifier
        .split(".")
        .map((part) => this._quoteIdentifierPart(part))
        .join(".");
    }

    return this._quoteIdentifierPart(identifier);
  }

  /**
   * Internal method to quote a single identifier part
   * @param {string} identifier - Identifier part to quote
   * @returns {string} Quoted identifier part
   * @private
   */
  _quoteIdentifierPart(identifier) {
    identifier = identifier.trim();

    // Return if already quoted
    if (
      (identifier.startsWith("`") && identifier.endsWith("`")) ||
      (identifier.startsWith('"') && identifier.endsWith('"')) ||
      (identifier.startsWith("[") && identifier.endsWith("]"))
    ) {
      return identifier;
    }

    switch (this.dialect) {
      case "mysql":
      case "mariadb":
      case "clickhouse":
        return `\`${identifier}\``;

      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
      case "sqlite":
      case "sqlite3":
        return `"${identifier}"`;

      case "mssql":
      case "sqlserver":
        return `[${identifier}]`;

      case "oracle":
        return `"${identifier.toUpperCase()}"`;

      default:
        console.warn(
          `Unsupported dialect: ${this.dialect}, returning unquoted identifier`,
        );
        return identifier;
    }
  }

  /**
   * Get parameter placeholder for the current dialect
   * @param {number} index - Parameter index (1-based)
   * @returns {string} Parameter placeholder
   */
  getParameterPlaceholder(index) {
    switch (this.dialect) {
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return `$${index}`;
      case "mssql":
      case "sqlserver":
        return `@p${index}`;
      case "oracle":
        return `:p${index}`;
      default:
        return "?";
    }
  }

  /**
   * Build LIMIT/OFFSET clause with dialect-specific syntax
   * @param {number|null} limit - Limit value
   * @param {number|null} offset - Offset value
   * @returns {string} LIMIT/OFFSET clause
   */
  buildLimitOffset(limit, offset) {
    let clause = "";

    if (this.dialect === "mssql" || this.dialect === "sqlserver") {
      // SQL Server uses OFFSET/FETCH syntax
      if (offset !== null) {
        clause += ` OFFSET ${offset} ROWS`;
      }
      if (limit !== null) {
        if (offset !== null) {
          clause += ` FETCH NEXT ${limit} ROWS ONLY`;
        } else {
          clause += ` FETCH FIRST ${limit} ROWS ONLY`;
        }
      }
    } else if (this.dialect === "oracle") {
      // Oracle uses FETCH FIRST syntax
      if (limit !== null) {
        const limitValue = limit;
        const offsetValue = offset || 0;
        if (offsetValue > 0) {
          clause = ` OFFSET ${offsetValue} ROWS FETCH NEXT ${limitValue} ROWS ONLY`;
        } else {
          clause = ` FETCH FIRST ${limitValue} ROWS ONLY`;
        }
      }
    } else {
      // Standard SQL syntax for MySQL, PostgreSQL, SQLite, etc.
      if (limit !== null) {
        clause += ` LIMIT ${limit}`;
      }
      if (offset !== null) {
        clause += ` OFFSET ${offset}`;
      }
    }

    return clause;
  }

  /**
   * Get random function for the current dialect
   * @returns {string} Random function name
   */
  getRandomFunction() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
        return "RAND()";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
      case "sqlite":
      case "sqlite3":
        return "RANDOM()";
      case "mssql":
      case "sqlserver":
        return "NEWID()";
      case "oracle":
        return "DBMS_RANDOM.VALUE";
      case "clickhouse":
        return "rand()";
      default:
        return "RAND()";
    }
  }

  /**
   * Check if RETURNING clause is supported
   * @returns {boolean} True if RETURNING is supported
   */
  supportsReturning() {
    return [
      "postgresql",
      "postgres",
      "pg",
      "cockroachdb",
      "cockroach",
      "oracle",
    ].includes(this.dialect);
  }

  /**
   * Check if WITH clause (CTE) is supported
   * @returns {boolean} True if WITH clause is supported
   */
  supportsWithClause() {
    return [
      "postgresql",
      "postgres",
      "pg",
      "cockroachdb",
      "cockroach",
      "mssql",
      "sqlserver",
      "oracle",
    ].includes(this.dialect);
  }

  /**
   * Get current timestamp function
   * @returns {string} Current timestamp function
   */
  getCurrentTimestamp() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
        return "NOW()";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return "CURRENT_TIMESTAMP";
      case "sqlite":
      case "sqlite3":
        return "CURRENT_TIMESTAMP";
      case "mssql":
      case "sqlserver":
        return "GETDATE()";
      case "oracle":
        return "SYSDATE";
      case "clickhouse":
        return "now()";
      default:
        return "NOW()";
    }
  }

  /**
   * Get auto-increment keyword
   * @returns {string} Auto-increment keyword
   */
  getAutoIncrementKeyword() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
        return "AUTO_INCREMENT";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return "SERIAL";
      case "sqlite":
      case "sqlite3":
        return "AUTOINCREMENT";
      case "mssql":
      case "sqlserver":
        return "IDENTITY(1,1)";
      case "oracle":
        return "GENERATED BY DEFAULT AS IDENTITY";
      default:
        return "AUTO_INCREMENT";
    }
  }

  /**
   * Get boolean true value
   * @returns {string} Boolean true value
   */
  getBooleanTrue() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
      case "sqlite":
      case "sqlite3":
        return "1";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return "TRUE";
      case "mssql":
      case "sqlserver":
        return "1";
      case "oracle":
        return "1";
      case "clickhouse":
        return "1";
      default:
        return "1";
    }
  }

  /**
   * Get boolean false value
   * @returns {string} Boolean false value
   */
  getBooleanFalse() {
    switch (this.dialect) {
      case "mysql":
      case "mariadb":
      case "sqlite":
      case "sqlite3":
        return "0";
      case "postgresql":
      case "postgres":
      case "pg":
      case "cockroachdb":
      case "cockroach":
        return "FALSE";
      case "mssql":
      case "sqlserver":
        return "0";
      case "oracle":
        return "0";
      case "clickhouse":
        return "0";
      default:
        return "0";
    }
  }
}

export default QueryBuilder;
