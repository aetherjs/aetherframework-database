// test-pressure.js - 数据库压力测试脚本（集成CachePlugin版本）
import DatabaseManager from "../src/DatabaseManager.js";
import { performance } from "perf_hooks";

// 内存缓存驱动实现（用于测试）
class MemoryCacheDriver {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      size: 0,
    };
  }

  async get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return null;
    }

    this.stats.hits++;
    return item.value;
  }

  async set(key, value, ttl = 300) {
    const expiry = ttl > 0 ? Date.now() + ttl * 1000 : null;
    this.cache.set(key, { value, expiry });
    this.stats.sets++;
    this.stats.size = this.cache.size;
    return true;
  }

  async del(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  async keys(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    const keys = [];
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keys.push(key);
      }
    }
    return keys;
  }

  async clearPattern(pattern) {
    const keys = await this.keys(pattern);
    for (const key of keys) {
      await this.del(key);
    }
    return keys.length;
  }

  async clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
    this.stats.size = 0;
    return size;
  }

  async setWithTags(key, value, ttl, tags) {
    await this.set(key, value, ttl);
    // 简化版标签实现
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      const tagData = (await this.get(tagKey)) || [];
      tagData.push(key);
      await this.set(tagKey, tagData, ttl);
    }
    return true;
  }

  async clearByTags(...tags) {
    let totalDeleted = 0;
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      const keys = (await this.get(tagKey)) || [];
      for (const key of keys) {
        await this.del(key);
        totalDeleted++;
      }
      await this.del(tagKey);
    }
    return totalDeleted;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate =
      total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalKeys: this.cache.size,
    };
  }

  resetStats() {
    const oldStats = { ...this.stats };
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      size: this.cache.size,
    };
    return oldStats;
  }
}

const config = {
  default: "primary",
  connections: {
    primary: {
      type: "mysql",
      enabled: true,
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "123456",
      database: "test_db",
      // 优化连接池参数
      connectionLimit: 200,           // 增加到200个连接
      waitForConnections: true,
      queueLimit: 1000,               // 增加队列长度
      acquireTimeout: 30000,          // 增加获取连接超时时间
      // 性能优化参数
      charset: 'utf8mb4',
      timezone: '+08:00',
      multipleStatements: true,       // 允许多条语句
      // 连接池优化
      maxIdleTime: 60000,             // 最大空闲时间60秒
      maxLifeTime: 1800000,           // 最大生命周期30分钟
      // 查询优化
      queryTimeout: 30000,            // 查询超时时间
      // 批量操作优化
      bulkInsertBatchSize: 5000,      // 批量插入批次大小
      // 事务优化
      transactionIsolationLevel: 'READ-COMMITTED', // 降低隔离级别
      // 网络优化
      connectTimeout: 10000,          // 连接超时时间
      socketTimeout: 60000,           // Socket超时时间
    },
  },
  plugins: {
    cache: {
      enabled: true,
      defaultTtl: 60,
      prefix: "pressure_test:",
      tagsEnabled: true,
      compression: false
    }
  }
};


class EnhancedPressureTester {
  constructor() {
    this.db = new DatabaseManager(config);
    this.cacheDriver = new MemoryCacheDriver();
    this.testResults = {
      phases: {
        preparation: { start: 0, end: 0, duration: 0 },
        testing: { start: 0, end: 0, duration: 0 },
        total: { start: 0, end: 0, duration: 0 },
      },
      operations: {
        select: {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0,
          opsPerSecond: 0,
          cacheHits: 0,
          cacheMisses: 0,
        },
        insert: {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0,
          opsPerSecond: 0,
        },
        update: {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0,
          opsPerSecond: 0,
        },
        delete: {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: 0,
          opsPerSecond: 0,
        },
        batchInsert: {
          count: 0,
          recordsCount: 0,
          totalTime: 0,
          avgTimePerBatch: 0,
          avgTimePerRecord: 0,
          minTime: Infinity,
          maxTime: 0,
          opsPerSecond: 0,
          recordsPerSecond: 0,
        },
      },
      concurrency: {
        threads: 0,
        totalOperations: 0,
        successfulThreads: 0,
        failedThreads: 0,
        threadResults: [],
      },
      errors: {
        total: 0,
        byOperation: {
          select: 0,
          insert: 0,
          update: 0,
          delete: 0,
          batchInsert: 0,
        },
      },
      cache: {
        enabled: false,
        hits: 0,
        misses: 0,
        hitRate: 0,
        driver: "memory",
      },
    };
  }

  async init(enableCache = true) {
    console.log("🔄 初始化数据库连接...");
    await this.db.init();

    if (enableCache) {
      console.log("🔄 初始化缓存插件...");

      try {
        // 启用缓存插件
        this.db.enablePlugin("cache", {
          defaultTtl: 60,
          prefix: "pressure_test:",
          tagsEnabled: true,
          compression: false,
        });

        // 创建 QueryBuilder 实例并设置缓存驱动
        const queryBuilder = this.db.table("pressure_test_users");

        // 检查 QueryBuilder 是否有 cachePlugin
        if (queryBuilder.cachePlugin) {
          // 设置缓存驱动
          queryBuilder.cachePlugin.setCacheDriver(this.cacheDriver, {
            defaultTtl: 60,
            prefix: "pressure_test:",
            tagsEnabled: true,
          });

          this.testResults.cache.enabled = true;
          this.testResults.cache.driver = "memory";
          console.log("✅ CachePlugin 初始化成功");
        } else {
          console.log("⚠️  QueryBuilder 上没有 cachePlugin，跳过缓存功能");
          this.testResults.cache.enabled = false;
        }
      } catch (error) {
        console.error("❌ CachePlugin 初始化失败:", error.message);
        console.log("⚠️  跳过缓存功能");
        this.testResults.cache.enabled = false;
      }
    } else {
      console.log("⚠️  缓存已禁用");
    }

    console.log("✅ DatabaseManager 初始化成功\n");
  }

