const mysql = require('mysql2');

// 設定 MySQL 連線資訊
const db = mysql.createConnection({
    host: 'hnd1.clusters.zeabur.com',
    user: 'root',
    password: 'xXZ9w1574zmBkEW8gM2VHbCSc6Q3F0ov',
    database: 'font_subset_api',
    port: 30878
});

// 連接 MySQL
db.connect((err) => {
    if (err) {
        console.error('❌ MySQL 連線失敗:', err.message);
    } else {
        console.log('✅ MySQL 連接成功！');
    }
});

// 初始化資料表
db.query(`
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error("❌ 建立 users 表格失敗:", err.message);
    else console.log("✅ users 表格初始化完成");
});

db.query(`
    CREATE TABLE IF NOT EXISTS allowed_sites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        site_url VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`, (err) => {
    if (err) console.error("❌ 建立 allowed_sites 表格失敗:", err.message);
    else console.log("✅ allowed_sites 表格初始化完成");
});

// 匯出資料庫連接
module.exports = db;
