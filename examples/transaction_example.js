// packages/database/examples/transaction_example.js
import DatabaseManager from '../src/DatabaseManager.js';

async function transactionExample() {
  console.log("🚀 Starting transaction examples...\n");

  try {
    // Single database configuration with retry settings
    const singleDbConfig = {
      enabled: true,
      default: "primary",
      connections: {
        primary: {
          type: "mysql",
          host: "127.0.0.1",
          port: 3306,
          user: "root",
          password: "123456",
          database: "transaction_db",
          enabled: true,
          retry: {
            maxAttempts: 3,
            delay: 1000,
            backoff: true
          },
          pool: {
            min: 0,
            max: 10
          }
        },
      },
    };

    // 在函数作用域内定义变量
    let singleDb = null;
    let multiDb = null;
    let orderId = null;

    try {
      // EXAMPLE 1: Basic transaction (single database)
      console.log("💳 Example 1: Basic transaction (single database)");
      singleDb = new DatabaseManager(singleDbConfig);
      await singleDb.init();

      // 执行简单事务
      const singleResult = await singleDb.transaction(async (trx) => {
        // 创建测试表 - 使用原始查询而不是预处理语句
        await trx.query(`
          CREATE TABLE IF NOT EXISTS test_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // 插入数据 - 使用预处理语句
        const insertResult = await trx.query(
          "INSERT INTO test_transactions (name, amount) VALUES (?, ?)",
          ["Test Transaction", 100.50]
        );

        console.log(`✅ Inserted record with ID: ${insertResult.insertId}`);

        // 查询数据 - 使用预处理语句
        const selectResult = await trx.query(
          "SELECT * FROM test_transactions WHERE id = ?",
          [insertResult.insertId]
        );

        console.log(`✅ Retrieved record:`, selectResult);

        // 更新数据 - 使用预处理语句
        await trx.query(
          "UPDATE test_transactions SET amount = ? WHERE id = ?",
          [200.75, insertResult.insertId]
        );

        console.log(`✅ Updated record ${insertResult.insertId}`);

        return {
          success: true,
          insertedId: insertResult.insertId,
          message: "Single database transaction completed successfully"
        };
      });

      console.log(`🎉 Single database transaction result:`, singleResult);

      // 清理测试表
      await singleDb.query("DROP TABLE IF EXISTS test_transactions");
      console.log("🧹 Cleaned up test table");

      return {
        success: true,
        message: "Transaction examples completed successfully"
      };

    } catch (error) {
      console.error("❌ Transaction example failed:", error.message);
      console.error("Error stack:", error.stack);

      // 清理代码
      if (singleDb) {
        try {
          console.log("🔄 Starting cleanup after transaction failure...");
          await singleDb.query("DROP TABLE IF EXISTS test_transactions");
          console.log("✅ Cleanup completed");
        } catch (cleanupError) {
          console.error("⚠️ Cleanup failed:", cleanupError.message);
        }
      }

      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }

  } catch (error) {
    console.error("❌ Transaction example failed:", error.message);
    throw error;
  }
}

export default transactionExample;
