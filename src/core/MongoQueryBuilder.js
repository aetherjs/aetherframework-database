/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/core/MongoQueryBuilder
 */

import EventEmitter from 'events';

/**
 * MongoDB 查询构建器
 * 专为 MongoDB 文档数据库设计的链式查询构建器
 */
class MongoQueryBuilder extends EventEmitter {
  /**
   * 构造函数
   * @param {string} collectionName - 集合名称
   * @param {MongoDBDriver} driver - MongoDB 驱动实例
   * @param {object} connection - MongoDB 连接
   */
  constructor(collectionName, driver, connection) {
    super();
    this.collectionName = collectionName;
    this.driver = driver;
    this.connection = connection;
    
    // 查询状态
    this.query = {
      type: 'find', // find, aggregate, count, distinct, etc.
      filter: {},
      projection: {},
      sort: {},
      skip: 0,
      limit: 0,
      options: {},
      pipeline: [],
      update: {},
      aggregation: []
    };
    
    // 操作统计
    this.stats = {
      executionTime: 0,
      documentsExamined: 0,
      documentsReturned: 0
    };
  }

  /**
   * 设置查询过滤器
   * @param {object|string} field - 字段名或查询对象
   * @param {*} operator - 操作符或值
   * @param {*} value - 值（当 operator 为操作符时）
   * @returns {MongoQueryBuilder}
   */
  where(field, operator, value) {
    if (typeof field === 'object') {
      // 直接传入查询对象
      Object.assign(this.query.filter, field);
    } else if (value === undefined) {
      // where('field', value) 简写，默认为相等
      this.query.filter[field] = operator;
    } else {
      // where('field', 'operator', value)
      if (!this.query.filter[field]) {
        this.query.filter[field] = {};
      }
      this.query.filter[field][`$${operator}`] = value;
    }
    return this;
  }

  /**
   * 等于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  eq(field, value) {
    return this.where(field, value);
  }

  /**
   * 不等于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  ne(field, value) {
    return this.where(field, 'ne', value);
  }

  /**
   * 大于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  gt(field, value) {
    return this.where(field, 'gt', value);
  }

  /**
   * 大于等于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  gte(field, value) {
    return this.where(field, 'gte', value);
  }

  /**
   * 小于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  lt(field, value) {
    return this.where(field, 'lt', value);
  }

  /**
   * 小于等于条件
   * @param {string} field - 字段名
   * @param {*} value - 值
   * @returns {MongoQueryBuilder}
   */
  lte(field, value) {
    return this.where(field, 'lte', value);
  }

  /**
   * IN 条件
   * @param {string} field - 字段名
   * @param {Array} values - 值数组
   * @returns {MongoQueryBuilder}
   */
  in(field, values) {
    return this.where(field, 'in', values);
  }

  /**
   * NOT IN 条件
   * @param {string} field - 字段名
   * @param {Array} values - 值数组
   * @returns {MongoQueryBuilder}
   */
  nin(field, values) {
    return this.where(field, 'nin', values);
  }

  /**
   * 正则表达式匹配
   * @param {string} field - 字段名
   * @param {string|RegExp} pattern - 正则表达式
   * @param {string} options - 选项（如 'i' 忽略大小写）
   * @returns {MongoQueryBuilder}
   */
  regex(field, pattern, options = '') {
    this.query.filter[field] = { $regex: pattern, $options: options };
    return this;
  }

  /**
   * 文本搜索
   * @param {string} search - 搜索文本
   * @param {string} language - 语言（可选）
   * @returns {MongoQueryBuilder}
   */
  text(search, language = null) {
    this.query.filter.$text = { $search: search };
    if (language) {
      this.query.filter.$text.$language = language;
    }
    return this;
  }

  /**
   * 选择返回字段
   * @param {...string} fields - 字段名
   * @returns {MongoQueryBuilder}
   */
  select(...fields) {
    fields.forEach(field => {
      if (field.startsWith('-')) {
        // 排除字段
        this.query.projection[field.substring(1)] = 0;
      } else {
        // 包含字段
        this.query.projection[field] = 1;
      }
    });
    return this;
  }

  /**
   * 排序
   * @param {string|object} field - 字段名或排序对象
   * @param {number} direction - 方向：1 升序，-1 降序
   * @returns {MongoQueryBuilder}
   */
  orderBy(field, direction = 1) {
    if (typeof field === 'object') {
      Object.assign(this.query.sort, field);
    } else {
      this.query.sort[field] = direction;
    }
    return this;
  }

  /**
   * 跳过文档数
   * @param {number} skip - 跳过的文档数
   * @returns {MongoQueryBuilder}
   */
  skip(skip) {
    this.query.skip = skip;
    return this;
  }

  /**
   * 限制返回文档数
   * @param {number} limit - 限制数量
   * @returns {MongoQueryBuilder}
   */
  limit(limit) {
    this.query.limit = limit;
    return this;
  }

  /**
   * 设置查询选项
   * @param {object} options - MongoDB 查询选项
   * @returns {MongoQueryBuilder}
   */
  options(options) {
    Object.assign(this.query.options, options);
    return this;
  }

  /**
   * 聚合管道阶段
   * @param {object} stage - 聚合阶段
   * @returns {MongoQueryBuilder}
   */
  pipeline(stage) {
    this.query.pipeline.push(stage);
    return this;
  }

  /**
   * 匹配阶段
   * @param {object} filter - 过滤条件
   * @returns {MongoQueryBuilder}
   */
  match(filter) {
    return this.pipeline({ $match: filter });
  }

  /**
   * 分组阶段
   * @param {object} group - 分组条件
   * @returns {MongoQueryBuilder}
   */
  group(group) {
    return this.pipeline({ $group: group });
  }

