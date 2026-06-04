/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/TransactionManager
 */

class TransactionManager {
  constructor(driver) {
    this.driver = driver;
  }

  async transaction(callback) {
    const connection = await this.driver.pool.getConnection();
    try {
      await this.driver.beginTransaction(connection);
 
      const trx = {
        query: (sql, params) => this.driver.query(connection, sql, params),
        rawQuery: (sql) => this.driver.rawQuery(connection, sql),   
        execute: (sql, params) => this.driver.execute(connection, sql, params),
      };

      const result = await callback(trx);

      await this.driver.commitTransaction(connection);

      return result;

    } catch (error) {

      await this.driver.rollbackTransaction(connection).catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
}

export default TransactionManager;