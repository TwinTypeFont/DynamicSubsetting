const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const multer = require('multer');
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

// 設定 EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API 路由
const authRoutes = require('./routes/authRoutes');
const fontRoutes = require('./routes/fontRoutes');

app.use('/auth', authRoutes);
app.use('/api/fonts', fontRoutes);

// 設定靜態資源 (字體文件)
app.use('/fonts', express.static(path.join(__dirname, '../uploads/fonts')));
app.use('/temp-fonts', express.static(path.join(__dirname, '../uploads/temp-fonts')));

// 自動抓取 `uploads/fonts/` 內的字體
function getAvailableFonts() {
    const fontDir = path.join(__dirname, '../uploads/fonts');
    return fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter(file => file.endsWith('.ttf') || file.endsWith('.woff2')) : [];
}

app.get('/api/available-fonts', (req, res) => {
    res.json({ fonts: getAvailableFonts() });
});

// 字體上傳功能
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../uploads/fonts'));
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage });

app.post('/api/upload-font', upload.single('fontFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: "請選擇字體文件" });
    }

    res.json({ success: true, message: "字體上傳成功", filename: req.file.filename });
});

// **嵌入 JS，允許多字體**
app.get('/embed.js', (req, res) => {
    const site = req.query.site;
    const fonts = req.query.fonts ? req.query.fonts.split(',') : getAvailableFonts(); // 自動抓取所有可用字體

    if (!site) {
        return res.status(400).send("缺少 site 參數");
    }

    // 檢查站點是否授權
    db.get('SELECT * FROM allowed_sites WHERE site_url = ?', [site], (err, allowedSite) => {
        if (!allowedSite) {
            return res.status(403).send("未授權的站點");
        }

        let fontLoaders = fonts.map(fontName => `
            fetch("http://localhost:3000/api/fonts/subset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fontName: "${fontName}",
                    text: TwinFont.collectedText,
                    site: "${site}"
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    var style = document.createElement("style");
                    style.innerHTML = "@font-face { font-family: '${fontName.replace('.ttf', '')}'; src: url('" + data.subset.url + "') format('woff2'); }";
                    document.head.appendChild(style);
                    document.body.style.fontFamily += " '${fontName.replace('.ttf', '')}',";
                }
            });
        `).join("");

        const jsContent = `
window.onload = function() {
    var TwinFont = {
        apiUrl: "http://localhost:3000/api/fonts/subset",
        collectedText: "",

        collectText: function() {
            let textContent = "";

            document.querySelectorAll("body *").forEach(function(el) {
                if (el.childNodes.length) {
                    el.childNodes.forEach(function(node) {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            textContent += node.textContent.trim() + " ";
                        }
                    });
                }
            });

            TwinFont.collectedText = [...new Set(textContent)].join("");
            TwinFont.requestSubset();
        },

        requestSubset: function() {
            if (!TwinFont.collectedText || TwinFont.collectedText.length === 0) {
                console.error("❌ collectedText 為空，無法發送 API");
                return;
            }

            ${fontLoaders}
        }
    };
    TwinFont.collectText();
};
`;

        res.setHeader('Content-Type', 'application/javascript');
        res.send(jsContent);
    });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
