/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/src/utils/migration-runner
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migration Runner - Handles database migrations
 */
class MigrationRunner {
  constructor(database, options = {}) {
    this.database = database;
    this.options = {
      migrationsTable: options.migrationsTable || 'migrations',
      migrationsPath: options.migrationsPath || './migrations',
      useTransactions: options.useTransactions !== false,
      ...options
    };
    
    this.migrations = [];
    this.appliedMigrations = [];
  }

  /**
   * Initialize migrations table
   * @returns {Promise<void>}
   */
  async init() {
    try {
      // Check if migrations table exists
      const tableExists = await this.checkMigrationsTable();
      
      if (!tableExists) {
        await this.createMigrationsTable();

      }
      
      // Load applied migrations
      await this.loadAppliedMigrations();
      
      // Discover migration files
      await this.discoverMigrations();

    } catch (error) {
      console.error('❌ Failed to initialize migration runner:', error.message);
      throw error;
    }
  }

  /**
   * Check if migrations table exists
   * @returns {Promise<boolean>} True if table exists
   */
  async checkMigrationsTable() {
    try {
      const sql = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = '${this.options.migrationsTable}'
        ) as exists;
      `;
      
      const result = await this.database.query(sql);
      return result.rows && result.rows.length > 0 && result.rows[0].exists;
    } catch (error) {
      // Table doesn't exist or query failed
      return false;
    }
  }

  /**
   * Create migrations table
   * @returns {Promise<void>}
   */
  async createMigrationsTable() {
    const sql = `
      CREATE TABLE ${this.options.migrationsTable} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        batch INTEGER NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time INTEGER,
        status VARCHAR(50) DEFAULT 'completed',
        error_message TEXT
      );
    `;
    
    await this.database.query(sql);
  }

  /**
   * Load applied migrations from database
   * @returns {Promise<void>}
   */
  async loadAppliedMigrations() {
    try {
      const sql = `SELECT * FROM ${this.options.migrationsTable} ORDER BY id ASC`;
      const result = await this.database.query(sql);
      
      if (result.rows) {
        this.appliedMigrations = result.rows;
      }
    } catch (error) {
      console.warn('⚠️ Could not load applied migrations:', error.message);
      this.appliedMigrations = [];
    }
  }

  /**
   * Discover migration files
   * @returns {Promise<void>}
   */
  async discoverMigrations() {
    try {
      const migrationsPath = path.isAbsolute(this.options.migrationsPath)
        ? this.options.migrationsPath
        : path.join(process.cwd(), this.options.migrationsPath);
      
      if (!fs.existsSync(migrationsPath)) {
        console.warn(`⚠️ Migrations directory not found: ${migrationsPath}`);
        return;
      }
      
      const files = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.js') || file.endsWith('.sql'))
        .sort();
      
      for (const file of files) {
        const migration = await this.parseMigrationFile(file, migrationsPath);
        if (migration) {
          this.migrations.push(migration);
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Parse migration file
   * @param {string} filename - Migration filename
   * @param {string} migrationsPath - Migrations directory path
   * @returns {Promise<Object|null>} Migration object or null
   */
  async parseMigrationFile(filename, migrationsPath) {
    const filePath = path.join(migrationsPath, filename);
    const match = filename.match(/^(\d+)_(.+)\.(js|sql)$/);
    
    if (!match) {
      console.warn(`⚠️ Skipping invalid migration file: ${filename}`);
      return null;
    }
    
    const [, timestamp, name, extension] = match;
    
    // Check if migration is already applied
    const isApplied = this.appliedMigrations.some(m => m.name === filename);
    
    return {
      filename,
      name,
      timestamp: parseInt(timestamp),
      path: filePath,
      extension,
      isApplied,
      appliedAt: isApplied 
        ? this.appliedMigrations.find(m => m.name === filename)?.applied_at 
        : null,
      status: isApplied 
        ? this.appliedMigrations.find(m => m.name === filename)?.status || 'completed'
        : 'pending'
    };
  }

  /**
   * Get pending migrations
   * @returns {Array} Pending migrations
   */
  getPendingMigrations() {
    return this.migrations.filter(m => !m.isApplied);
  }

  /**
   * Get applied migrations
   * @returns {Array} Applied migrations
   */
  getAppliedMigrations() {
    return this.migrations.filter(m => m.isApplied);
  }

  /**
   * Get migration status
   * @returns {Object} Migration status
   */
  getStatus() {
    const pending = this.getPendingMigrations();
    const applied = this.getAppliedMigrations();
    
    return {
      total: this.migrations.length,
      pending: pending.length,
      applied: applied.length,
      pendingMigrations: pending.map(m => ({
        name: m.name,
        filename: m.filename,
        timestamp: m.timestamp
      })),
      appliedMigrations: applied.map(m => ({
        name: m.name,
        filename: m.filename,
        timestamp: m.timestamp,
        appliedAt: m.appliedAt,
        status: m.status
      })),
      lastApplied: applied.length > 0 ? applied[applied.length - 1] : null,
      nextPending: pending.length > 0 ? pending[0] : null
    };
  }

  /**
   * Run migrations
   * @param {number} limit - Maximum number of migrations to run
   * @returns {Promise<Object>} Migration results
   */
  async runMigrations(limit = null) {
    const pendingMigrations = this.getPendingMigrations();
    const migrationsToRun = limit 
      ? pendingMigrations.slice(0, limit)
      : pendingMigrations;
    
    if (migrationsToRun.length === 0) {
      return {
        success: true,
        message: 'No pending migrations to run',
        migrationsRun: 0,
        details: []
      };
    }
    
    const results = [];
    let batch = 1;
    
    // Get current batch number
    if (this.appliedMigrations.length > 0) {
      const lastBatch = Math.max(...this.appliedMigrations.map(m => m.batch));
      batch = lastBatch + 1;
    }
    
    for (const migration of migrationsToRun) {
      const startTime = Date.now();
      
      try {
        
        if (this.options.useTransactions) {
          await this.database.transaction(async (trx) => {
            await this.executeMigration(migration, trx);
          });
        } else {
          await this.executeMigration(migration, this.database);
        }
        
        const executionTime = Date.now() - startTime;
        
        // Record migration as applied
        await this.recordMigration(migration, batch, executionTime, 'completed');
        
        migration.isApplied = true;
        migration.appliedAt = new Date().toISOString();
        migration.status = 'completed';
        
        results.push({
          migration: migration.filename,
          status: 'completed',
          executionTime,
          message: 'Migration completed successfully'
        });
        
      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        // Record migration as failed
        await this.recordMigration(migration, batch, executionTime, 'failed', error.message);
        
        results.push({
          migration: migration.filename,
          status: 'failed',
          executionTime,
          error: error.message,
          message: 'Migration failed'
        });
        
        // If using transactions, stop on first failure
        if (this.options.useTransactions) {
          break;
        }
      }
    }
    
    // Reload applied migrations
    await this.loadAppliedMigrations();
    
    const success = results.every(r => r.status === 'completed');
    
    return {
      success,
      message: success 
        ? `Successfully ran ${results.length} migration(s)` 
        : 'Some migrations failed',
      migrationsRun: results.length,
      successful: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'failed').length,
      details: results
    };
  }

  /**
   * Execute migration
   * @param {Object} migration - Migration object
   * @param {Object} connection - Database connection
   * @returns {Promise<void>}
   */
  async executeMigration(migration, connection) {
    if (migration.extension === 'sql') {
      // SQL file migration
      const sql = fs.readFileSync(migration.path, 'utf8');
      await connection.query(sql);
    } else if (migration.extension === 'js') {
      // JavaScript migration
      const migrationModule = await import(`file://${migration.path}`);
      
