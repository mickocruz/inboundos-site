const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname);
const names = ['instagram','reddit','x','youtube','tiktok'];
(async () => {
  for (const n of names) {
    const svg = fs.readFileSync(path.join(dir, `${n}.svg`));
    for (const [size, suffix] of [[64,''],[128,'@2x']]) {
      const out = path.join(dir, `${n}${suffix}.png`);
      await sharp(svg, { density: 600 })
        .resize(size, size, { fit:'contain', background:{r:0,g:0,b:0,alpha:0} })
        .png({ compressionLevel: 9 })
        .toFile(out);
      console.log(path.basename(out), fs.statSync(out).size + 'b');
    }
  }
})();
