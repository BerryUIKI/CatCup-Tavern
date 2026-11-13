// Compose the social preview card: coffee background, decorative bubbles,
// and the cream lockup banner. No extra copy is added.
const fs = require('node:fs');

const read = (p) => {
    const s = fs.readFileSync(p, 'utf8');
    const start = s.indexOf('>', s.indexOf('<svg')) + 1;
    return s.slice(start, s.lastIndexOf('</svg>'));
};

const banner = read('readme-banner-d.svg');

const W = 1200;
const H = 630;
const bannerW = 960;
const bannerH = 955.19 * (bannerW / 2920.26);
const s = bannerW / 2920.26;
const x = (W - bannerW) / 2;
const y = (H - bannerH) / 2;

// Decorative bubbles echoing the steam circles in the lockup. Two muted tones
// that sit just above and below the background, so they stay quiet.
const bubbles = [
    [92, 112, 26],
    [144, 172, 14],
    [58, 194, 10],
    [192, 88, 9],
    [1104, 92, 10],
    [1146, 134, 6],
    [1122, 520, 30],
    [1072, 572, 16],
    [1152, 442, 12],
    [1012, 602, 8],
    [82, 560, 18],
    [134, 602, 9],
    [36, 52, 5],
    [118, 44, 4],
    [1082, 610, 5],
    [60, 610, 4],
];

const bubblesSvg = bubbles
    .map(([cx, cy, r], i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i % 3 === 2 ? '#2d1c15' : '#4a3229'}"/>`)
    .join('\n  ');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">CatCup Tavern</title>
  <desc id="d">The CatCup Tavern lockup in cream on a coffee background with subtle bubble decorations, sized 1200 by 630 for social previews.</desc>
  <rect width="${W}" height="${H}" fill="#3a241c"/>
  ${bubblesSvg}
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(6)})">${banner}</g>
</svg>
`;

fs.writeFileSync('og-image.svg', svg);
console.log(`composed og-image.svg (${W}x${H}, banner ${bannerW.toFixed(0)}x${bannerH.toFixed(0)}, ${bubbles.length} bubbles)`);
