AetherFramework Database - Zero-Dependency Multi-Database Integration for Node.js

🚀 Why Choose AetherFramework Database?

AetherFramework Database is a revolutionary database integration solution designed specifically for the AetherJS API framework, but flexible enough to work with any Node.js application. In a world of bloated dependencies and complex ORMs, we offer a refreshing alternative that prioritizes performance, simplicity, and developer experience.

📊 Key Advantages Over Other Solutions

| Feature | AetherFramework Database | TypeORM | Sequelize | Knex.js | Prisma |
|---------|-----------------------------|---------|-----------|---------|--------|
| Zero Dependencies | ✅ No external dependencies | ❌ 50+ dependencies | ❌ 40+ dependencies | ❌ 15+ dependencies | ❌ 100+ dependencies |
| Bundle Size | ✅ ~100KB | ❌ ~10MB | ❌ ~8MB | ❌ ~2MB | ❌ ~20MB |
| Multi-Database Support | ✅ 8+ databases unified API | ✅ 7+ databases | ✅ 6+ databases | ✅ 7+ databases | ✅ 5+ databases |
| Built-in Features | ✅ Pooling, Caching, Monitoring, Migrations | ❌ Requires plugins | ❌ Requires plugins | ❌ Basic only | ❌ Limited |
| TypeScript Support | ✅ First-class with full types | ✅ Excellent | ✅ Good | ✅ Basic | ✅ Excellent |
| Learning Curve | ✅ Gentle, intuitive API | 🔴 Complex | 🟡 Moderate | 🟢 Simple | 🔴 Complex |
| Performance | ✅ Native speed, no overhead | 🟡 Good | 🟡 Good | 🟢 Excellent | 🟢 Good |


📦 Installation

```bash
Using npm
npm install @aetherframework/database
```

🚀 Quick Start

With AetherJS

```javascript
// In your AetherJS project
import { Database } from '@aetherframework/database';

// Minimal configuration
const db = new Database({
  connections: {
    primary: {
      type: 'sqlite',
      database: './data/app.db'
    }
  }
});

// Initialize
await db.init();

// Start using immediately
const users = await db.table('users').select('*').execute();
console.log(users.rows);
```

With Express.js

```javascript
import express from 'express';
import { Database } from '@aetherframework/database';

const app = express();
const db = new Database({
  connections: {
    primary: {
      type: 'mysql',
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'myapp'
    }
  }
});

await db.init();

app.get('/users', async (req, res) => {
  const users = await db.table('users').select('*').execute();
  res.json(users.rows);
});

app.listen(3000, () => {
  console.log('Server running with @aetherframework/database');
});
```

With Fastify

```javascript
import Fastify from 'fastify';
import { Database } from '@aetherframework/database';

const fastify = Fastify();
const db = new Database({
  connections: {
    primary: {
      type: 'postgresql',
      host: 'localhost',
      user: 'postgres',
      password: 'password',
      database: 'myapp'
    }
  }
});

await db.init();

fastify.get('/users', async (request, reply) => {
  const users = await db.table('users').select('*').execute();
  return users.rows;
});

fastify.listen({ port: 3000 }, (err) => {
  if (err) throw err;
  console.log('Fastify server running with @aetherframework/database');
});
```

With NestJS

```javascript
// database.module.ts
import { Module } from '@nestjs/common';
import { Database } from '@aetherframework/database';

@Module({
  providers: [
    {
      provide: 'DATABASE',
      useFactory: async () => {
        const db = new Database({
          connections: {
            primary: {
              type: 'mysql',
              host: 'localhost',
              user: 'root',
              password: 'password',
              database: 'myapp'
            }
          }
        });
        await db.init();
        return db;
      }
    }
  ],
  exports: ['DATABASE']
})
export class DatabaseModule {}

// users.service.ts
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(@Inject('DATABASE') private db) {}

  async findAll() {
    return await this.db.table('users').select('*').execute();
  }
}
```

📚 Basic Usage Guide

1. Simple Configuration

```javascript
import { Database } from '@aetherframework/database';

// Basic setup for a single database
const db = new Database({
  connections: {
    primary: {
      type: 'sqlite', // or 'mysql', 'postgresql', 'mongodb', 'redis'
      database: './data/myapp.db' // SQLite file path
    }
  }
});

await db.init();
```

