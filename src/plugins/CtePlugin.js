/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/CtePlugin
 */
import { BasePlugin } from "./BasePlugin.js";

/**
 * Common Table Expression Plugin - Manages CTE construction and correctly adds WITH clause when generating SQL
 */
export class CtePlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "CtePlugin";
  }

  _registerMethods() {
    // Register CTE methods to QueryBuilder
    this.queryBuilder.with = this.with.bind(this);
    this.queryBuilder.withRecursive = this.withRecursive.bind(this);
    this.queryBuilder.fromCte = this.fromCte.bind(this);
  }

  /**
   * Define a Common Table Expression (CTE)
   * @param {string} name - CTE name
   * @param {Function} callback - CTE query callback
   * @param {Array} columns - CTE column names
   * @returns {QueryBuilder} QueryBuilder instance
   */
  with(name, callback, columns = []) {
    const cteQuery = new this.queryBuilder.constructor("", this.queryBuilder.connection, this.queryBuilder.dialect);
    callback(cteQuery);
    const { sql, bindings } = cteQuery.toSQL();

    this.queryBuilder.query.cte.push({
      name,
      sql,
      columns,
      recursive: false,
    });

    this.queryBuilder.bindings.unshift(...bindings);
    return this.queryBuilder;
  }

  /**
   * Define a Recursive Common Table Expression (CTE)
   * @param {string} name - CTE name
   * @param {Function} anchorCallback - Anchor query callback
   * @param {Function} recursiveCallback - Recursive query callback
   * @param {Array} columns - CTE column names
   * @returns {QueryBuilder} QueryBuilder instance
   */
  withRecursive(name, anchorCallback, recursiveCallback, columns = []) {
    const anchorQuery = new this.queryBuilder.constructor("", this.queryBuilder.connection, this.queryBuilder.dialect);
    anchorCallback(anchorQuery);
    const { sql: anchorSql, bindings: anchorBindings } = anchorQuery.toSQL();

    const recursiveQuery = new this.queryBuilder.constructor("", this.queryBuilder.connection, this.queryBuilder.dialect);
    recursiveCallback(recursiveQuery);
    const { sql: recursiveSql, bindings: recursiveBindings } = recursiveQuery.toSQL();

    const cteSql = `${anchorSql} UNION ALL ${recursiveSql}`;

    this.queryBuilder.query.cte.push({
      name,
      sql: cteSql,
      columns,
      recursive: true,
    });

    this.queryBuilder.bindings.unshift(...anchorBindings, ...recursiveBindings);
    return this.queryBuilder;
  }

  /**
   * Use CTE in FROM clause
   * @param {string} cteName - CTE name
   * @param {string} alias - Table alias
   * @returns {QueryBuilder} QueryBuilder instance
   */
  fromCte(cteName, alias = null) {
    const tableName = alias ? `${cteName} as ${alias}` : cteName;
    this.queryBuilder.tableName = tableName;
    return this.queryBuilder;
  }

  /**
   * Build CTE clause
   * @returns {string} CTE SQL fragment
   */
  buildCteClause() {
    if (this.queryBuilder.query.cte.length === 0) {
      return "";
    }

    const cteClauses = this.queryBuilder.query.cte.map((cte) => {
      const columns = cte.columns.length > 0 ? `(${cte.columns.join(", ")})` : "";
      const recursive = cte.recursive ? "RECURSIVE " : "";
      return `${recursive}${cte.name}${columns} AS (${cte.sql})`;
    });

    return `WITH ${cteClauses.join(", ")} `;
  }

  /**
   * Check if database supports CTE
   * @returns {boolean} Whether supported
   */
  isCteSupported() {
    const supportedDialects = [
      "postgresql",
      "postgres",
      "pg",
      "mysql", // MySQL 8.0+
      "mariadb", // MariaDB 10.2+
      "sqlite", // SQLite 3.8.3+
      "mssql", // SQL Server 2005+
      "sqlserver",
      "cockroachdb",
      "cockroach",
    ];

    return supportedDialects.includes(this.queryBuilder.dialect);
  }

  /**
   * Check if database supports recursive CTE
   * @returns {boolean} Whether supported
   */
  isRecursiveCteSupported() {
    const supportedDialects = [
      "postgresql",
      "postgres",
      "pg",
      "mysql", // MySQL 8.0+
      "mariadb", // MariaDB 10.2+
      "sqlite", // SQLite 3.8.3+
      "mssql", // SQL Server 2005+
      "sqlserver",
      "cockroachdb",
      "cockroach",
    ];

    return supportedDialects.includes(this.queryBuilder.dialect);
  }

  /**
   * Create hierarchical query (common use case for recursive CTE)
   * @param {string} idColumn - ID column name
   * @param {string} parentColumn - Parent ID column name
   * @param {string} levelColumn - Level column name (default: 'level')
   * @param {string} pathColumn - Path column name (default: 'path')
   * @returns {QueryBuilder} QueryBuilder instance
   */
  hierarchical(idColumn = "id", parentColumn = "parent_id", levelColumn = "level", pathColumn = "path") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Hierarchical queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "hierarchy";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(
            `${idColumn}`,
            `${parentColumn}`,
            `1 as ${levelColumn}`,
            `${idColumn}::text as ${pathColumn}`
          )
          .whereNull(parentColumn);
      },
      (recursive) => {
        recursive
          .select(
            `t.${idColumn}`,
            `t.${parentColumn}`,
            `h.${levelColumn} + 1 as ${levelColumn}`,
            `h.${pathColumn} || '.' || t.${idColumn}::text as ${pathColumn}`
          )
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${parentColumn}`, "=", `h.${idColumn}`);
      },
      [idColumn, parentColumn, levelColumn, pathColumn]
    ).fromCte(cteName);
  }

  /**
   * Create materialized path query
   * @param {string} idColumn - ID column name
   * @param {string} parentColumn - Parent ID column name
   * @param {string} nameColumn - Name column name
   * @param {string} separator - Path separator (default: '/')
   * @returns {QueryBuilder} QueryBuilder instance
   */
  materializedPath(idColumn = "id", parentColumn = "parent_id", nameColumn = "name", separator = "/") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Materialized path queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "materialized_path";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(
            `${idColumn}`,
            `${parentColumn}`,
            `${nameColumn}`,
            `CAST(${nameColumn} AS VARCHAR(1000)) as path`,
            `1 as depth`
          )
          .whereNull(parentColumn);
      },
      (recursive) => {
        recursive
          .select(
            `t.${idColumn}`,
            `t.${parentColumn}`,
            `t.${nameColumn}`,
            `CONCAT(h.path, '${separator}', t.${nameColumn}) as path`,
            `h.depth + 1 as depth`
          )
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${parentColumn}`, "=", `h.${idColumn}`);
      },
      [idColumn, parentColumn, nameColumn, "path", "depth"]
    ).fromCte(cteName);
  }

  /**
   * Create organizational chart query
   * @param {string} idColumn - ID column name
   * @param {string} parentColumn - Parent ID column name
   * @param {string} nameColumn - Name column name
   * @param {string} titleColumn - Title column name
   * @returns {QueryBuilder} QueryBuilder instance
   */
  orgChart(idColumn = "id", parentColumn = "parent_id", nameColumn = "name", titleColumn = "title") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Organizational chart queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "org_chart";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(
            `${idColumn}`,
            `${parentColumn}`,
            `${nameColumn}`,
            `${titleColumn}`,
            `1 as level`,
            `CAST(${nameColumn} AS VARCHAR(1000)) as hierarchy_path`
          )
          .whereNull(parentColumn);
      },
      (recursive) => {
        recursive
          .select(
            `t.${idColumn}`,
            `t.${parentColumn}`,
            `t.${nameColumn}`,
            `t.${titleColumn}`,
            `h.level + 1 as level`,
            `CONCAT(h.hierarchy_path, ' > ', t.${nameColumn}) as hierarchy_path`
          )
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${parentColumn}`, "=", `h.${idColumn}`);
      },
      [idColumn, parentColumn, nameColumn, titleColumn, "level", "hierarchy_path"]
    ).fromCte(cteName);
  }

  /**
   * Create bill of materials (BOM) query
   * @param {string} componentIdColumn - Component ID column name
   * @param {string} parentComponentIdColumn - Parent component ID column name
   * @param {string} quantityColumn - Quantity column name
   * @param {string} costColumn - Cost column name
   * @returns {QueryBuilder} QueryBuilder instance
   */
  billOfMaterials(componentIdColumn = "component_id", parentComponentIdColumn = "parent_component_id", quantityColumn = "quantity", costColumn = "cost") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Bill of materials queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "bom";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(
            `${componentIdColumn}`,
            `${parentComponentIdColumn}`,
            `${quantityColumn}`,
            `${costColumn}`,
            `${quantityColumn} as total_quantity`,
            `${costColumn} as total_cost`,
            `1 as level`
          )
          .whereNull(parentComponentIdColumn);
      },
      (recursive) => {
        recursive
          .select(
            `t.${componentIdColumn}`,
            `t.${parentComponentIdColumn}`,
            `t.${quantityColumn}`,
            `t.${costColumn}`,
            `h.total_quantity * t.${quantityColumn} as total_quantity`,
            `h.total_cost + (h.total_quantity * t.${costColumn}) as total_cost`,
            `h.level + 1 as level`
          )
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${parentComponentIdColumn}`, "=", `h.${componentIdColumn}`);
      },
      [componentIdColumn, parentComponentIdColumn, quantityColumn, costColumn, "total_quantity", "total_cost", "level"]
    ).fromCte(cteName);
  }

  /**
   * Create category tree query
   * @param {string} categoryIdColumn - Category ID column name
   * @param {string} parentCategoryIdColumn - Parent category ID column name
   * @param {string} categoryNameColumn - Category name column name
   * @param {string} sortOrderColumn - Sort order column name
   * @returns {QueryBuilder} QueryBuilder instance
   */
  categoryTree(categoryIdColumn = "category_id", parentCategoryIdColumn = "parent_category_id", categoryNameColumn = "category_name", sortOrderColumn = "sort_order") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Category tree queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "category_tree";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(
            `${categoryIdColumn}`,
            `${parentCategoryIdColumn}`,
            `${categoryNameColumn}`,
            `${sortOrderColumn}`,
            `CAST(${categoryNameColumn} AS VARCHAR(1000)) as full_path`,
            `1 as depth`
          )
          .whereNull(parentCategoryIdColumn)
          .orderBy(sortOrderColumn);
      },
      (recursive) => {
        recursive
          .select(
            `t.${categoryIdColumn}`,
            `t.${parentCategoryIdColumn}`,
            `t.${categoryNameColumn}`,
            `t.${sortOrderColumn}`,
            `CONCAT(h.full_path, ' > ', t.${categoryNameColumn}) as full_path`,
            `h.depth + 1 as depth`
          )
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${parentCategoryIdColumn}`, "=", `h.${categoryIdColumn}`)
          .orderBy(sortOrderColumn);
      },
      [categoryIdColumn, parentCategoryIdColumn, categoryNameColumn, sortOrderColumn, "full_path", "depth"]
    ).fromCte(cteName);
  }

  /**
   * Create graph traversal query (for adjacency lists)
   * @param {string} nodeIdColumn - Node ID column name
   * @param {string} edgeColumn - Edge column name
   * @param {string} costColumn - Cost column name (optional)
   * @returns {QueryBuilder} QueryBuilder instance
   */
  graphTraversal(nodeIdColumn = "node_id", edgeColumn = "edge_to", costColumn = null) {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Graph traversal queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "graph_traversal";

    const anchorSelect = [
      `${nodeIdColumn}`,
      `${edgeColumn}`,
      `0 as distance`,
      `CAST(${nodeIdColumn} AS VARCHAR(1000)) as path`
    ];

    const recursiveSelect = [
      `t.${nodeIdColumn}`,
      `t.${edgeColumn}`,
      `h.distance + 1 as distance`,
      `CONCAT(h.path, ' -> ', t.${nodeIdColumn}) as path`
    ];

    if (costColumn) {
      anchorSelect.push(`${costColumn} as total_cost`);
      recursiveSelect.push(`h.total_cost + t.${costColumn} as total_cost`);
    }

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor
          .select(...anchorSelect)
          .where(`${edgeColumn}`, "=", this.queryBuilder.bindings || null);
      },
      (recursive) => {
        recursive
          .select(...recursiveSelect)
          .from(`${this.queryBuilder.tableName} as t`)
          .join(`${cteName} as h`, `t.${nodeIdColumn}`, "=", `h.${edgeColumn}`);
      },
      costColumn 
        ? [nodeIdColumn, edgeColumn, "distance", "path", "total_cost"]
        : [nodeIdColumn, edgeColumn, "distance", "path"]
    ).fromCte(cteName);
  }

  /**
   * Create number sequence CTE
   * @param {number} start - Start number
   * @param {number} end - End number
   * @param {number} step - Step size (default: 1)
   * @param {string} columnName - Column name for sequence (default: 'n')
   * @returns {QueryBuilder} QueryBuilder instance
   */
  numberSequence(start = 1, end = 10, step = 1, columnName = "n") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Number sequence queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "numbers";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor.selectRaw(`${start} as ${columnName}`);
      },
      (recursive) => {
        recursive
          .selectRaw(`${columnName} + ${step} as ${columnName}`)
          .fromCte(cteName)
          .where(columnName, "<", end);
      },
      [columnName]
    ).fromCte(cteName);
  }

  /**
   * Create date range CTE
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {string} dateColumn - Date column name (default: 'date')
   * @returns {QueryBuilder} QueryBuilder instance
   */
  dateRange(startDate, endDate, dateColumn = "date") {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Date range queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "dates";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor.selectRaw(`'${startDate}'::date as ${dateColumn}`);
      },
      (recursive) => {
        recursive
          .selectRaw(`${dateColumn} + INTERVAL '1 day' as ${dateColumn}`)
          .fromCte(cteName)
          .where(dateColumn, "<", endDate);
      },
      [dateColumn]
    ).fromCte(cteName);
  }

  /**
   * Create calendar CTE
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {QueryBuilder} QueryBuilder instance
   */
  calendar(startDate, endDate) {
    if (!this.isRecursiveCteSupported()) {
      throw new Error("Calendar queries are only supported in databases that support recursive CTEs");
    }

    const cteName = "calendar";

    return this.withRecursive(
      cteName,
      (anchor) => {
        anchor.selectRaw(`'${startDate}'::date as date`);
      },
      (recursive) => {
        recursive
          .selectRaw("date + INTERVAL '1 day' as date")
          .fromCte(cteName)
          .where("date", "<", endDate);
      },
      ["date"]
    ).fromCte(cteName)
    .selectRaw("date")
    .selectRaw("EXTRACT(YEAR FROM date) as year")
    .selectRaw("EXTRACT(MONTH FROM date) as month")
    .selectRaw("EXTRACT(DAY FROM date) as day")
    .selectRaw("EXTRACT(DOW FROM date) as day_of_week")
    .selectRaw("EXTRACT(WEEK FROM date) as week")
    .selectRaw("EXTRACT(QUARTER FROM date) as quarter");
  }
}
