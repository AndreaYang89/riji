/**
 * AA日记 - 数据库初始化脚本
 * 运行: node db-init.js
 */
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
};

const DB_NAME = process.env.DB_NAME || 'aa_diary';

async function init() {
  // 1. 创建数据库
  const conn = await mysql.createConnection(DB_CONFIG);
  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.changeUser({ database: DB_NAME });

  // 2. 用户表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      device_token VARCHAR(64) UNIQUE NOT NULL COMMENT '设备标识，首次访问自动生成',
      role ENUM('girl','boy') DEFAULT NULL COMMENT '角色选择',
      pair_id VARCHAR(36) DEFAULT NULL COMMENT '所属配对关系ID',
      mood VARCHAR(20) DEFAULT 'happy',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pair (pair_id),
      INDEX idx_token (device_token)
    ) ENGINE=InnoDB
  `);

  // 3. 配对关系表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS pairs (
      id VARCHAR(36) PRIMARY KEY,
      invite_code VARCHAR(8) UNIQUE NOT NULL COMMENT '6位配对码',
      user_a_id VARCHAR(36) NOT NULL COMMENT '发起方用户ID',
      user_b_id VARCHAR(36) DEFAULT NULL COMMENT '接受方用户ID',
      anniversary DATE DEFAULT NULL,
      status ENUM('waiting','paired') DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_code (invite_code),
      INDEX idx_status (status)
    ) ENGINE=InnoDB
  `);

  // 4. 日记表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS diaries (
      id VARCHAR(36) PRIMARY KEY,
      pair_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      diary_date DATE NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_pair_user_date (pair_id, user_id, diary_date),
      INDEX idx_pair_date (pair_id, diary_date)
    ) ENGINE=InnoDB
  `);

  // 5. 卡券表（免死金牌）
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id VARCHAR(36) PRIMARY KEY,
      pair_id VARCHAR(36) NOT NULL,
      sender_id VARCHAR(36) NOT NULL,
      sender_role ENUM('girl','boy') NOT NULL,
      reason TEXT NOT NULL,
      status ENUM('available','pending','used') DEFAULT 'available',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pair (pair_id)
    ) ENGINE=InnoDB
  `);

  // 6. 心愿单表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS wishes (
      id VARCHAR(36) PRIMARY KEY,
      pair_id VARCHAR(36) NOT NULL,
      creator_id VARCHAR(36) NOT NULL,
      creator_role ENUM('girl','boy') NOT NULL,
      content VARCHAR(100) NOT NULL,
      completed TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pair (pair_id)
    ) ENGINE=InnoDB
  `);

  // 7. 倒数日表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS countdowns (
      id VARCHAR(36) PRIMARY KEY,
      pair_id VARCHAR(36) NOT NULL,
      title VARCHAR(40) NOT NULL,
      target_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pair (pair_id)
    ) ENGINE=InnoDB
  `);

  console.log(`✅ 数据库 [${DB_NAME}] 初始化完成，共 6 张表`);
  await conn.end();
}

init().catch(err => {
  console.error('❌ 数据库初始化失败:', err.message);
  process.exit(1);
});