2. Creating Tables

```javascript
// Create a simple users table
await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    age INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
```

3. Basic CRUD Operations

Create (Insert)

```javascript
// Insert a single record
const result = await db.table('users')
  .insert({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30
  })
  .execute();

console.log(`Inserted user with ID: ${result.lastID}`);

// Insert multiple records
const batchResult = await db.table('users')
  .insert([
    { name: 'Alice', email: 'alice@example.com', age: 25 },
    { name: 'Bob', email: 'bob@example.com', age: 35 },
    { name: 'Charlie', email: 'charlie@example.com', age: 28 }
  ])
  .execute();

console.log(`Inserted ${batchResult.affectedRows} users`);
```

Read (Select)

```javascript
// Get all users
const allUsers = await db.table('users').select('*').execute();
console.log(`Total users: ${allUsers.rows.length}`);

// Get specific columns
const names = await db.table('users')
  .select('id', 'name', 'email')
  .execute();

// Get with conditions
const adults = await db.table('users')
  .select('*')
  .where('age', '>=', 18)
  .execute();

// Get with multiple conditions
const activeUsers = await db.table('users')
  .select('*')
  .where('age', '>=', 18)
  .where('status', '=', 'active')
  .execute();

// Get with OR conditions
const specificUsers = await db.table('users')
  .select('*')
  .where('name', '=', 'John')
  .orWhere('name', '=', 'Jane')
  .execute();

// Get with ordering and limits
const recentUsers = await db.table('users')
  .select('*')
  .orderBy('created_at', 'desc')
  .limit(10)
  .execute();

// Get single record
const user = await db.table('users')
  .where('id', '=', 1)
  .first();
```

Update

```javascript
// Update single record
const updateResult = await db.table('users')
  .where('id', '=', 1)
  .update({
    name: 'John Updated',
    age: 31
  })
  .execute();

console.log(`Updated ${updateResult.affectedRows} user(s)`);

// Update multiple records
const bulkUpdate = await db.table('users')
  .where('status', '=', 'inactive')
  .update({ status: 'active' })
  .execute();

// Increment/decrement values
await db.table('users')
  .where('id', '=', 1)
  .increment('login_count', 1)
  .execute();

await db.table('users')
  .where('id', '=', 2)
  .decrement('balance', 100)
  .execute();
```

Delete

```javascript
// Delete single record
const deleteResult = await db.table('users')
  .where('id', '=', 1)
  .delete()
  .execute();

console.log(`Deleted ${deleteResult.affectedRows} user(s)`);

// Delete with conditions
await db.table('users')
  .where('status', '=', 'banned')
  .where('last_login', '<', new Date('2023-01-01'))
  .delete()
  .execute();
```

4. Working with Different Databases

MySQL

```javascript
const mysqlDB = new Database({
  connections: {
    primary: {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'myapp',
      charset: 'utf8mb4'
    }
  }
});
```

PostgreSQL

```javascript
const pgDB = new Database({
  connections: {
    primary: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'password',
      database: 'myapp',
      ssl: false
    }
  }
});
```

SQLite

```javascript
const sqliteDB = new Database({
  connections: {
    primary: {
      type: 'sqlite',
      database: './data/app.db' // File path
      // or ':memory:' for in-memory database
    }
  }
});
```

MongoDB

```javascript
const mongoDB = new Database({
  connections: {
    primary: {
      type: 'mongodb',
      host: 'localhost',
      port: 27017,
      database: 'myapp',
      // Optional authentication
      username: 'admin',
      password: 'password'
    }
  }
});

// MongoDB specific operations
const users = await mongoDB.collection('users')
  .find({ age: { $gt: 18 } })
  .sort({ name: 1 })
  .limit(10)
  .execute();
```

Redis

```javascript
const redisDB = new Database({
  connections: {
    cache: {
      type: 'redis',
      host: 'localhost',
      port: 6379,
      // Optional authentication
      password: 'password',
      db: 0,
      keyPrefix: 'myapp:'
    }
  }
});

// Redis operations
await redisDB.getConnection('cache').set('user:1', JSON.stringify(user));
const cachedUser = await redisDB.getConnection('cache').get('user:1');
```

5. Simple Joins and Relationships

