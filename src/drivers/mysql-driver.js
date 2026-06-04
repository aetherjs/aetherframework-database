/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/mysql-driver
 */
import mysql from "mysql2/promise";

class MySQLDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  /** 创建单个连接（修正版：不要混入 pool 参数） */
  async connect(config = this.config) {
    const connConfig = {
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      charset: config.charset || "utf8mb4",
      timezone: config.timezone || "+00:00",
      connectTimeout: config.connectTimeout || 10000,
      // 只保留单连接需要的参数
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    };

    return await mysql.createConnection(connConfig);
  }

  /** 创建连接池 */
  async createPool(config = this.config) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
      charset: config.charset || "utf8mb4",
      timezone: config.timezone || "+00:00",
      waitForConnections: true,
      connectionLimit: config.pool?.max || 10,
      queueLimit: config.pool?.queueLimit || 0,
      idleTimeout: config.pool?.idleTimeout || 30000,
      acquireTimeout: config.pool?.acquireTimeout || 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    });
    return this.pool;
  }

  /** SELECT 查询 */
  async query(connection, sql, params = []) {
    const validatedParams = this._validateAndPrepareParams(sql, params);
    const [rows, fields] = await connection.execute(sql, validatedParams);
    return {
      rows,
      fields,
      rowCount: rows.length,
      insertId: null, // SELECT 不会有 insertId
    };
  }

  /** INSERT/UPDATE/DELETE */
  async execute(connection, sql, params = []) {
    const validatedParams = this._validateAndPrepareParams(sql, params);

    const [result] = await connection.execute(sql, validatedParams);

    return {
      affectedRows: result.affectedRows || 0,
      insertId: result.insertId || null,
      changedRows: result.changedRows || 0,
    };
  }

  // mysql-driver.js中的_validateAndPrepareParams方法
  _validateAndPrepareParams(sql, params) {
    // 确保参数是数组
    if (!Array.isArray(params)) {
      console.warn("[MySQLDriver] params 不是数组，已强制转换", params);
      params = [];
    }

    // 过滤 undefined（mysql2 最容易出问题的点）
    const filteredParams = params.map((p) => (p === undefined ? null : p));

    // 计算SQL中的占位符数量
    const placeholderCount = (sql.match(/\?/g) || []).length;

    // 验证参数数量
    if (filteredParams.length !== placeholderCount) {
      console.error(
        `[MySQLDriver] 参数数量不匹配！SQL有 ${placeholderCount} 个占位符，但提供了 ${filteredParams.length} 个参数`,
      );
      console.error(`[MySQLDriver] SQL: ${sql}`);
      console.error(`[MySQLDriver] Params:`, filteredParams);

      // 如果参数不足，用null填充
      if (filteredParams.length < placeholderCount) {
        const missingCount = placeholderCount - filteredParams.length;
        console.warn(`[MySQLDriver] 缺少 ${missingCount} 个参数，用null填充`);
        for (let i = 0; i < missingCount; i++) {
          filteredParams.push(null);
        }
      }
      // 如果参数过多，截断
      else if (filteredParams.length > placeholderCount) {
        console.warn(`[MySQLDriver] 参数过多，截断为 ${placeholderCount} 个`);
        filteredParams.length = placeholderCount;
      }
    }

    return filteredParams;
  }

  /** 确保 params 一定是数组（保持向后兼容） */
  _ensureArray(params) {
    if (!Array.isArray(params)) {
      console.warn("[MySQLDriver] params 不是数组，已强制转换", params);
      return [];
    }
    // 过滤 undefined（mysql2 最容易出问题的点）
    return params.map((p) => (p === undefined ? null : p));
  }

  async beginTransaction(connection) {
    await connection.beginTransaction();
  }

  async commitTransaction(connection) {
    await connection.commit();
  }

  async rollbackTransaction(connection) {
    await connection.rollback();
  }

  async close(connection) {
    await connection.end();
  }

  async closePool(pool) {
    await pool.end();
  }

  getPoolStats(pool) {
    return {
      totalConnections: pool._allConnections?.length || 0,
      activeConnections: pool._acquiringConnections?.length || 0,
      idleConnections: pool._freeConnections?.length || 0,
      waitingClients: pool._connectionQueue?.length || 0,
    };
  }

  async healthCheck(connection) {
    const [rows] = await connection.execute("SELECT 1 as health");
    return rows.health === 1;
  }
}

export default MySQLDriver;