  /**
   * 排序阶段
   * @param {object} sort - 排序条件
   * @returns {MongoQueryBuilder}
   */
  sortAgg(sort) {
    return this.pipeline({ $sort: sort });
  }

  /**
   * 限制阶段
   * @param {number} limit - 限制数量
   * @returns {MongoQueryBuilder}
   */
  limitAgg(limit) {
    return this.pipeline({ $limit: limit });
  }

  /**
   * 跳过阶段
   * @param {number} skip - 跳过数量
   * @returns {MongoQueryBuilder}
   */
  skipAgg(skip) {
    return this.pipeline({ $skip: skip });
  }

  /**
   * 项目阶段
   * @param {object} project - 投影条件
   * @returns {MongoQueryBuilder}
   */
  project(project) {
    return this.pipeline({ $project: project });
  }

  /**
   * 查找文档
   * @returns {Promise<Array>}
   */
  async find() {
    this.query.type = 'find';
    const startTime = Date.now();
    
    try {
      const result = await this.driver.query(
        this.connection,
        this.collectionName,
        this.query.filter,
        {
          projection: this.query.projection,
          sort: this.query.sort,
          skip: this.query.skip,
          limit: this.query.limit,
          ...this.query.options
        }
      );
      
      this.stats.executionTime = Date.now() - startTime;
      this.stats.documentsReturned = result.rows.length;
      
      return result.rows;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 查找单个文档
   * @returns {Promise<object|null>}
   */
  async findOne() {
    this.query.type = 'findOne';
    this.query.limit = 1;
    
    const results = await this.find();
    return results || null;
  }

  /**
   * 执行聚合查询
   * @returns {Promise<Array>}
   */
  async aggregate() {
    this.query.type = 'aggregate';
    const startTime = Date.now();
    
    try {
      const collection = this.connection.collection(this.collectionName);
      const cursor = collection.aggregate(this.query.pipeline);
      const rows = await cursor.toArray();
      
      this.stats.executionTime = Date.now() - startTime;
      this.stats.documentsReturned = rows.length;
      
      return rows;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 计数
   * @returns {Promise<number>}
   */
  async count() {
    this.query.type = 'count';
    const startTime = Date.now();
    
    try {
      const collection = this.connection.collection(this.collectionName);
      const count = await collection.countDocuments(this.query.filter, this.query.options);
      
      this.stats.executionTime = Date.now() - startTime;
      return count;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 去重
   * @param {string} field - 字段名
   * @returns {Promise<Array>}
   */
  async distinct(field) {
    this.query.type = 'distinct';
    const startTime = Date.now();
    
    try {
      const collection = this.connection.collection(this.collectionName);
      const values = await collection.distinct(field, this.query.filter, this.query.options);
      
      this.stats.executionTime = Date.now() - startTime;
      return values;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 插入文档
   * @param {object|Array} data - 要插入的数据
   * @returns {Promise<object>}
   */
  async insert(data) {
    this.query.type = 'insert';
    const startTime = Date.now();
    
    try {
      const result = await this.driver.execute(
        this.connection,
        this.collectionName,
        'insert',
        data,
        this.query.options
      );
      
      this.stats.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 更新文档
   * @param {object} filter - 过滤条件
   * @param {object} update - 更新操作
   * @param {object} options - 更新选项
   * @returns {Promise<object>}
   */
  async update(filter, update, options = {}) {
    this.query.type = 'update';
    const startTime = Date.now();
    
    try {
      const result = await this.driver.execute(
        this.connection,
        this.collectionName,
        'update',
        { filter, update },
        { ...this.query.options, ...options }
      );
      
      this.stats.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 删除文档
   * @param {object} filter - 过滤条件
   * @param {object} options - 删除选项
   * @returns {Promise<object>}
   */
  async delete(filter, options = {}) {
    this.query.type = 'delete';
    const startTime = Date.now();
    
    try {
      const result = await this.driver.execute(
        this.connection,
        this.collectionName,
        'delete',
        { filter },
        { ...this.query.options, ...options }
      );
      
      this.stats.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 批量插入
   * @param {Array} documents - 文档数组
   * @returns {Promise<object>}
   */
  async insertMany(documents) {
    const collection = this.connection.collection(this.collectionName);
    const result = await collection.insertMany(documents, this.query.options);
    return result;
  }

  /**
   * 批量更新
   * @param {object} filter - 过滤条件
   * @param {object} update - 更新操作
   * @param {object} options - 更新选项
   * @returns {Promise<object>}
   */
  async updateMany(filter, update, options = {}) {
    const collection = this.connection.collection(this.collectionName);
    const result = await collection.updateMany(filter, update, { ...this.query.options, ...options });
    return result;
  }

  /**
   * 批量删除
   * @param {object} filter - 过滤条件
   * @param {object} options - 删除选项
   * @returns {Promise<object>}
   */
  async deleteMany(filter, options = {}) {
    const collection = this.connection.collection(this.collectionName);
    const result = await collection.deleteMany(filter, { ...this.query.options, ...options });
    return result;
  }

  /**
   * 获取查询统计信息
   * @returns {object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置查询状态
   * @returns {MongoQueryBuilder}
   */
  reset() {
    this.query = {
      type: 'find',
      filter: {},
      projection: {},
      sort: {},
      skip: 0,
      limit: 0,
      options: {},
      pipeline: [],
      update: {},
      aggregation: []
    };
    this.stats = {
      executionTime: 0,
      documentsExamined: 0,
      documentsReturned: 0
    };
    return this;
  }

  /**
   * 获取构建的查询对象（用于调试）
   * @returns {object}
   */
  toQuery() {
    return {
      collection: this.collectionName,
      ...this.query
    };
  }
}

export default MongoQueryBuilder;