```javascript
// Basic join
const usersWithOrders = await db.table('users')
  .select('users.*', 'orders.total_amount')
  .join('orders', 'users.id', '=', 'orders.user_id')
  .execute();

// Left join
const allUsersWithOrders = await db.table('users')
  .select('users.*', 'orders.total_amount')
  .leftJoin('orders', 'users.id', '=', 'orders.user_id')
  .execute();

// Multiple joins
const detailedData = await db.table('users')
  .select(
    'users.name',
    'orders.order_number',
    'products.name as product_name',
    'order_items.quantity'
  )
  .join('orders', 'users.id', '=', 'orders.user_id')
  .join('order_items', 'orders.id', '=', 'order_items.order_id')
  .join('products', 'order_items.product_id', '=', 'products.id')
  .where('users.status', '=', 'active')
  .execute();
```

6. Aggregation Functions

```javascript
// Count records
const userCount = await db.table('users').count().execute();
console.log(`Total users: ${userCount.rows.count}`);

// Count with condition
const activeUsers = await db.table('users')
  .where('status', '=', 'active')
  .count()
  .execute();

// Sum values
const totalSales = await db.table('orders')
  .where('status', '=', 'completed')
  .sum('amount')
  .execute();

// Average values
const avgAge = await db.table('users').avg('age').execute();

// Minimum and maximum
const youngest = await db.table('users').min('age').execute();
const oldest = await db.table('users').max('age').execute();

// Group by
const salesByMonth = await db.table('orders')
  .select(
    db.raw('YEAR(created_at) as year'),
    db.raw('MONTH(created_at) as month'),
    db.raw('SUM(amount) as total_sales')
  )
  .where('status', '=', 'completed')
  .groupBy('year', 'month')
  .orderBy('year', 'desc')
  .orderBy('month', 'desc')
  .execute();
```

7. Simple Transactions

```javascript
// Basic transaction
try {
  const result = await db.transaction(async (trx) => {
    // Insert user
    const user = await trx.table('users')
      .insert({
        name: 'John',
        email: 'john@example.com'
      })
      .execute();

    // Insert user profile
    await trx.table('profiles')
      .insert({
        user_id: user.lastID,
        bio: 'Software Developer'
      })
      .execute();

    return user;
  });

  console.log('Transaction completed:', result);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

8. Error Handling

```javascript
try {
  const result = await db.table('users')
    .where('id', '=', 999)
    .first();
  
  if (!result) {
    console.log('User not found');
  }
} catch (error) {
  console.error('Database error:', {
    message: error.message,
    code: error.code,
    sql: error.sql,
    params: error.params
  });
  
  // Handle specific error types
  if (error.code === 'ER_DUP_ENTRY') {
    console.log('Duplicate entry error');
  } else if (error.code === 'ER_NO_SUCH_TABLE') {
    console.log('Table does not exist');
  }
}
```

9. Connection Management

```javascript
// Check connection status
const health = await db.getAllHealthChecks();
console.log('Database health:', health);

// Get connection statistics
const stats = db.getMetrics();
console.log('Query statistics:', {
  totalQueries: stats.totalQueries,
  successfulQueries: stats.successfulQueries,
  failedQueries: stats.failedQueries,
  avgQueryTime: stats.avgQueryTime
});

