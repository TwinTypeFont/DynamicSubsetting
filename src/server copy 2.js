const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const multer = require('multer');
const Fontmin = require('fontmin');
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
    cookie: { secure: false }
}));

// 設定靜態資源 (字體文件)
app.use('/fonts', express.static(path.join(__dirname, '../uploads/fonts')));
app.use('/temp-fonts', express.static(path.join(__dirname, '../uploads/temp-fonts')));

// **確保 `temp-fonts` 目錄存在**
const tempFontsDir = path.join(__dirname, '../uploads/temp-fonts');
if (!fs.existsSync(tempFontsDir)) {
    fs.mkdirSync(tempFontsDir, { recursive: true });
}

// **自動抓取 `uploads/fonts/` 內的字體**
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
                if (!woff2File) return reject(new Error('❌ 無法生成 .woff2 子集'));

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
        console.log("📩 收到子集化請求:", req.body);

        const { fontName, text, site } = req.body;
        if (!fontName || !text || !site) {
            return res.status(400).json({ success: false, error: '請提供字體名稱、文字和站點 URL' });
        }

        // **確保字體檔案存在**
        const originalFontPath = path.join(__dirname, '../uploads/fonts', fontName);
        if (!fs.existsSync(originalFontPath)) {
            return res.status(404).json({ success: false, error: '❌ 找不到指定的字體' });
        }

        // **生成子集字體**
        const outputFileName = fontName.replace('.ttf', '') + '-subset.woff2';
        const outputPath = path.join(tempFontsDir, outputFileName);

        console.log(`🚀 產生子集化字體: ${outputPath}`);

        await createSubset(originalFontPath, outputPath, text);

        console.log(`✅ 子集化完成: ${outputPath}`);

        res.json({
            success: true,
            subset: { url: `http://localhost:3000/temp-fonts/${outputFileName}` }
        });

    } catch (error) {
        console.error("❌ 子集化失敗:", error);
        res.status(500).json({ success: false, error: '子集化處理失敗' });
    }
});

// **嵌入 JS，允許前端指定字體**
app.get('/embed.js', (req, res) => {
    const site = req.query.site;
    const fonts = req.query.font ? req.query.font.split(',') : [];

    if (!site) {
        return res.status(400).send("缺少 site 參數");
    }

    // **確保字體存在**
    const availableFonts = getAvailableFonts();
    const validFonts = fonts.filter(font => availableFonts.includes(font));

    if (validFonts.length === 0) {
        return res.status(400).send("請提供有效的字體名稱");
    }

    const jsContent = `
window.onload = function() {
    var TwinFont = {
        apiUrl: "http://localhost:3000/api/fonts/subset",
        collectedText: "",
        fontLoadedCount: 0,
        selectedFonts: ${JSON.stringify(validFonts)}, 

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
                TwinFont.showPage();
                return;
            }

            TwinFont.selectedFonts.forEach(fontName => {
                fetch("http://localhost:3000/api/fonts/subset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        fontName: fontName,
                        text: TwinFont.collectedText,
                        site: "${site}"
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        var style = document.createElement("style");
                        style.innerHTML = "@font-face { font-family: '" + fontName.replace('.ttf', '') + "'; src: url('" + data.subset.url + "') format('woff2'); }";
                        document.head.appendChild(style);
                        TwinFont.fontLoadedCount++;
                        if (TwinFont.fontLoadedCount === TwinFont.selectedFonts.length) {
                            TwinFont.showPage();
                        }
                    }
                })
                .catch(() => TwinFont.showPage());
            });

            setTimeout(() => TwinFont.showPage(), 2000);
        },

        showPage: function() {
            document.body.style.visibility = "visible";
        }
    };

    document.body.style.visibility = "hidden";
    TwinFont.collectText();
};
`;

    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsContent);
});

// **啟動伺服器**
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