  // 辅助方法：确保 QueryBuilder 的缓存插件已启用
  ensureCacheEnabled(queryBuilder) {
    if (!queryBuilder.cachePlugin) {
      return false;
    }

    if (!queryBuilder.cachePlugin.cacheEnabled) {
      // 设置缓存驱动
      queryBuilder.cachePlugin.setCacheDriver(this.cacheDriver, {
        defaultTtl: 60,
        prefix: "pressure_test:",
        tagsEnabled: true,
      });
    }

    return queryBuilder.cachePlugin.cacheEnabled;
  }

  async cleanup() {
    // 清理缓存
    if (this.cacheDriver) {
      await this.cacheDriver.clear();
      console.log("🧹 缓存已清理");
    }

    await this.db.close().catch(() => {});
    console.log("🔌 数据库连接已关闭");
  }

  async measureOperation(
    operationName,
    operation,
    recordCount = 1,
    useCache = false,
  ) {
    const startTime = performance.now();
    try {
      let result;
      let cacheHit = false;

      if (useCache && operationName === "select") {
        // 使用带缓存的执行
        const query = operation();

        if (query && query.executeWithCache) {
          // 确保缓存插件已启用
          if (!this.ensureCacheEnabled(query)) {
            console.warn("⚠️  缓存插件未启用，使用普通查询");
            result = await query.execute();
          } else {
            result = await query.executeWithCache();
            // 检查缓存命中情况
            if (result && result._cache && result._cache.hit === true) {
              cacheHit = true;
              this.testResults.operations.select.cacheHits++;
            } else {
              this.testResults.operations.select.cacheMisses++;
            }
          }
        } else {
          result = await operation();
        }
      } else {
        result = await operation();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const opStats = this.testResults.operations[operationName];

      if (operationName === "batchInsert") {
        opStats.count++;
        opStats.recordsCount += recordCount;
        opStats.totalTime += duration;
        opStats.avgTimePerBatch = opStats.totalTime / opStats.count;
        opStats.avgTimePerRecord = opStats.totalTime / opStats.recordsCount;
      } else {
        opStats.count += recordCount;
        opStats.totalTime += duration;
        opStats.avgTime = opStats.totalTime / opStats.count;
      }

      opStats.minTime = Math.min(opStats.minTime, duration);
      opStats.maxTime = Math.max(opStats.maxTime, duration);

      return {
        success: true,
        result,
        duration,
        cacheHit,
      };
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.testResults.errors.total++;
      this.testResults.errors.byOperation[operationName]++;

      return {
        success: false,
        error,
        duration,
        cacheHit: false,
      };
    }
  }

 async prepareTestData() {
  console.log("📊 准备测试数据...");

  await this.db.execute(`
    CREATE TABLE IF NOT EXISTS pressure_test_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE,
      age INT,
      status BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      -- 优化索引策略
      INDEX idx_age_status (age, status),           -- 复合索引
      INDEX idx_name_email (name, email),           -- 复合索引
      INDEX idx_created_at_status (created_at, status), -- 时间+状态索引
      INDEX idx_status_age (status, age),           -- 状态+年龄索引
      INDEX idx_email_status (email, status),       -- 邮箱+状态索引
      INDEX idx_full_cover (age, status, created_at) -- 覆盖索引
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;
  `);

  await this.db.execute("TRUNCATE TABLE pressure_test_users");

  console.log("📥 预插入10000条测试数据...");
  const batchSize = 1000;
  const totalRecords = 10000;

  for (let i = 0; i < totalRecords; i += batchSize) {
    const batch = [];
    const currentBatchSize = Math.min(batchSize, totalRecords - i);
    
    for (let j = 0; j < currentBatchSize; j++) {
      batch.push({
        name: `测试用户${i + j}`,
        email: `test${i + j}@example.com`,
        age: Math.floor(Math.random() * 50) + 18,
        status: Math.random() > 0.5,
      });
    }

    await this.db.table("pressure_test_users").insert(batch).execute();
  }

  console.log(`✅ 已插入 ${totalRecords} 条测试数据\n`);
}


  async testSingleSelect(iterations = 100, useCache = false) {
    console.log(
      `🔍 测试单条查询 (${iterations}次, 缓存: ${useCache ? "启用" : "禁用"})...`,
    );

    for (let i = 0; i < iterations; i++) {
      const age = Math.floor(Math.random() * 50) + 18;

      const result = await this.measureOperation(
        "select",
        async () => {
          // 每次创建新的 QueryBuilder 实例
          const query = this.db
            .table("pressure_test_users")
            .select("id", "name", "age")
            .where("age", ">", age)
            .limit(10);

          if (useCache && this.testResults.cache.enabled) {
            // 确保缓存插件已启用
            if (!this.ensureCacheEnabled(query)) {
              return query.execute();
            }

            // 启用缓存并执行
            query.cache(30); // 缓存30秒
            return query.executeWithCache();
          } else {
            return query.execute();
          }
        },
        1,
        useCache,
      );

      if (!result.success) {
        console.error(`❌ 第${i + 1}次查询失败:`, result.error.message);
      }
    }

    console.log("✅ 单条查询测试完成\n");
  }

  async testBatchSelect(iterations = 50, useCache = false) {
    console.log(
      `🔍 测试批量查询 (${iterations}次，每次100条, 缓存: ${useCache ? "启用" : "禁用"})...`,
    );

    for (let i = 0; i < iterations; i++) {
      const result = await this.measureOperation(
        "select",
        () => {
          const query = this.db
            .table("pressure_test_users")
            .select("*")
            .where("status", "=", true)
            .orderBy("age", "DESC")
            .limit(100);

          if (useCache && this.testResults.cache.enabled) {
            // 确保缓存插件已启用
            if (!this.ensureCacheEnabled(query)) {
              return query.execute();
            }

            query.cache(60); // 缓存60秒
            return query.executeWithCache();
          } else {
            return query.execute();
          }
        },
        100,
        useCache,
      );

      if (!result.success) {
        console.error(`❌ 第${i + 1}次批量查询失败:`, result.error.message);
      }
    }

    console.log("✅ 批量查询测试完成\n");
  }

  async testSingleInsert(iterations = 100) {
    console.log(`📝 测试单条插入 (${iterations}次)...`);

    for (let i = 0; i < iterations; i++) {
      const user = {
        name: `压力测试用户${i}`,
        email: `pressure${i}@test.com`,
        age: Math.floor(Math.random() * 50) + 18,
        status: true,
      };

      const result = await this.measureOperation("insert", () =>
        this.db.table("pressure_test_users").insert(user).execute(),
      );

      if (!result.success) {
        console.error(`❌ 第${i + 1}次插入失败:`, result.error.message);
      }
    }

    console.log("✅ 单条插入测试完成\n");
  }

async testBatchInsert(iterations = 100, batchSize = 1000) {
  console.log(`📝 测试批量插入 (${iterations}批次，每批次${batchSize}条，总计${iterations * batchSize}条)...`);

  for (let i = 0; i < iterations; i++) {
    const batch = [];
    for (let j = 0; j < batchSize; j++) {
      batch.push({
        name: `批量用户${i}_${j}`,
        email: `batch${i}_${j}@test.com`,
        age: Math.floor(Math.random() * 50) + 18,
        status: Math.random() > 0.5,
      });
    }

    const result = await this.measureOperation(
      "batchInsert",
      () => this.db.table("pressure_test_users").insert(batch).execute(),
      batchSize
    );

    if (!result.success) {
      console.error(`❌ 第${i + 1}次批量插入失败:`, result.error.message);
    }
  }

  console.log("✅ 批量插入测试完成\n");
}

async testBatchUpdate(iterations = 100, batchSize = 100) {
  console.log(`🔄 测试批量更新 (${iterations}批次，每批次${batchSize}条)...`);
  
  // 先获取一批ID用于更新
  const allUsers = await this.db
    .table("pressure_test_users")
    .select("id")
    .limit(iterations * batchSize)
    .execute();
  
  const userIds = allUsers.map(u => u.id);
  
  for (let i = 0; i < iterations; i++) {
    const batchIds = userIds.slice(i * batchSize, (i + 1) * batchSize);
    
    if (batchIds.length === 0) break;
    
    const result = await this.measureOperation("update", async () => {
      // 使用IN子句批量更新
      await this.db
        .table("pressure_test_users")
        .whereIn("id", batchIds)
        .update({
          age: Math.floor(Math.random() * 50) + 18,
          status: Math.random() > 0.5,
          updated_at: new Date()
        })
        .execute();
    }, batchIds.length);
    
    if (!result.success) {
      console.error(`❌ 第${i + 1}次批量更新失败:`, result.error.message);
    }
  }
  
  console.log("✅ 批量更新测试完成\n");
}
async testBatchDelete(iterations = 50, batchSize = 200) {
  console.log(`🗑️  测试批量删除 (${iterations}批次，每批次${batchSize}条)...`);
  
  // 先插入测试数据
  const totalRecords = iterations * batchSize;
  const tempData = [];
  
  for (let i = 0; i < totalRecords; i++) {
    tempData.push({
      name: `批量删除测试${i}`,
      email: `batch_delete${i}@test.com`,
      age: 30,
      status: true,
    });
  }
  
  // 批量插入
  await this.db.table("pressure_test_users").insert(tempData).execute();
  
  // 批量删除
  for (let i = 0; i < iterations; i++) {
    const result = await this.measureOperation("delete", async () => {
      await this.db
        .table("pressure_test_users")
        .where("name", "LIKE", `批量删除测试%`)
        .limit(batchSize)
        .delete()
        .execute();
    }, batchSize);
    
    if (!result.success) {
      console.error(`❌ 第${i + 1}次批量删除失败:`, result.error.message);
    }
  }
  
  console.log("✅ 批量删除测试完成\n");
}

  async testUpdate(iterations = 100) {
    console.log(`🔄 测试更新操作 (${iterations}次)...`);

    const users = await this.db
      .table("pressure_test_users")
      .select("id")
      .limit(iterations)
      .execute();

    const userIds = Array.isArray(users) ? users.map((u) => u.id) : [];

    for (let i = 0; i < Math.min(iterations, userIds.length); i++) {
      const result = await this.measureOperation("update", () =>
        this.db
          .table("pressure_test_users")
          .where("id", "=", userIds[i])
          .update({
            age: Math.floor(Math.random() * 50) + 18,
            status: Math.random() > 0.5,
          })
          .execute(),
      );

      if (!result.success) {
        console.error(`❌ 第${i + 1}次更新失败:`, result.error.message);
      }
    }

    console.log("✅ 更新测试完成\n");
  }

  async testDelete(iterations = 50) {
    console.log(`🗑️  测试删除操作 (${iterations}次)...`);

    const tempData = [];
    for (let i = 0; i < iterations; i++) {
      tempData.push({
        name: `删除测试${i}`,
        email: `delete${i}@test.com`,
        age: 30,
        status: true,
      });
    }

    if (tempData.length > 0) {
      await this.db.table("pressure_test_users").insert(tempData).execute();
    }

    for (let i = 0; i < iterations; i++) {
      const result = await this.measureOperation("delete", () =>
        this.db
          .table("pressure_test_users")
          .where("name", "=", `删除测试${i}`)
          .delete()
          .execute(),
      );

      if (!result.success) {
        console.error(`❌ 第${i + 1}次删除失败:`, result.error.message);
      }
    }

    console.log("✅ 删除测试完成\n");
  }

  async testConcurrentOperations(
    concurrentCount = 10,
    operationsPerThread = 20,
    useCache = false,
  ) {
    console.log(
      `⚡ 测试并发操作 (${concurrentCount}个并发线程，每个${operationsPerThread}次操作，缓存: ${useCache ? "启用" : "禁用"})...`,
    );

    const promises = [];
    const threadStartTimes = new Array(concurrentCount).fill(0);

    for (let threadId = 0; threadId < concurrentCount; threadId++) {
      promises.push(
        this.runConcurrentThread(
          threadId,
          operationsPerThread,
          threadStartTimes,
          useCache,
        ),
      );
    }

    const threadResults = await Promise.allSettled(promises);

    threadResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const { operations, totalTime } = result.value;

        if (!operations || typeof operations !== "object") {
          console.error(`❌ 线程 ${index} 返回的 operations 无效:`, operations);
          this.testResults.concurrency.threadResults.push({
            threadId: index,
            success: false,
            error: "Invalid operations object",
            totalTime: totalTime || 0,
          });
          this.testResults.concurrency.failedThreads++;
          return;
        }

        this.testResults.concurrency.threadResults.push({
          threadId: index,
          success: true,
          operations,
          totalTime,
        });

        if (operations && typeof operations === "object") {
          Object.entries(operations).forEach(([op, count]) => {
            if (op !== "errors" && typeof count === "number" && count > 0) {
              if (this.testResults.operations[op]) {
                this.testResults.operations[op].count += count;
              }
            }
          });
        }

        this.testResults.concurrency.totalOperations +=
          (operations.select || 0) +
          (operations.insert || 0) +
          (operations.update || 0) +
          (operations.delete || 0);
        this.testResults.concurrency.successfulThreads++;
      } else {
        this.testResults.concurrency.threadResults.push({
          threadId: index,
          success: false,
          error: result.reason?.message || "Unknown error",
        });
        this.testResults.concurrency.failedThreads++;
      }
    });

    this.testResults.concurrency.threads = concurrentCount;
    console.log("✅ 并发测试完成\n");
  }

  async runConcurrentThread(
    threadId,
    operations,
    startTimes,
    useCache = false,
  ) {
    const threadResults = {
      select: 0,
      insert: 0,
      update: 0,
      delete: 0,
      errors: [],
      totalTime: 0,
    };

    const startTime = performance.now();
    startTimes[threadId] = startTime;

    for (let i = 0; i < operations; i++) {
      const operationType = Math.floor(Math.random() * 4);

      try {
        switch (operationType) {
          case 0:
            const selectQuery = this.db
              .table("pressure_test_users")
              .select("id", "name")
              .where("age", ">", 20)
              .limit(5);

            if (useCache && this.testResults.cache.enabled) {
              // 确保缓存插件已启用
              if (this.ensureCacheEnabled(selectQuery)) {
                selectQuery.cache(30); // 缓存30秒
                await selectQuery.executeWithCache();
              } else {
                await selectQuery.execute();
              }
            } else {
              await selectQuery.execute();
            }
            threadResults.select++;
            break;

          case 1:
            await this.db
              .table("pressure_test_users")
              .insert({
                name: `并发用户${threadId}_${i}`,
                email: `concurrent${threadId}_${i}@test.com`,
                age: 25,
                status: true,
              })
              .execute();
            threadResults.insert++;
            break;

          case 2:
            await this.db
              .table("pressure_test_users")
              .where("status", "=", true)
              .limit(1)
              .update({ status: false })
              .execute();
            threadResults.update++;
            break;

          case 3:
            await this.db
              .table("pressure_test_users")
              .where("name", "=", `并发用户${threadId}_${i}`)
              .delete()
              .execute();
            threadResults.delete++;
            break;
        }
      } catch (error) {
        threadResults.errors.push({
          operation: ["SELECT", "INSERT", "UPDATE", "DELETE"][operationType],
          error: error.message,
        });
      }
    }

    threadResults.totalTime = performance.now() - startTime;
    return {
      operations: threadResults,
      totalTime: threadResults.totalTime,
    };
  }

  async testCachePerformance(iterations = 100) {
    console.log(`🧪 测试缓存性能 (${iterations}次查询，对比有无缓存)...\n`);

    // 重置缓存统计
    this.cacheDriver.resetStats();

    // 测试无缓存
    console.log("1. 无缓存查询测试...");
    const noCacheStart = performance.now();
    await this.testSingleSelect(iterations, false);
    const noCacheTime = performance.now() - noCacheStart;

    // 测试有缓存
    console.log("2. 有缓存查询测试...");
    const cacheStart = performance.now();
    await this.testSingleSelect(iterations, true);
    const cacheTime = performance.now() - cacheStart;

    // 获取缓存统计
    const cacheStats = this.cacheDriver.getStats();
    const totalCacheOps = cacheStats.hits + cacheStats.misses;
    const cacheHitRate =
      totalCacheOps > 0
        ? ((cacheStats.hits / totalCacheOps) * 100).toFixed(2)
        : 0;

    console.log("📊 缓存性能对比:");
    console.log(`   无缓存总耗时: ${noCacheTime.toFixed(2)}ms`);
    console.log(`   有缓存总耗时: ${cacheTime.toFixed(2)}ms`);
    console.log(
      `   性能提升: ${(((noCacheTime - cacheTime) / noCacheTime) * 100).toFixed(2)}%`,
    );
    console.log(`   缓存命中率: ${cacheHitRate}%`);
    console.log(`   缓存命中次数: ${cacheStats.hits}`);
    console.log(`   缓存未命中次数: ${cacheStats.misses}\n`);

    this.testResults.cache.hits = cacheStats.hits;
    this.testResults.cache.misses = cacheStats.misses;
    this.testResults.cache.hitRate = cacheHitRate;
  }

  async testCacheInvalidation() {
    console.log("🧪 测试缓存失效机制...");

    // 先执行一个带缓存的查询
    const query = this.db
      .table("pressure_test_users")
      .select("*")
      .where("status", "=", true)
      .limit(5);

    // 确保缓存插件已启用
    if (!this.ensureCacheEnabled(query)) {
      console.log("⚠️  缓存插件未启用，跳过缓存失效测试");
      return;
    }

    query.cache(60); // 缓存60秒

    console.log("1. 第一次执行（缓存未命中）...");
    const start1 = performance.now();
    const result1 = await query.executeWithCache();
    const time1 = performance.now() - start1;
    console.log(`   耗时: ${time1.toFixed(2)}ms`);

    console.log("2. 第二次执行（缓存命中）...");
    const start2 = performance.now();
    const result2 = await query.executeWithCache();
    const time2 = performance.now() - start2;
    console.log(`   耗时: ${time2.toFixed(2)}ms`);
    console.log(
      `   缓存加速: ${(((time1 - time2) / time1) * 100).toFixed(2)}%`,
    );

    // 插入数据，应该自动清除相关缓存
    console.log("3. 插入新数据（触发缓存清除）...");
    await this.db
      .table("pressure_test_users")
      .insert({
        name: "缓存测试用户",
        email: "cache_test@example.com",
        age: 30,
        status: true,
      })
      .execute();

    console.log("4. 第三次执行（缓存失效后重新查询）...");
    const start3 = performance.now();
    const result3 = await query.executeWithCache();
    const time3 = performance.now() - start3;
    console.log(`   耗时: ${time3.toFixed(2)}ms`);

    console.log("✅ 缓存失效测试完成\n");
  }
