/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/oracle-driver
 */
import oracledb from 'oracledb';

class OracleDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async connect(config) {
    const connection = await oracledb.getConnection({
      user: config.user,
      password: config.password,
      connectString: config.connectString || `${config.host}:${config.port}/${config.serviceName}`,
      poolMin: config.pool?.min || 2,
      poolMax: config.pool?.max || 10,
      poolIncrement: 1,
      poolTimeout: config.pool?.idleTimeout || 30000,
      queueTimeout: config.pool?.acquireTimeout || 10000
    });
    return connection;
  }

  async createPool(config) {
    await oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString || `${config.host}:${config.port}/${config.serviceName}`,
      poolMin: config.pool?.min || 2,
      poolMax: config.pool?.max || 10,
      poolIncrement: 1,
      poolTimeout: config.pool?.idleTimeout || 30000,
      queueTimeout: config.pool?.acquireTimeout || 10000
    });
    this.pool = oracledb.getPool();
    return this.pool;
  }

  async query(connection, sql, params = []) {
    const options = {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    };
    
    const result = await connection.execute(sql, params, options);
    return {
      rows: result.rows,
      rowCount: result.rows?.length || 0,
      metaData: result.metaData,
      outBinds: result.outBinds
    };
  }

  async execute(connection, sql, params = []) {
    const result = await connection.execute(sql, params, { autoCommit: false });
    return {
      rowsAffected: result.rowsAffected,
      lastRowid: result.lastRowid,
      outBinds: result.outBinds
    };
  }

  async beginTransaction(connection) {
    // Oracle automatically starts a transaction when DML is executed
    return connection;
  }

  async commitTransaction(connection) {
    await connection.commit();
  }

  async rollbackTransaction(connection) {
    await connection.rollback();
  }

  async close(connection) {
    await connection.close();
  }

  async closePool(pool) {
    await pool.close();
  }

  getPoolStats(pool) {
    return {
      connectionsInUse: pool.connectionsInUse,
      connectionsOpen: pool.connectionsOpen
    };
  }

  async healthCheck(connection) {
    const result = await connection.execute('SELECT 1 as health FROM DUAL');
    return result.rows.HEALTH === 1;
  }
}

export default OracleDriver;
