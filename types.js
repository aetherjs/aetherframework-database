// packages/database/types.js
/**
 * @typedef {Object} DatabaseConfig
 * @property {string} type - Database type: 'mysql', 'postgres', 'redis', 'mongodb', 'sqlite', 'mssql', 'oracle'
 * @property {string} [host] - Host address
 * @property {number} [port] - Port number
 * @property {string} [user] - Username
 * @property {string} [password] - Password
 * @property {string} [database] - Database name
 * @property {string} [filename] - SQLite file path
 * @property {Object} [options] - Additional options
 * @property {Object} [pool] - Connection pool options
 * @property {number} [pool.min] - Minimum connections
 * @property {number} [pool.max] - Maximum connections
 * @property {number} [pool.idleTimeout] - Idle timeout in ms
 * @property {number} [pool.acquireTimeout] - Acquire timeout in ms
 */

/**
 * @typedef {Object} QueryResult
 * @property {Array<any>} rows - Result rows
 * @property {number} rowCount - Number of affected rows
 * @property {any} [lastInsertId] - Last insert ID
 * @property {Array<string>} [columns] - Column names
 * @property {string} [commandTag] - Command tag (PostgreSQL)
 * @property {bigint} [cursorId] - Cursor ID (MongoDB)
 * @property {number} [numberReturned] - Number returned (MongoDB)
 */

/**
 * @typedef {Object} Connection
 * @property {boolean} connected - Connection status
 * @property {function(string, Array): Promise<QueryResult>} query - Execute query
 * @property {function(): Promise<void>} close - Close connection
 * @property {function(): Promise<void>} [beginTransaction] - Begin transaction
 * @property {function(): Promise<void>} [commit] - Commit transaction
 * @property {function(): Promise<void>} [rollback] - Rollback transaction
 * @property {function(function): Promise<any>} [transaction] - Execute transaction
 * @property {function(Array): Promise<Array>} [batch] - Batch operations
 */

/**
 * @typedef {Object} DriverInterface
 * @property {string} name - Driver name
 * @property {string} version - Driver version
 * @property {function(DatabaseConfig): Promise<Connection>} connect - Connect method
 * @property {function(Connection): Promise<void>} close - Close method
 * @property {function(Connection): Promise<Object>} [healthCheck] - Health check
 */

/**
 * @typedef {Object} QueryBuilderOptions
 * @property {string} tableName - Table name
 * @property {Connection} connection - Database connection
 * @property {string} dialect - Database dialect
 */

/**
 * @typedef {Object} QueryBuilder
 * @property {function(...string): QueryBuilder} select - Select columns
 * @property {function(): QueryBuilder} distinct - Distinct query
 * @property {function(string, string, any): QueryBuilder} where - Where condition
 * @property {function(string, Array): QueryBuilder} whereIn - Where IN condition
 * @property {function(string, Array): QueryBuilder} whereNotIn - Where NOT IN condition
 * @property {function(string): QueryBuilder} whereNull - Where NULL condition
 * @property {function(string): QueryBuilder} whereNotNull - Where NOT NULL condition
 * @property {function(string, Array): QueryBuilder} whereBetween - Where BETWEEN condition
 * @property {function(string, string): QueryBuilder} whereLike - Where LIKE condition
 * @property {function(string, string, any): QueryBuilder} orWhere - OR Where condition
 * @property {function(string, Array): QueryBuilder} whereRaw - Raw WHERE condition
 * @property {function(string, string): QueryBuilder} orderBy - Order by
 * @property {function(string, Array): QueryBuilder} orderByRaw - Raw ORDER BY
 * @property {function(...string): QueryBuilder} groupBy - Group by
 * @property {function(string, string, any): QueryBuilder} having - Having condition
 * @property {function(number): QueryBuilder} limit - Limit results
 * @property {function(number): QueryBuilder} offset - Offset results
 * @property {function(string, string, string, string, string): QueryBuilder} join - Join table
 * @property {function(string, string, string, string): QueryBuilder} leftJoin - LEFT JOIN
 * @property {function(string, string, string, string): QueryBuilder} rightJoin - RIGHT JOIN
 * @property {function(string): QueryBuilder} crossJoin - CROSS JOIN
 * @property {function(Object|Array): QueryBuilder} insert - Insert data
 * @property {function(Object): QueryBuilder} update - Update data
 * @property {function(): QueryBuilder} delete - Delete data
 * @property {function(...string): QueryBuilder} returning - Returning clause
 * @property {function(string): QueryBuilder} lock - Lock rows
 * @property {function(): Object} toSQL - Generate SQL
 * @property {function(): Promise<QueryResult>} execute - Execute query
 * @property {function(): Promise<Array>} all - Get all rows
 * @property {function(): Promise<any>} first - Get first row
 * @property {function(string): Promise<number>} count - Count rows
 * @property {function(number, number): Promise<Object>} paginate - Paginate results
 * @property {function(Object, string): Promise<any>} insertGetId - Insert and get ID
 * @property {function(Array, number): Promise<Array>} batchInsert - Batch insert
 * @property {function(): QueryBuilder} clone - Clone builder
 * @property {function(): string} toDebugSQL - Debug SQL
 * @property {function(): Promise<any>} explain - Explain query
 */

/**
 * @typedef {Object} DatabaseManager
 * @property {function(DatabaseConfig): Promise<DatabaseManager>} init - Initialize
 * @property {function(string, DatabaseConfig): Promise<Connection>} getConnection - Get connection
 * @property {function(string, Array, string): Promise<QueryResult>} query - Execute query
 * @property {function(string): QueryBuilder} table - Get query builder for table
 * @property {function(function, string): Promise<any>} transaction - Execute transaction
 * @property {function(Object): Promise<Object>} crossDbQuery - Cross-database query
 * @property {function(Array, string): Promise<Array>} batch - Batch operations
 * @property {function(string): Promise<Object>} healthCheck - Health check
 * @property {function(): Promise<Object>} getAllHealthChecks - All health checks
 * @property {function(): Object} getMetrics - Get metrics
 * @property {function(): void} clearCache - Clear query cache
 * @property {function(): Promise<void>} close - Close all connections
 * @property {function(boolean): void} setEnabled - Enable/disable
 * @property {function(): boolean} isDatabaseEnabled - Check if enabled
 */

/**
 * @typedef {Object} ConnectionPool
 * @property {function(): Promise<void>} init - Initialize pool
 * @property {function(): Promise<Connection>} getConnection - Get connection
 * @property {function(Connection): void} releaseConnection - Release connection
 * @property {function(string, Array): Promise<QueryResult>} query - Execute query
 * @property {function(): Object} getStats - Get statistics
 * @property {function(): Promise<Object>} healthCheck - Health check
 * @property {function(): Promise<void>} close - Close pool
 */

// Export for CommonJS
module.exports = {};