      if (typeof migrationModule.up === 'function') {
        await migrationModule.up(connection);
      } else {
        throw new Error(`Migration ${migration.filename} does not export an 'up' function`);
      }
    } else {
      throw new Error(`Unsupported migration type: ${migration.extension}`);
    }
  }

  /**
   * Record migration in database
   * @param {Object} migration - Migration object
   * @param {number} batch - Batch number
   * @param {number} executionTime - Execution time in ms
   * @param {string} status - Migration status
   * @param {string} errorMessage - Error message (if failed)
   * @returns {Promise<void>}
   */
  async recordMigration(migration, batch, executionTime, status = 'completed', errorMessage = null) {
    const sql = `
      INSERT INTO ${this.options.migrationsTable} 
      (name, batch, execution_time, status, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    await this.database.query(sql, [
      migration.filename,
      batch,
      executionTime,
      status,
      errorMessage
    ]);
  }

  /**
   * Rollback migrations
   * @param {number} steps - Number of migrations to rollback
   * @returns {Promise<Object>} Rollback results
   */
  async rollbackMigrations(steps = 1) {
    const appliedMigrations = this.getAppliedMigrations();
    const migrationsToRollback = appliedMigrations.slice(-steps).reverse();
    
    if (migrationsToRollback.length === 0) {
      return {
        success: true,
        message: 'No migrations to rollback',
        migrationsRolledBack: 0,
        details: []
      };
    }
    
    const results = [];
    
    for (const migration of migrationsToRollback) {
      const startTime = Date.now();
      
      try {
        
        if (this.options.useTransactions) {
          await this.database.transaction(async (trx) => {
            await this.executeRollback(migration, trx);
          });
        } else {
          await this.executeRollback(migration, this.database);
        }
        
        const executionTime = Date.now() - startTime;
        
        // Remove migration record
        await this.removeMigrationRecord(migration);
        
        migration.isApplied = false;
        migration.appliedAt = null;
        migration.status = 'rolled back';
        
        results.push({
          migration: migration.filename,
          status: 'rolled back',
          executionTime,
          message: 'Migration rolled back successfully'
        });
        
      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        results.push({
          migration: migration.filename,
          status: 'failed',
          executionTime,
          error: error.message,
          message: 'Rollback failed'
        });
        
        console.error(`❌ Rollback failed: ${migration.filename}`, error.message);
        
        // If using transactions, stop on first failure
        if (this.options.useTransactions) {
          break;
        }
      }
    }
    
    // Reload applied migrations
    await this.loadAppliedMigrations();
    
    const success = results.every(r => r.status === 'rolled back');
    
    return {
      success,
      message: success 
        ? `Successfully rolled back ${results.length} migration(s)` 
        : 'Some rollbacks failed',
      migrationsRolledBack: results.filter(r => r.status === 'rolled back').length,
      failed: results.filter(r => r.status === 'failed').length,
      details: results
    };
  }
  /**
   * Execute rollback
   * @param {Object} migration - Migration object
   * @param {Object} connection - Database connection
   * @returns {Promise<void>}
   */
  async executeRollback(migration, connection) {
    if (migration.extension === 'sql') {
      // For SQL files, we need to parse and execute down statements
      // This requires migration files to have -- DOWN comment section
      const sql = fs.readFileSync(migration.path, 'utf8');
      const downSql = this.extractDownSQL(sql);
      
      if (!downSql) {
        throw new Error(`Migration ${migration.filename} does not contain DOWN section`);
      }
      
      await connection.query(downSql);
    } else if (migration.extension === 'js') {
      // JavaScript migration
      const migrationModule = await import(`file://${migration.path}`);
      
      if (typeof migrationModule.down === 'function') {
        await migrationModule.down(connection);
      } else {
        throw new Error(`Migration ${migration.filename} does not export a 'down' function`);
      }
    } else {
      throw new Error(`Unsupported migration type: ${migration.extension}`);
    }
  }

  /**
   * Extract DOWN SQL from migration file
   * @param {string} sql - Full SQL content
   * @returns {string|null} DOWN SQL or null
   */
  extractDownSQL(sql) {
    const lines = sql.split('\n');
    let inDownSection = false;
    let downSql = [];
    
    for (const line of lines) {
      if (line.trim().toUpperCase().startsWith('-- DOWN')) {
        inDownSection = true;
        continue;
      }
      
      if (line.trim().toUpperCase().startsWith('-- UP') && inDownSection) {
        break;
      }
      
      if (inDownSection && !line.trim().startsWith('--')) {
        downSql.push(line);
      }
    }
    
    return downSql.length > 0 ? downSql.join('\n').trim() : null;
  }

  /**
   * Remove migration record from database
   * @param {Object} migration - Migration object
   * @returns {Promise<void>}
   */
  async removeMigrationRecord(migration) {
    const sql = `DELETE FROM ${this.options.migrationsTable} WHERE name = $1`;
    await this.database.query(sql, [migration.filename]);
  }

  /**
   * Create migration file
   * @param {string} name - Migration name
   * @param {string} type - Migration type (sql or js)
   * @returns {Promise<string>} Created migration file path
   */
  async createMigration(name, type = 'js') {
    const timestamp = Date.now();
    const filename = `${timestamp}_${name}.${type}`;
    const migrationsPath = path.isAbsolute(this.options.migrationsPath)
      ? this.options.migrationsPath
      : path.join(process.cwd(), this.options.migrationsPath);
    
    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsPath)) {
      fs.mkdirSync(migrationsPath, { recursive: true });
    }
    
    const filePath = path.join(migrationsPath, filename);
    
    if (type === 'sql') {
      await this.createSQLMigration(filePath, name);
    } else if (type === 'js') {
      await this.createJSMigration(filePath, name);
    } else {
      throw new Error(`Unsupported migration type: ${type}`);
    }
    
    return filePath;
  }

  /**
   * Create SQL migration file
   * @param {string} filePath - File path
   * @param {string} name - Migration name
   * @returns {Promise<void>}
   */
  async createSQLMigration(filePath, name) {
    const template = `-- Migration: ${name}
-- Created at: ${new Date().toISOString()}

-- UP: Apply migration
-- Add your SQL statements here
-- Example:
-- CREATE TABLE users (
--   id SERIAL PRIMARY KEY,
--   name VARCHAR(100) NOT NULL,
--   email VARCHAR(255) UNIQUE NOT NULL,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- DOWN: Rollback migration
-- Add your rollback SQL statements here
-- Example:
-- DROP TABLE IF EXISTS users;
`;

    fs.writeFileSync(filePath, template, 'utf8');
  }

  /**
   * Create JavaScript migration file
   * @param {string} filePath - File path
   * @param {string} name - Migration name
   * @returns {Promise<void>}
   */
  async createJSMigration(filePath, name) {
    const template = `/**
 * Migration: ${name}
 * Created at: ${new Date().toISOString()}
 */

/**
 * Apply migration
 * @param {Object} db - Database connection
 * @returns {Promise<void>}
 */
export async function up(db) {
  // Add your migration logic here
  // Example:
  // await db.query(\`
  //   CREATE TABLE users (
  //     id SERIAL PRIMARY KEY,
  //     name VARCHAR(100) NOT NULL,
  //     email VARCHAR(255) UNIQUE NOT NULL,
  //     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  //   )
  // \`);
}

/**
 * Rollback migration
 * @param {Object} db - Database connection
 * @returns {Promise<void>}
 */
export async function down(db) {
  // Add your rollback logic here
  // Example:
  // await db.query('DROP TABLE IF EXISTS users');
}
`;

    fs.writeFileSync(filePath, template, 'utf8');
  }

  /**
   * Reset all migrations (development only)
   * @returns {Promise<Object>} Reset results
   */
  async resetMigrations() {
    console.warn('⚠️ WARNING: This will remove all migration records from the database!');
    console.warn('⚠️ This operation is irreversible and should only be used in development.');
    
    try {
      const sql = `DROP TABLE IF EXISTS ${this.options.migrationsTable}`;
      await this.database.query(sql);
      
      // Recreate migrations table
      await this.createMigrationsTable();
      
      // Reload migrations
      await this.discoverMigrations();
      this.appliedMigrations = [];
      
      return {
        success: true,
        message: 'Migrations reset successfully',
        migrationsTable: this.options.migrationsTable,
        resetAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Failed to reset migrations:', error.message);
      throw error;
    }
  }

  /**
   * Get migration history
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Migration history
   */
  async getMigrationHistory(options = {}) {
    const { limit = 50, offset = 0, status = null, batch = null } = options;
    
    let sql = `SELECT * FROM ${this.options.migrationsTable}`;
    const params = [];
    const conditions = [];
    
    if (status) {
      conditions.push('status = $' + (params.length + 1));
      params.push(status);
    }
    
    if (batch) {
      conditions.push('batch = $' + (params.length + 1));
      params.push(batch);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await this.database.query(sql, params);
    return result.rows || [];
  }

  /**
   * Get migration batches
   * @returns {Promise<Array>} Migration batches
   */
  async getMigrationBatches() {
    const sql = `
      SELECT 
        batch,
        COUNT(*) as migration_count,
        MIN(applied_at) as started_at,
        MAX(applied_at) as completed_at,
        SUM(execution_time) as total_execution_time,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM ${this.options.migrationsTable}
      GROUP BY batch
      ORDER BY batch DESC
    `;
    
    const result = await this.database.query(sql);
    return result.rows || [];
  }

  /**
   * Get migration statistics
   * @returns {Promise<Object>} Migration statistics
   */
  async getMigrationStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_migrations,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_migrations,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_migrations,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_migrations,
        COUNT(DISTINCT batch) as total_batches,
        AVG(execution_time) as avg_execution_time,
        MAX(execution_time) as max_execution_time,
        MIN(execution_time) as min_execution_time,
        SUM(execution_time) as total_execution_time
      FROM ${this.options.migrationsTable}
    `;
    
    const result = await this.database.query(sql);
    const stats = result.rows?.[0] || {};
    
    // Add pending migrations from discovered files
    const pendingMigrations = this.getPendingMigrations();
    stats.pending_migrations = pendingMigrations.length;
    stats.total_discovered = this.migrations.length;
    
    return stats;
  }

  /**
   * Validate migration files
   * @returns {Promise<Object>} Validation results
   */
  async validateMigrations() {
    const issues = [];
    const warnings = [];
    
    for (const migration of this.migrations) {
      // Check file exists
      if (!fs.existsSync(migration.path)) {
        issues.push({
          migration: migration.filename,
          type: 'file_not_found',
          message: 'Migration file not found',
          severity: 'error'
        });
        continue;
      }
      
      // Check file format
      if (migration.extension === 'sql') {
        const content = fs.readFileSync(migration.path, 'utf8');
        
        // Check for UP section
        if (!content.includes('-- UP')) {
          warnings.push({
            migration: migration.filename,
            type: 'missing_up_section',
            message: 'SQL migration missing -- UP section',
            severity: 'warning'
          });
        }
        
        // Check for DOWN section
        if (!content.includes('-- DOWN')) {
          warnings.push({
            migration: migration.filename,
            type: 'missing_down_section',
            message: 'SQL migration missing -- DOWN section',
            severity: 'warning'
          });
        }
        
        // Check for valid SQL syntax (basic check)
        const sqlLines = content.split('\n').filter(line => 
          !line.trim().startsWith('--') && line.trim().length > 0
        );
        
        if (sqlLines.length === 0) {
          warnings.push({
            migration: migration.filename,
            type: 'empty_migration',
            message: 'SQL migration appears to be empty',
            severity: 'warning'
          });
        }
      } else if (migration.extension === 'js') {
        try {
          const migrationModule = await import(`file://${migration.path}`);
          
          // Check for up function
          if (typeof migrationModule.up !== 'function') {
            issues.push({
              migration: migration.filename,
              type: 'missing_up_function',
              message: 'JavaScript migration missing export.up function',
              severity: 'error'
            });
          }
          
          // Check for down function
          if (typeof migrationModule.down !== 'function') {
            warnings.push({
              migration: migration.filename,
              type: 'missing_down_function',
              message: 'JavaScript migration missing export.down function',
              severity: 'warning'
            });
          }
        } catch (error) {
          issues.push({
            migration: migration.filename,
            type: 'module_error',
            message: `Failed to load migration module: ${error.message}`,
            severity: 'error'
          });
        }
      }
    }
    
    // Check for duplicate timestamps
    const timestamps = this.migrations.map(m => m.timestamp);
    const duplicateTimestamps = timestamps.filter((t, i) => timestamps.indexOf(t) !== i);
    
    if (duplicateTimestamps.length > 0) {
      issues.push({
        type: 'duplicate_timestamps',
        message: `Duplicate migration timestamps found: ${duplicateTimestamps.join(', ')}`,
        severity: 'error'
      });
    }
    
    // Check for gaps in applied migrations
    const appliedTimestamps = this.appliedMigrations
      .map(m => parseInt(m.name.split('_')[0]))
      .sort((a, b) => a - b);
    
    if (appliedTimestamps.length > 1) {
      for (let i = 1; i < appliedTimestamps.length; i++) {
        if (appliedTimestamps[i] - appliedTimestamps[i-1] > 1) {
          warnings.push({
            type: 'timestamp_gap',
            message: `Gap in applied migration timestamps: ${appliedTimestamps[i-1]} -> ${appliedTimestamps[i]}`,
            severity: 'warning'
          });
        }
      }
    }
    
    return {
      valid: issues.length === 0,
      issues,
      warnings,
      migrationCount: this.migrations.length,
      appliedCount: this.appliedMigrations.length,
      pendingCount: this.getPendingMigrations().length
    };
  }

  /**
   * Generate migration report
   * @returns {Promise<Object>} Migration report
   */
  async generateReport() {
    const status = this.getStatus();
    const stats = await this.getMigrationStats();
    const batches = await this.getMigrationBatches();
    const validation = await this.validateMigrations();
    
    return {
      timestamp: new Date().toISOString(),
      status,
      stats,
      batches,
      validation,
      recommendations: this.generateRecommendations(status, stats, validation)
    };
  }

  /**
   * Generate recommendations based on migration status
   * @param {Object} status - Migration status
   * @param {Object} stats - Migration statistics
   * @param {Object} validation - Validation results
   * @returns {Array} Recommendations
   */
  generateRecommendations(status, stats, validation) {
    const recommendations = [];
    
    // Check for pending migrations
    if (status.pending > 0) {
      recommendations.push({
        type: 'pending_migrations',
        message: `There are ${status.pending} pending migrations. Run them with runMigrations().`,
        priority: 'high'
      });
    }
    
    // Check for failed migrations
    if (stats.failed_migrations > 0) {
      recommendations.push({
        type: 'failed_migrations',
        message: `There are ${stats.failed_migrations} failed migrations. Review and fix them.`,
        priority: 'high'
      });
    }
    
    // Check for validation issues
    if (!validation.valid) {
      recommendations.push({
        type: 'validation_issues',
        message: `There are ${validation.issues.length} validation issues that need to be fixed.`,
        priority: 'high'
      });
    }
    
    // Check for validation warnings
    if (validation.warnings.length > 0) {
      recommendations.push({
        type: 'validation_warnings',
        message: `There are ${validation.warnings.length} validation warnings to review.`,
        priority: 'medium'
      });
    }
    
    // Check for old migrations
    if (status.applied > 0 && status.applied > 10) {
      recommendations.push({
        type: 'many_migrations',
        message: `There are ${status.applied} applied migrations. Consider consolidating old migrations.`,
        priority: 'low'
      });
    }
    
    // Check for migration performance
    if (stats.avg_execution_time > 1000) {
      recommendations.push({
        type: 'slow_migrations',
        message: `Average migration execution time is ${stats.avg_execution_time.toFixed(2)}ms. Consider optimizing slow migrations.`,
        priority: 'medium'
      });
    }
    
    return recommendations;
  }

  /**
   * Export migration data
   * @param {string} format - Export format (json, csv)
   * @returns {Promise<string>} Exported data
   */
  async export(format = 'json') {
    const report = await this.generateReport();
    
    switch (format.toLowerCase()) {
      case 'csv':
        return this.exportToCSV(report);
      case 'json':
      default:
        return JSON.stringify(report, null, 2);
    }
  }

  /**
   * Export to CSV
   * @param {Object} report - Migration report
   * @returns {string} CSV data
   */
  exportToCSV(report) {
    const csvLines = [];
    
    // Export migration status
    csvLines.push('=== MIGRATION STATUS ===');
    csvLines.push('Metric,Value');
    csvLines.push(`Total Migrations,${report.status.total}`);
    csvLines.push(`Applied Migrations,${report.status.applied}`);
    csvLines.push(`Pending Migrations,${report.status.pending}`);
    
    // Export migration statistics
    csvLines.push('\n=== MIGRATION STATISTICS ===');
    csvLines.push('Metric,Value');
    csvLines.push(`Total Migrations,${report.stats.total_migrations || 0}`);
    csvLines.push(`Completed Migrations,${report.stats.completed_migrations || 0}`);
    csvLines.push(`Failed Migrations,${report.stats.failed_migrations || 0}`);
    csvLines.push(`Pending Migrations,${report.stats.pending_migrations || 0}`);
    csvLines.push(`Total Batches,${report.stats.total_batches || 0}`);
    csvLines.push(`Average Execution Time,${report.stats.avg_execution_time || 0}`);
    csvLines.push(`Max Execution Time,${report.stats.max_execution_time || 0}`);
    csvLines.push(`Min Execution Time,${report.stats.min_execution_time || 0}`);
    csvLines.push(`Total Execution Time,${report.stats.total_execution_time || 0}`);
    
    // Export applied migrations
    if (report.status.appliedMigrations.length > 0) {
      csvLines.push('\n=== APPLIED MIGRATIONS ===');
      const headers = Object.keys(report.status.appliedMigrations[0]).join(',');
      csvLines.push(headers);
      report.status.appliedMigrations.forEach(migration => {
        const values = Object.values(migration).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    // Export pending migrations
    if (report.status.pendingMigrations.length > 0) {
      csvLines.push('\n=== PENDING MIGRATIONS ===');
      const headers = Object.keys(report.status.pendingMigrations[0]).join(',');
      csvLines.push(headers);
      report.status.pendingMigrations.forEach(migration => {
        const values = Object.values(migration).map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
        ).join(',');
        csvLines.push(values);
      });
    }
    
    // Export validation issues
    if (report.validation.issues.length > 0) {
      csvLines.push('\n=== VALIDATION ISSUES ===');
      csvLines.push('Migration,Type,Message,Severity');
      report.validation.issues.forEach(issue => {
        csvLines.push(`${issue.migration || 'N/A'},${issue.type},${issue.message},${issue.severity}`);
      });
    }
    
    // Export validation warnings
    if (report.validation.warnings.length > 0) {
      csvLines.push('\n=== VALIDATION WARNINGS ===');
      csvLines.push('Migration,Type,Message,Severity');
      report.validation.warnings.forEach(warning => {
        csvLines.push(`${warning.migration || 'N/A'},${warning.type},${warning.message},${warning.severity}`);
      });
    }
    
    // Export recommendations
    if (report.recommendations.length > 0) {
      csvLines.push('\n=== RECOMMENDATIONS ===');
      csvLines.push('Type,Message,Priority');
      report.recommendations.forEach(rec => {
        csvLines.push(`${rec.type},${rec.message},${rec.priority}`);
      });
    }
    
    return csvLines.join('\n');
  }
}

export default MigrationRunner;
