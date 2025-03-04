const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const multer = require('multer');
const Fontmin = require('fontmin');
const crypto = require('crypto');
const db = require('./config/database');

dotenv.config();

const app = express();

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'default_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// 設定靜態資源
app.use('/fonts', express.static(path.join(__dirname, '../uploads/fonts')));
app.use('/temp-fonts', express.static(path.join(__dirname, '../uploads/temp-fonts')));

// 確保目錄存在
const tempFontsDir = path.join(__dirname, '../uploads/temp-fonts');
if (!fs.existsSync(tempFontsDir)) {
    fs.mkdirSync(tempFontsDir, { recursive: true });
}

// **自動讀取 `uploads/fonts/` 內的字體**
function getAvailableFonts() {
    const fontDir = path.join(__dirname, '../uploads/fonts');
    return fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter(file => file.endsWith('.ttf') || file.endsWith('.woff2')) : [];
}

app.get('/api/available-fonts', (req, res) => {
    res.json({ fonts: getAvailableFonts() });
});

// **字體上傳**
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

// 產生唯一檔案名稱
function generateFilename(fontName, text) {
    const hash = crypto.createHash('md5').update(fontName + text).digest('hex').slice(0, 8);
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\..+/, '');
    return `${hash}_${timestamp}.woff2`;
}

// 檢查是否已經產生過相同子集
function getExistingSubset(fontName, text) {
    const hash = crypto.createHash('md5').update(fontName + text).digest('hex').slice(0, 8);
    const files = fs.readdirSync(tempFontsDir).filter(file => file.startsWith(hash) && file.endsWith('.woff2'));
    return files.length > 0 ? files[0] : null;
}

// **執行字體子集化**
async function createSubset(inputPath, outputPath, text) {
    return new Promise((resolve, reject) => {
        const fontmin = new Fontmin()
            .src(inputPath)
            .dest(path.dirname(outputPath))
            .use(Fontmin.glyph({ text, hinting: false }))
            .use(Fontmin.ttf2woff2());

        fontmin.run((err, files) => {
            if (err) return reject(err);

            try {
                const woff2File = files.find(file => file.extname === '.woff2');
                if (!woff2File) return reject(new Error('無法生成 .woff2 子集'));

                fs.writeFileSync(outputPath, woff2File.contents);
                resolve(outputPath);
            } catch (error) {
                reject(error);
            }
        });
    });
}

// **字體子集化 API**
app.post('/api/fonts/subset', async (req, res) => {
    try {
        console.log("收到子集化請求:", req.body);

        if (!req.body || typeof req.body !== "object") {
            return res.status(400).json({ success: false, error: "請求格式錯誤，請使用 JSON" });
        }

        const { fontName, text, site } = req.body;

        if (!fontName || !text || !site) {
            return res.status(400).json({ success: false, error: "缺少必要參數 (fontName, text, site)" });
        }

        const originalFontPath = path.join(__dirname, '../uploads/fonts', fontName);
        if (!fs.existsSync(originalFontPath)) {
            console.error(`字體未尋獲: ${originalFontPath}`);
            return res.status(404).json({ success: false, error: "字體缺失" });
        }

        // **如果已有相同的字體子集，直接返回**
        const existingFile = getExistingSubset(fontName, text);
        if (existingFile) {
            return res.json({ success: true, subset: { url: `https://api-webfont.twintype.co/temp-fonts/${existingFile}` } });
        }

        // **生成子集字體**
        const outputFileName = generateFilename(fontName, text);
        const outputPath = path.join(tempFontsDir, outputFileName);
        console.log(`產生子集化字體: ${outputPath}`);

        await createSubset(originalFontPath, outputPath, text);
        console.log(`子集化完成: ${outputPath}`);

        res.json({ success: true, subset: { url: `https://api-webfont.twintype.co/temp-fonts/${outputFileName}` } });

    } catch (error) {
        console.error("❌ 子集化失敗:", error);
        res.status(500).json({ success: false, error: "內部錯誤，請檢查伺服器日誌" });
    }
});

// **嵌入 JS，允許前端指定字體**
app.get('/embed.js', (req, res) => {
    const site = req.query.site;
    const fonts = req.query.font ? req.query.font.split(',') : [];

    if (!site) {
        return res.status(400).send("缺少 site 參數");
    }

    const availableFonts = getAvailableFonts();
    const validFonts = fonts.filter(font => availableFonts.includes(font));

    if (validFonts.length === 0) {
        return res.status(400).send("請提供有效的字體名稱");
    }

    const jsContent = `
window.onload = function() {
    document.body.style.visibility = "hidden";

    function collectText() {
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

        return [...new Set(textContent.split(''))].join("");
    }

    let collectedText = collectText();
    
    if (!collectedText || collectedText.length === 0) {
        console.error("無法收集字符");
        document.body.style.visibility = "visible";
        return;
    }

    Promise.all(${JSON.stringify(validFonts)}.map(fontName =>
        fetch("https://api-webfont.twintype.co/api/fonts/subset", {
        
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fontName, text: collectedText, site: "${site}" })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                var style = document.createElement("style");
                style.innerHTML = "@font-face { font-family: '" + fontName.replace('.ttf', '') + "'; src: url('" + data.subset.url + "') format('woff2'); }";
                document.head.appendChild(style);
            }
        })
        .catch(error => console.error("API 請求失敗:", error))
    )).finally(() => document.body.style.visibility = "visible");
};

`;

    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsContent);
});

// app.listen(3000, () => console.log(`Server running on http://localhost:3000`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://0.0.0.0:${PORT}`));
