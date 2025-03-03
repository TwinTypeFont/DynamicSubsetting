const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const db = require('./config/database');

dotenv.config();

const app = express();

// 跨來源請求
app.use(cors({ origin: "*", credentials: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // 本地開發設為 false，正式環境應設為 true
}));

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

//API路由
const authRoutes = require('./routes/authRoutes');
const fontRoutes = require('./routes/fontRoutes');

app.use('/auth', authRoutes);
app.use('/api/fonts', fontRoutes);

// 設定靜態資源 (字體文件)
app.use('/fonts', express.static(path.join(__dirname, '../uploads/fonts')));
app.use('/temp-fonts', express.static(path.join(__dirname, '../uploads/temp-fonts')));

// UI 路由
app.get('/login', (req, res) => res.render('login'));

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login'); // 未登入則跳轉
    }

    db.all('SELECT * FROM allowed_sites WHERE user_id = ?', [req.session.userId], (err, sites) => {
        if (err) {
            return res.status(500).json({ success: false, error: '無法讀取授權站點' });
        }
        res.render('dashboard', { allowedSites: sites });
    });
});

// 新增授權網站 API（防止重複授權）
app.post('/dashboard/add-site', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: "請先登入" });
    }

    const user_id = req.session.userId;
    const { site_url } = req.body;

    if (!site_url) {
        return res.status(400).json({ success: false, error: "請提供網站 URL" });
    }

    db.get('SELECT * FROM allowed_sites WHERE site_url = ?', [site_url], (err, existingSite) => {
        if (existingSite) {
            return res.status(400).json({ success: false, error: "該站點已被授權" });
        }

        db.run('INSERT INTO allowed_sites (user_id, site_url) VALUES (?, ?)', [user_id, site_url], function(err) {
            if (err) {
                console.error("❌ 無法新增站點:", err.message);
                return res.status(500).json({ success: false, error: "無法授權此網站" });
            }
            res.redirect('/dashboard');
        });
    });
});

app.get('/embed.js', (req, res) => {
    const site = req.query.site;
    const fontName = req.query.font || "TaipeiSansTCBeta-Regular.ttf"; // 預設字體

    if (!site) {
        return res.status(400).send("缺少 site 參數");
    }

    // 檢查站點是否授權
    db.get('SELECT * FROM allowed_sites WHERE site_url = ?', [site], (err, allowedSite) => {
        if (!allowedSite) {
            return res.status(403).send("未授權的站點");
        }

        const jsContent = `
window.onload = function() {
    var TwinFont = {
        apiUrl: "http://localhost:3000/api/fonts/subset",
        fontName: "${fontName}",
        collectedText: "",

        collectText: function() {
            let textContent = "";

            // 收集所有標籤內的可見文字
            document.querySelectorAll("body *").forEach(function(el) {
                if (el.childNodes.length) {
                    el.childNodes.forEach(function(node) {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            textContent += node.textContent.trim() + " ";
                        }
                    });
                }
            });

            


            // 去除重複字元
            TwinFont.collectedText = [...new Set(textContent.split(''))].join("");
            console.log("TwinFont.collectedText.length");

            TwinFont.requestSubset();
        },

        requestSubset: function() {
            if (!TwinFont.collectedText || TwinFont.collectedText.length === 0) {
                console.error("❌ collectedText 為空，無法發送 API");
                return;
            }
            fetch(TwinFont.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fontName: TwinFont.fontName,
                    text: TwinFont.collectedText,
                    site: "${site}"
                })
            })
            .then(response => response.json())
            .then(function(data) {
                if (data.success) {
                    TwinFont.applyFont(data.subset.url);
                }
            })
            .catch(function(error) {
                console.error("❌ 字體加載失敗:", error);
            });
        },

        applyFont: function(fontUrl) {
            console.log("CSS", fontUrl);
            var style = document.createElement("style");
            style.innerHTML = "@font-face { font-family: 'TaipeiSansTCBeta-Regular'; src: url('" + fontUrl + "') format('woff2'); font-weight: normal; font-style: normal; } body { font-family: 'TaipeiSansTCBeta-Regular', sans-serif !important; }";
            document.head.appendChild(style);
            console.log("done!");
        }
    };
    TwinFont.collectText();
};
`;

        res.setHeader('Content-Type', 'application/javascript');
        res.send(jsContent);
        
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` Server running on http://localhost:${PORT}`));
