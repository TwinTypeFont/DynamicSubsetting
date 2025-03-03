const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/database');

const router = express.Router();

// **✅ 註冊 API**
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: '請提供用戶名與密碼' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: '用戶名已存在' });
        }
        res.json({ success: true, message: '註冊成功' });
    });
});

// **✅ 登入 API**
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: '請提供用戶名與密碼' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: '帳號或密碼錯誤' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, error: '帳號或密碼錯誤' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        console.log("✅ 登入成功，session 設置:", req.session);

        res.json({ success: true, message: '登入成功' });
    });
});

// **✅ 登出 API**
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: '登出成功' });
});

// ✅ 確保 `authRoutes.js` 正確返回 Express Router
module.exports = router;
