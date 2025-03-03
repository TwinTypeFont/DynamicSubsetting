const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Fontmin = require('fontmin');
const db = require('../config/database'); // 連接 SQLite

const tempFontsDir = path.join(__dirname, '../../uploads/temp-fonts');

// 確保臨時目錄存在
if (!fs.existsSync(tempFontsDir)) {
    fs.mkdirSync(tempFontsDir, { recursive: true });
}

// 生成隨機 hash
function generateHash() {
    return crypto.randomBytes(8).toString('hex');
}

// 取得當前時間戳
function getTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\..+/, '');
}

// **使用 Fontmin 進行字體子集化**
function createSubset(inputPath, outputPath, text) {
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
                if (!woff2File) return reject(new Error('No woff2 file generated'));

                fs.writeFileSync(outputPath, woff2File.contents);
                resolve({ size: woff2File.contents.length, chars: [...new Set(text)].length });
            } catch (error) {
                reject(error);
            }
        });
    });
}

// **清理過期的字體子集**
function cleanupTempFonts() {
    const ONE_HOUR = 60 * 60 * 1000;
    fs.readdirSync(tempFontsDir).forEach(file => {
        const filePath = path.join(tempFontsDir, file);
        try {
            const stats = fs.statSync(filePath);
            if (Date.now() - stats.mtime.getTime() > ONE_HOUR) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error('清理檔案失敗:', err);
        }
    });
}

// **字體子集化 API**
router.post('/subset', async (req, res) => {
    try {
        const { fontName, text, site } = req.body;
        if (!fontName || !text || !site) {
            return res.status(400).json({ success: false, error: '請提供字體名稱、文字和站點 URL' });
        }

        // 確保站點已授權
        db.get('SELECT * FROM allowed_sites WHERE site_url = ?', [site], async (err, allowedSite) => {
            if (!allowedSite) {
                return res.status(403).json({ success: false, error: '未授權的站點' });
            }

            // 確保字體檔案存在
            const originalFontPath = path.join(__dirname, '../../uploads/fonts', fontName);
            if (!fs.existsSync(originalFontPath)) {
                return res.status(404).json({ success: false, error: '找不到指定的字體' });
            }

            const hash = generateHash();
            const timestamp = getTimestamp();
            const outputFileName = `${fontName.replace('.ttf', '')}_${hash}_${timestamp}.woff2`;
            const outputPath = path.join(tempFontsDir, outputFileName);

            console.log(`🔹 產生子集化字體: ${outputPath}`);

            // 執行子集化
            const result = await createSubset(originalFontPath, outputPath, text);
            cleanupTempFonts();

            console.log(`子集化完成: ${outputPath}, 大小: ${result.size}`);

            res.json({
                success: true,
                subset: {
                    url: `http://localhost:3000/temp-fonts/${outputFileName}`,
                    size: result.size,
                    characters: result.chars
                }
            });
        });

    } catch (error) {
        console.error('❌ 子集化失敗:', error);
        res.status(500).json({ success: false, error: '子集化處理失敗' });
    }
});


// **獲取可用字體清單**
router.get('/list', (req, res) => {
    const fontsDir = path.join(__dirname, '../../uploads/fonts');
    try {
        const files = fs.readdirSync(fontsDir).filter(file => ['.ttf', '.otf', '.woff', '.woff2'].includes(path.extname(file)));
        res.json({ success: true, fonts: files });
    } catch (error) {
        res.status(500).json({ success: false, error: '無法讀取字體列表' });
    }
});

// **清理過期字體 API**
router.post('/clear-cache', (req, res) => {
    try {
        cleanupTempFonts();
        res.json({ success: true, message: "過期字體已清理" });
    } catch (error) {
        res.status(500).json({ success: false, error: '清理失敗' });
    }
});

// **嵌入代碼生成 API**
router.post('/generate-embed', async (req, res) => {
    try {
        const { site, fontName } = req.body;
        if (!site || !fontName) return res.status(400).json({ success: false, error: '請提供站點 URL 和字體名稱' });

        db.get('SELECT * FROM allowed_sites WHERE site_url = ?', [site], (err, allowedSite) => {
            if (!allowedSite) {
                return res.status(403).json({ success: false, error: '未授權的站點' });
            }

            const embedScript = `
<script>
(function() {
    var TwinFont = {
        apiUrl: "https://your-server.com/api/fonts/subset",
        fontName: "${fontName}",
        collectedText: "",

        collectText: function() {
            let textContent = "";
            document.querySelectorAll("body *:not(script):not(style)").forEach(el => {
                if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
                    textContent += el.textContent.trim() + " ";
                }
            });
            this.collectedText = [...new Set(textContent)].join("");
        },

        requestSubset: function() {
            if (!this.collectedText) return;
            fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fontName: this.fontName,
                    text: this.collectedText,
                    site: "${site}"
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    TwinFont.applyFont(data.subset.url);
                }
            })
            .catch(error => console.error("字體加載失敗:", error));
        },

        applyFont: function(fontUrl) {
            const style = document.createElement("style");
            style.innerHTML = "@font-face { font-family: 'TwinFont'; src: url('" + fontUrl + "') format('woff2'); font-weight: normal; font-style: normal; } body { font-family: 'TwinFont', sans-serif !important; }";
            document.head.appendChild(style);
        },

        init: function() {
            this.collectText();
            this.requestSubset();
        }
    };
    TwinFont.init();
})();
</script>
            `;

            res.json({ success: true, embedCode: embedScript });
        });

    } catch (error) {
        console.error('錯誤:', error);
        res.status(500).json({ success: false, error: '無法生成嵌入代碼' });
    }
});

module.exports = router;

