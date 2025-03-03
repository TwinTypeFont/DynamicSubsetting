const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('資料庫連線失敗:', err.message);
    else console.log('📦 SQLite 連接成功');
});

const username = "admin";
const password = "password123";  // 修改這裡來更改初始密碼

async function createAdminUser() {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
        if (err) {
            console.error('❌ 用戶創建失敗:', err.message);
        } else {
            console.log('✅ 用戶創建成功！');
        }
        db.close();
    });
}

createAdminUser();
