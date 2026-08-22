const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = './src/assets/images/filters';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));

(async () => {
  for (const f of files) {
    const p = path.join(dir, f);
    const buf = fs.readFileSync(p);
    const out = await sharp(buf)
      .resize({ width: 500, height: 500, fit: 'inside', withoutEnlargement: true })
      .png({ quality: 80, compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(p, out);
    console.log(f, buf.length, '->', out.length);
  }
})();