async testParallelBatchOperations(operationType = 'insert', concurrentBatches = 20, batchSize = 500) {
  console.log(`⚡ 测试并行${operationType.toUpperCase()}操作 (${concurrentBatches}个并行批次，每批次${batchSize}条)...`);
  
  const totalRecords = concurrentBatches * batchSize;
  console.log(`总计操作: ${totalRecords}条记录`);
  
  const startTime = performance.now();
  
  // 并行执行多个批量操作
  const promises = [];
  for (let i = 0; i < concurrentBatches; i++) {
    promises.push(this.executeParallelBatch(i, batchSize, operationType));
  }
  
  const results = await Promise.allSettled(promises);
  
  const endTime = performance.now();
  const totalTime = endTime - startTime;
  
  const successfulBatches = results.filter(r => r.status === 'fulfilled').length;
  const recordsPerSecond = totalRecords / (totalTime / 1000);
  
  console.log(`✅ 并行${operationType.toUpperCase()}操作完成`);
  console.log(`   成功批次: ${successfulBatches}/${concurrentBatches}`);
  console.log(`   总耗时: ${totalTime.toFixed(2)}ms`);
  console.log(`   吞吐量: ${recordsPerSecond.toFixed(2)} records/s`);
  console.log(`   平均每批次: ${(totalTime / concurrentBatches).toFixed(2)}ms\n`);
  
  return {
    totalRecords,
    totalTime,
    recordsPerSecond,
    successfulBatches,
    totalBatches: concurrentBatches
  };
}

