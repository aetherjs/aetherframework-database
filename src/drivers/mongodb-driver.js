/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/drivers/mongodb-driver
 */
import { MongoClient } from 'mongodb';

class MongoDBDriver {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  async connect(config) {
    const url = `mongodb://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}?authSource=${config.authSource || 'admin'}`;
    this.client = new MongoClient(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: config.pool?.max || 10,
      minPoolSize: config.pool?.min || 2,
      maxIdleTimeMS: config.pool?.idleTimeout || 30000,
      serverSelectionTimeoutMS: config.pool?.acquireTimeout || 10000
    });
    await this.client.connect();
    return this.client.db(config.database);
  }

  async query(connection, collectionName, query = {}, options = {}) {
    const collection = connection.collection(collectionName);
    const cursor = collection.find(query, options);
    const rows = await cursor.toArray();
    return { rows, rowCount: rows.length };
  }

  async execute(connection, collectionName, operation, data, options = {}) {
    const collection = connection.collection(collectionName);
    let result;
    
    switch (operation) {
      case 'insert':
        result = await collection.insertOne(data, options);
        return { insertedId: result.insertedId, insertedCount: result.insertedCount };
      case 'update':
        result = await collection.updateOne(data.filter, data.update, options);
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
      case 'delete':
        result = await collection.deleteOne(data.filter, options);
        return { deletedCount: result.deletedCount };
      default:
        throw new Error(`Unsupported MongoDB operation: ${operation}`);
    }
  }

  async beginTransaction(connection) {
    const session = this.client.startSession();
    session.startTransaction();
    return session;
  }

  async commitTransaction(session) {
    await session.commitTransaction();
    session.endSession();
  }

  async rollbackTransaction(session) {
    await session.abortTransaction();
    session.endSession();
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }

  async healthCheck(connection) {
    try {
      await connection.command({ ping: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default MongoDBDriver;
