const fontkit = require('fontkit');
const fs = require('fs');
const path = require('path');

class FontService {
  static async createSubset(fontPath, characters) {
    try {
      console.log(`🔹 讀取字體: ${fontPath}`);
      const font = await fontkit.open(fontPath);
      const subset = font.createSubset();

      for (const char of characters) {
        const glyph = font.glyphForCodePoint(char.codePointAt(0));
        subset.includeGlyph(glyph);
      }

      const buffer = subset.encode();
      const fileName = `subset-${Date.now()}.woff2`;
      const outputPath = path.join(__dirname, '../../uploads/temp-fonts', fileName);

      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ 字體子集化成功: ${outputPath}`);

      return {
        fileName,
        filePath: outputPath,
        size: buffer.length
      };
    } catch (error) {
      console.error('❌ 字體子集化錯誤:', error);
      throw error;
    }
  }
}

module.exports = FontService;