async executeParallelBatch(batchId, batchSize, operationType) {
  switch (operationType) {
    case 'insert':
      const insertBatch = [];
      for (let j = 0; j < batchSize; j++) {
        insertBatch.push({
          name: `并行用户${batchId}_${j}`,
          email: `parallel${batchId}_${j}@test.com`,
          age: Math.floor(Math.random() * 50) + 18,
          status: Math.random() > 0.5,
        });
      }
      return this.db.table("pressure_test_users").insert(insertBatch).execute();
      
    case 'update':
      // 获取一批ID进行更新
      const users = await this.db
        .table("pressure_test_users")
        .select("id")
        .limit(batchSize)
        .offset(batchId * batchSize)
        .execute();
      
      if (users.length === 0) return;
      
      const updateIds = users.map(u => u.id);
      return this.db
        .table("pressure_test_users")
        .whereIn("id", updateIds)
        .update({
          age: Math.floor(Math.random() * 50) + 18,
          status: Math.random() > 0.5,
          updated_at: new Date()
        })
        .execute();
        
    case 'delete':
      // 插入临时数据然后删除
      const tempBatch = [];
      for (let j = 0; j < batchSize; j++) {
        tempBatch.push({
          name: `并行删除${batchId}_${j}`,
          email: `parallel_delete${batchId}_${j}@test.com`,
          age: 30,
          status: true,
        });
      }
      
      await this.db.table("pressure_test_users").insert(tempBatch).execute();
      
      return this.db
        .table("pressure_test_users")
        .where("name", "LIKE", `并行删除${batchId}_%`)
        .delete()
        .execute();
  }
}

  async runAllTests(enableCache = true) {
    console.log(
      `🚀 开始数据库压力测试（缓存: ${enableCache ? "启用" : "禁用"}）\n`,
    );

    this.testResults.phases.total.start = performance.now();

    try {
      this.testResults.phases.preparation.start = performance.now();
      await this.init(enableCache);
      await this.prepareTestData();
      this.testResults.phases.preparation.end = performance.now();
      this.testResults.phases.preparation.duration =
        this.testResults.phases.preparation.end -
        this.testResults.phases.preparation.start;

      this.testResults.phases.testing.start = performance.now();

      // 基础性能测试
      console.log("=== 基础性能测试 ===\n");
      await this.testSingleSelect(100, enableCache);
      await this.testBatchSelect(50, enableCache);
      await this.testSingleInsert(100);
      await this.testBatchInsert(20, 50);
      await this.testUpdate(100);
      await this.testDelete(50);
      await this.testConcurrentOperations(10, 20, enableCache);

      // 如果启用缓存，测试缓存性能
      if (enableCache) {
        console.log("=== 缓存性能测试 ===\n");
        await this.testCachePerformance(100);
        await this.testCacheInvalidation();
      }

      this.testResults.phases.testing.end = performance.now();
      this.testResults.phases.testing.duration =
        this.testResults.phases.testing.end -
        this.testResults.phases.testing.start;

      this.testResults.phases.total.end = performance.now();
      this.testResults.phases.total.duration =
        this.testResults.phases.total.end - this.testResults.phases.total.start;

      this.generateEnhancedReport();
    } catch (error) {
      console.error("❌ 压力测试执行失败:", error.message);
      console.error(error.stack);
    } finally {
      await this.cleanup();
    }
  }

  generateEnhancedReport() {
    console.log("\n📊 =============== 增强版压力测试报告 ===============\n");

    console.log("📈 测试概况:");
    console.log(
      `   准备阶段耗时: ${this.testResults.phases.preparation.duration.toFixed(2)}ms`,
    );
    console.log(
      `   性能测试耗时: ${this.testResults.phases.testing.duration.toFixed(2)}ms`,
    );
    console.log(
      `   总测试时间: ${this.testResults.phases.total.duration.toFixed(2)}ms\n`,
    );

    console.log("🔧 操作性能详情:");
    this.printOperationDetails();

    console.log("\n⚡ 并发测试结果:");
    this.printConcurrencyResults();

    if (this.testResults.cache.enabled) {
      console.log("\n🧠 缓存性能分析:");
      this.printCacheAnalysis();
    }

    console.log("\n❌ 错误统计:");
    this.printErrorStatistics();

    console.log("\n⚠️  性能瓶颈分析:");
    this.printPerformanceBottleneck();

    console.log("\n💡 优化建议:");
    this.printOptimizationSuggestions();

    console.log("\n🎯 性能总结:");
    this.printPerformanceSummary();

    console.log("\n✅ =============== 测试完成 ===============");
  }

  printOperationDetails() {
    Object.entries(this.testResults.operations).forEach(([op, stats]) => {
      if (stats.count > 0 || (op === "batchInsert" && stats.recordsCount > 0)) {
        console.log(`\n${op.toUpperCase()}:`);

        if (op === "batchInsert") {
          console.log(`   执行批次: ${stats.count}次`);
          console.log(`   总记录数: ${stats.recordsCount}条`);
          console.log(`   总耗时: ${stats.totalTime.toFixed(2)}ms`);
          console.log(
            `   平均每批次耗时: ${stats.avgTimePerBatch.toFixed(2)}ms`,
          );
          console.log(
            `   平均每条记录耗时: ${stats.avgTimePerRecord.toFixed(4)}ms`,
          );
          console.log(`   最小时耗: ${stats.minTime.toFixed(2)}ms`);
          console.log(`   最大时耗: ${stats.maxTime.toFixed(2)}ms`);
          console.log(
            `   批次操作每秒: ${(stats.count / (stats.totalTime / 1000)).toFixed(2)} ops/s`,
          );
          console.log(
            `   记录操作每秒: ${(stats.recordsCount / (stats.totalTime / 1000)).toFixed(2)} records/s`,
          );
        } else {
          console.log(`   执行次数: ${stats.count}次`);
          console.log(`   总耗时: ${stats.totalTime.toFixed(2)}ms`);
          console.log(`   平均耗时: ${stats.avgTime.toFixed(2)}ms`);
          console.log(`   最小时耗: ${stats.minTime.toFixed(2)}ms`);
          console.log(`   最大时耗: ${stats.maxTime.toFixed(2)}ms`);
          console.log(
            `   平均每秒: ${(stats.count / (stats.totalTime / 1000)).toFixed(2)} ops/s`,
          );

          if (op === "select" && stats.cacheHits !== undefined) {
            const totalSelects = stats.cacheHits + stats.cacheMisses;
            const hitRate =
              totalSelects > 0
                ? ((stats.cacheHits / totalSelects) * 100).toFixed(2)
                : 0;
            console.log(`   缓存命中: ${stats.cacheHits}次`);
            console.log(`   缓存未命中: ${stats.cacheMisses}次`);
            console.log(`   缓存命中率: ${hitRate}%`);
          }
        }
      }
    });
  }

  printCacheAnalysis() {
    const { hits, misses, hitRate, enabled, driver } = this.testResults.cache;
    const totalCacheOps = hits + misses;

    console.log(`   缓存状态: ${enabled ? "✅ 已启用" : "❌ 未启用"}`);
    console.log(`   缓存驱动: ${driver}`);
    console.log(`   缓存总操作: ${totalCacheOps}次`);
    console.log(`   缓存命中: ${hits}次`);
    console.log(`   缓存未命中: ${misses}次`);
    console.log(`   缓存命中率: ${hitRate}%`);

    if (this.cacheDriver) {
      const cacheStats = this.cacheDriver.getStats();
      console.log(`   缓存大小: ${cacheStats.totalKeys}条记录`);
      console.log(`   缓存设置: ${cacheStats.sets}次`);
      console.log(`   缓存删除: ${cacheStats.deletes}次`);
    }

    // 缓存性能分析
    const selectStats = this.testResults.operations.select;
    if (selectStats.cacheHits > 0) {
      const avgCacheTime =
        selectStats.totalTime /
        (selectStats.cacheHits + selectStats.cacheMisses);
      const estimatedSavings = selectStats.cacheHits * avgCacheTime * 0.7; // 假设缓存比数据库快70%
      console.log(`   预估节省时间: ${estimatedSavings.toFixed(2)}ms`);
      console.log(`   性能提升比例: ${(hitRate * 0.7).toFixed(2)}%`);
    }
  }

  printConcurrencyResults() {
    const {
      threads,
      successfulThreads,
      failedThreads,
      totalOperations,
      threadResults,
    } = this.testResults.concurrency;

    console.log(`   总线程数: ${threads}`);
    console.log(`   成功线程: ${successfulThreads}`);
    console.log(`   失败线程: ${failedThreads}`);
    console.log(`   并发总操作数: ${totalOperations}`);

    if (threadResults && threadResults.length > 0 && successfulThreads > 0) {
      const successfulThreadsArray = threadResults.filter(
        (t) => t && t.success,
      );
      if (successfulThreadsArray.length > 0) {
        const avgThreadTime =
          successfulThreadsArray.reduce(
            (sum, t) => sum + (t.totalTime || 0),
            0,
          ) / successfulThreadsArray.length;
        console.log(`   平均线程执行时间: ${avgThreadTime.toFixed(2)}ms`);

        const maxTime = Math.max(
          ...successfulThreadsArray.map((t) => t.totalTime || 0),
        );
        if (maxTime > 0) {
          const concurrentOpsPerSecond = totalOperations / (maxTime / 1000);
          console.log(
            `   并发操作每秒: ${concurrentOpsPerSecond.toFixed(2)} ops/s`,
          );
        }
      }
    }
  }

  printErrorStatistics() {
    const { total, byOperation } = this.testResults.errors;

    console.log(`   总错误数: ${total}`);
    if (total > 0) {
      console.log("   按操作类型分布:");
      Object.entries(byOperation).forEach(([op, count]) => {
        if (count > 0) {
          console.log(`     ${op.toUpperCase()}: ${count}次`);
        }
      });
    } else {
      console.log("   ✅ 无错误发生");
    }
  }
  printPerformanceBottleneck() {
    const opsArray = Object.entries(this.testResults.operations)
      .filter(([name, stats]) => {
        if (name === "batchInsert") return false;
        if (!stats || typeof stats !== "object") return false;
        if (stats.count === undefined || stats.count <= 0) return false;
        if (stats.avgTime === undefined || isNaN(stats.avgTime)) return false;
        return true;
      })
      .map(([name, stats]) => ({
        name,
        avgTime: stats.avgTime || 0,
        count: stats.count || 0,
        opsPerSecond:
          stats.count > 0 ? stats.count / (stats.totalTime / 1000) : 0,
      }));

    if (opsArray.length === 0) {
      console.log("   无有效测试数据，无法分析瓶颈");

      const batchStats = this.testResults.operations.batchInsert;
      if (batchStats && batchStats.count > 0) {
        console.log(
          `   📦 批量插入: ${batchStats.count}批次, ${batchStats.recordsCount}条记录`,
        );
        console.log(
          `       平均每批次: ${batchStats.avgTimePerBatch?.toFixed(2) || 0}ms`,
        );
        console.log(
          `       平均每条记录: ${batchStats.avgTimePerRecord?.toFixed(4) || 0}ms`,
        );
        console.log(
          `       记录吞吐量: ${(batchStats.recordsCount / (batchStats.totalTime / 1000)).toFixed(2)} records/s`,
        );
      }
      return;
    }

    opsArray.sort((a, b) => b.avgTime - a.avgTime);

    // 修复这里：使用 opsArray[0] 而不是 opsArray
    const slowest = opsArray[0];
    const fastest = opsArray[opsArray.length - 1];

    if (!slowest || !fastest) {
      console.log("   无法确定最快和最慢操作");
      return;
    }

    console.log(
      `   🐢 最慢操作: ${slowest.name?.toUpperCase() || "未知"} (平均 ${slowest.avgTime?.toFixed(2) || 0}ms, ${slowest.opsPerSecond?.toFixed(2) || 0} ops/s)`,
    );
    console.log(
      `   🐇 最快操作: ${fastest.name?.toUpperCase() || "未知"} (平均 ${fastest.avgTime?.toFixed(2) || 0}ms, ${fastest.opsPerSecond?.toFixed(2) || 0} ops/s)`,
    );

    const batchStats = this.testResults.operations.batchInsert;
    if (batchStats && batchStats.count > 0) {
      console.log(
        `   📦 批量插入: ${batchStats.count}批次, ${batchStats.recordsCount}条记录`,
      );
      console.log(
        `       平均每批次: ${batchStats.avgTimePerBatch?.toFixed(2) || 0}ms`,
      );
      console.log(
        `       平均每条记录: ${batchStats.avgTimePerRecord?.toFixed(4) || 0}ms`,
      );
      console.log(
        `       记录吞吐量: ${(batchStats.recordsCount / (batchStats.totalTime / 1000)).toFixed(2)} records/s`,
      );
    }
  }

  printOptimizationSuggestions() {
    const suggestions = [];
    const ops = this.testResults.operations;

    if (ops.select && ops.select.avgTime > 10) {
      suggestions.push("1. SELECT 操作较慢，考虑添加更多索引或优化查询条件");
    }

    if (ops.insert && ops.insert.avgTime > 20) {
      suggestions.push("2. 单条插入较慢，建议使用批量插入替代频繁的单条插入");
    }

    if (ops.batchInsert && ops.batchInsert.avgTimePerRecord > 0.5) {
      suggestions.push(
        "3. 批量插入每条记录耗时较高，考虑调整批次大小或检查数据库配置",
      );
    }

    if (ops.update && ops.update.avgTime > 30) {
      suggestions.push("4. UPDATE 操作较慢，检查是否有锁竞争或索引问题");
    }

    if (this.testResults.concurrency.failedThreads > 0) {
      suggestions.push(
        "5. 并发测试中有失败线程，建议增加连接池大小或优化并发控制",
      );
    }

    if (ops.batchInsert && ops.batchInsert.count > 0) {
      const recordsPerSecond =
        ops.batchInsert.recordsCount / (ops.batchInsert.totalTime / 1000);
      if (recordsPerSecond < 1000) {
        suggestions.push(
          `6. 批量插入吞吐量较低 (${recordsPerSecond.toFixed(2)} records/s)，建议调整批次大小或使用事务批量提交`,
        );
      }
    }

    // 缓存相关建议
    const selectStats = this.testResults.operations.select;
    if (selectStats && selectStats.cacheHits > 0) {
      const totalCacheOps = selectStats.cacheHits + selectStats.cacheMisses;
      const cacheHitRate =
        totalCacheOps > 0 ? (selectStats.cacheHits / totalCacheOps) * 100 : 0;

      if (cacheHitRate < 50) {
        suggestions.push(
          `7. 缓存命中率较低 (${cacheHitRate.toFixed(2)}%)，考虑增加缓存TTL或优化查询模式`,
        );
      } else if (cacheHitRate > 80) {
        suggestions.push(
          `8. 缓存命中率良好 (${cacheHitRate.toFixed(2)}%)，可考虑增加缓存容量`,
        );
      }
    }

    if (suggestions.length === 0) {
      suggestions.push("数据库性能良好，继续保持当前配置");
    }

    suggestions.forEach((suggestion, index) => {
      console.log(`   ${suggestion}`);
    });
  }
  printPerformanceSummary() {
    const totalOperations = Object.values(this.testResults.operations).reduce(
      (sum, op) => {
        if (!op) return sum;

        if (op === this.testResults.operations.batchInsert) {
          return sum + (op.recordsCount || 0);
        }
        return sum + (op.count || 0);
      },
      0,
    );

    const testDuration = this.testResults.phases.testing?.duration || 0;

    const overallOpsPerSecond =
      testDuration > 0 ? totalOperations / (testDuration / 1000) : 0;

    console.log(`   总操作数: ${totalOperations}次`);
    console.log(`   性能测试时间: ${testDuration.toFixed(2)}ms`);
    console.log(`   总体操作每秒: ${overallOpsPerSecond.toFixed(2)} ops/s`);

    // 缓存性能统计
    const cacheStats = this.testResults.cache;
    if (cacheStats.enabled) {
      const totalCacheOps = cacheStats.hits + cacheStats.misses;
      if (totalCacheOps > 0) {
        console.log(`   缓存总操作: ${totalCacheOps}次`);
        console.log(`   缓存命中率: ${cacheStats.hitRate}%`);
      }
    }

    if (overallOpsPerSecond > 1000) {
      console.log("   🚀 性能评级: 优秀 (>1000 ops/s)");
    } else if (overallOpsPerSecond > 500) {
      console.log("   👍 性能评级: 良好 (500-1000 ops/s)");
    } else if (overallOpsPerSecond > 200) {
      console.log("   ⚠️  性能评级: 中等 (200-500 ops/s)");
    } else {
      console.log("   🐌 性能评级: 需要优化 (<200 ops/s)");
    }
  }
}

// 导出测试器类
export default EnhancedPressureTester;

// 如果直接运行此文件，则执行测试
if (import.meta.url.includes("mysql-test-pressure.js")) {
  const tester = new EnhancedPressureTester();

  // 解析命令行参数
  const args = process.argv.slice(2);
  const enableCache = !args.includes("--no-cache");
  const iterations =
    parseInt(args.find((arg) => arg.startsWith("--iterations="))?.split("=")) ||
    100;

  console.log(
    `🚀 启动压力测试 (缓存: ${enableCache ? "启用" : "禁用"}, 迭代次数: ${iterations})`,
  );

  tester
    .runAllTests(enableCache)
    .then(() => {
      console.log("\n🎉 压力测试完成！");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ 压力测试失败:", error);
      process.exit(1);
    });
}