// Close connections when done
await db.close();
console.log('Database connections closed');
```

🔧 Common Patterns

1. Pagination

```javascript
async function getUsers(page = 1, limit = 10) {
  const offset = (page - 1) * limit;
  
  const users = await db.table('users')
    .select('*')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();
  
  const total = await db.table('users').count().execute();
  
  return {
    data: users.rows,
    pagination: {
      page,
      limit,
      total: total.rows.count,
      pages: Math.ceil(total.rows.count / limit)
    }
  };
}
```

2. Search Functionality

```javascript
async function searchUsers(query, filters = {}) {
  let builder = db.table('users').select('*');
  
  // Search in multiple fields
  if (query) {
    builder = builder.where(function(qb) {
      qb.where('name', 'LIKE', `%${query}%`)
        .orWhere('email', 'LIKE', `%${query}%`)
        .orWhere('bio', 'LIKE', `%${query}%`);
    });
  }
  
  // Apply filters
  if (filters.status) {
    builder = builder.where('status', '=', filters.status);
  }
  
  if (filters.minAge) {
    builder = builder.where('age', '>=', filters.minAge);
  }
  
  if (filters.maxAge) {
    builder = builder.where('age', '<=', filters.maxAge);
  }
  
  // Order and paginate
  const result = await builder
    .orderBy(filters.sortBy || 'created_at', filters.sortOrder || 'desc')
    .limit(filters.limit || 20)
    .offset(filters.offset || 0)
    .execute();
  
  return result.rows;
}
```

3. Batch Operations

```javascript
// Batch insert with validation
async function batchCreateUsers(users) {
  const validUsers = users.filter(user => 
    user.name && user.email && user.age > 0
  );
  
  if (validUsers.length === 0) {
    return { success: false, message: 'No valid users to insert' };
  }
  
  try {
    const result = await db.table('users')
      .insert(validUsers)
      .execute();
    
    return {
      success: true,
      inserted: result.affectedRows,
      skipped: users.length - validUsers.length
    };
  } catch (error) {
    console.error('Batch insert failed:', error);
    return { success: false, error: error.message };
  }
}
```

⚙️ Configuration Examples

Minimal Configuration

```javascript
const minimalConfig = {
  connections: {
    primary: {
      type: 'sqlite',
      database: './data/app.db'
    }
  }
};
```

Production Configuration

```javascript
const productionConfig = {
  enabled: true,
  crossDb: true,
  default: 'primary',
  
  connections: {
    primary: {
      type: 'mysql',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      timezone: '+00:00',
      pool: {
        min: 2,
        max: 10,
        idleTimeout: 30000,
        acquireTimeout: 10000
      }
    },
    cache: {
      type: 'redis',
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      db: 0,
      keyPrefix: 'app:'
    }
  },
  
  driverModules: {
    mysql: true,
    redis: true,
    sqlite: false,
    postgres: false,
    mongodb: false,
    mssql: false,
    oracle: false
  },
  
  middleware: {
    queryLogger: {
      enabled: process.env.NODE_ENV !== 'production',
      logLevel: 'info',
      slowQueryThreshold: 1000
    },
    connectionPool: {
      enabled: true,
      maxConnections: 10,
      minConnections: 2
    },
    queryCache: {
      enabled: true,
      ttl: 300000
    }
  }
};
```

🔄 Migration from Other Libraries

From Knex.js

```javascript
// Knex.js
knex('users').where('id', 1).first();

// @aetherframework/database
db.table('users').where('id', '=', 1).first();
```

From Sequelize

```javascript
// Sequelize
User.findAll({ where: { status: 'active' } });

// @aetherframework/database
db.table('users').where('status', '=', 'active').execute();
```

From TypeORM

```javascript
// TypeORM
userRepository.find({ where: { age: MoreThan(18) } });

// @aetherframework/database
db.table('users').where('age', '>', 18).execute();
```

🏆 Best Practices

1. Always use parameterized queries - Prevents SQL injection
2. Close connections when done - Prevents connection leaks
3. Use transactions for multiple operations - Ensures data consistency
4. Enable query logging in development - Helps with debugging
5. Use connection pooling in production - Improves performance
6. Implement proper error handling - Graceful degradation
7. Use TypeScript for type safety - Catches errors at compile time

🔧 Troubleshooting

Common Issues

1. Connection refused
   ```javascript
   // Check your connection settings
   const db = new Database({
     connections: {
       primary: {
         type: 'mysql',
         host: 'localhost', // Make sure this is correct
         port: 3306,        // Default MySQL port
         user: 'root',      // Check username
         password: 'password', // Check password
         database: 'myapp'  // Database must exist
       }
     }
   });
   ```

2. Table doesn't exist
   ```javascript
   // Create the table first
   await db.query(`
     CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL
     )
   `);
   ```

3. Slow queries
   ```javascript
   // Enable query logging to identify slow queries
   const db = new Database({
     middleware: {
       queryLogger: {
         enabled: true,
         slowQueryThreshold: 100 // Log queries slower than 100ms
       }
     }
   });
   ```

🚀 Next Steps

Once you're comfortable with the basics, explore these advanced features:

1. Query Caching - Improve performance with built-in caching
2. Performance Monitoring - Track and optimize query performance
3. Database Migrations - Version control for your database schema
4. Multiple Database Connections - Work with different databases simultaneously
5. Custom Drivers - Extend support for other database systems


📄 License

MIT © AetherJS Team