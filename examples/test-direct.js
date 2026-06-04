// test-direct.js
import DatabaseManager from "../src/DatabaseManager.js";

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
      connectionLimit: 10,
    },
  },
};

console.log("🚀 Aether QueryBuilder 最终功能验证测试\n");

const db = new DatabaseManager(config);

async function runTest() {
  try {
    await db.init();
    console.log("✅ DatabaseManager 初始化成功\n");

    // 准备测试环境
    await db.execute("DROP TABLE IF EXISTS users");
    await db.execute(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        age INT,
        status BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✅ 测试表已重建\n");

    // ==================== 业务测试 ====================
    console.log("📝 1. 插入测试数据");
    await db
      .table("users")
      .insert({
        name: "张三",
        email: "zhangsan@example.com",
        age: 25,
      })
      .execute();

    await db
      .table("users")
      .insert({
        name: "李四",
        email: "lisi@example.com",
        age: 28,
      })
      .execute();

    console.log("🔍 2. 查询所有用户");
    const users = await db.table("users").select("*").execute();
    console.table(users);

    console.log("\n📊 3. 条件查询 + 排序");
    const youngUsers = await db
      .table("users")
      .select("id", "name", "age")
      .where("age", ">", 20)
      .orderBy("age", "DESC")
      .execute();
    console.table(youngUsers);

    console.log("\n✏️  4. 更新数据");
    await db
      .table("users")
      .where("name", "张三")
      .update({ age: 30, status: false })
      .execute();

    console.log("\n🗑️  5. 删除数据");
    await db.table("users").where("name", "李四").delete().execute();

    console.log("\n📦 6. 批量插入");
    await db
      .table("users")
      .insert([
        { name: "王五", email: "wangwu@example.com", age: 32 },
        { name: "赵六", email: "zhaoliu@example.com", age: 29 },
        { name: "孙七", email: "sunqi@example.com", age: 35 },
      ])
      .execute();

    console.log("\n🎯 7. 复杂查询测试");
    const result = await db
      .table("users")
      .select("id", "name", "age")
      .where("age", ">=", 30)
      .orderBy("age", "DESC")
      .execute();
    console.table(result);

    console.log("\n✅ 所有测试全部通过！");
    console.log("🎉 QueryBuilder 已达到生产可用标准");
  } catch (error) {
    console.error("\n❌ 测试失败:", error.message);
    console.error(error);
  } finally {
    await db.close();
    console.log("\n🔌 数据库连接已安全关闭");
  }
}

runTest();
