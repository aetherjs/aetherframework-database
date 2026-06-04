/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/redis-driver
 */
import redis from 'redis';

class RedisDriver {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  async connect(config) {
    this.client = redis.createClient({
      socket: {
        host: config.host,
        port: config.port
      },
      password: config.password,
      database: config.db || 0
    });
    
    await this.client.connect();
    return this.client;
  }

  async query(connection, command, ...args) {
    const result = await connection.sendCommand([command, ...args]);
    return { result };
  }

  async execute(connection, command, ...args) {
    return this.query(connection, command, ...args);
  }

  async close(connection) {
    await connection.quit();
  }

  async healthCheck(connection) {
    try {
      const result = await connection.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

export default RedisDriver;
