# CatCup Tavern — 品牌素材

设计师交付的三份矢量稿，这里是唯一的品牌母版目录。

| 文件 | 用途 |
| --- | --- |
| `catcup-icon.svg` | 应用图标母版（1134×1134，圆角方砖 + 咖啡圆盘 + 奶油色猫杯）。所有 PNG / ICO / favicon / Tauri 图标都由它导出 |
| `readme-banner-d.svg` | README banner 深色版（奶油色图案，用于深色背景） |
| `readme-banner-w.svg` | README banner 浅色版（咖啡色图案，用于浅色背景） |

配色：奶油 `#fdf4e2` · 咖啡 `#3a241c`。

## 使用位置

- **README**：`README.md` 顶部用 `<picture>` + `prefers-color-scheme` 自动切换两版 banner。
- **应用图标**：`export/` 下已导出全套 —— PNG 16–1024、多尺寸 `icon.ico`、`favicon.ico`、`favicon.svg`、`apple-touch-icon.png`、`tauri-icons/`。
- **桌面端**：`apps/desktop/src-tauri/icons/`（文件名对齐 `tauri.conf.json`）。
- **Web**：`apps/web/public/favicon.svg`（也是应用内 `Logo` 组件的来源）、`favicon.ico`、`apple-touch-icon.png`、`brand-banner.svg`（设置 → 关于页顶部）。
- **应用内 Logo**：`apps/web/src/components/Logo.tsx` 使用 `/favicon.svg`。

## 重新导出全部位图

图标 SVG 改动后，在 `design/logo/` 下执行：

```bash
for s in 16 24 32 48 64 128 256 512 1024; do
  magick -background none catcup-icon.svg -resize ${s}x${s} -depth 8 export/catcup-${s}.png
done
magick export/catcup-16.png export/catcup-24.png export/catcup-32.png export/catcup-48.png \
       export/catcup-64.png export/catcup-128.png export/catcup-256.png export/icon.ico
magick export/catcup-16.png export/catcup-32.png export/catcup-48.png export/favicon.ico
magick -background '#fdf4e2' catcup-icon.svg -resize 180x180 -flatten -depth 8 export/apple-touch-icon.png
cp catcup-icon.svg export/favicon.svg
cp export/catcup-512.png export/tauri-icons/icon.png
cp export/catcup-32.png export/tauri-icons/32x32.png
cp export/catcup-128.png export/tauri-icons/128x128.png
cp export/catcup-256.png export/tauri-icons/128x128@2x.png
cp export/icon.ico export/tauri-icons/icon.ico
```

然后把 `export/` 的结果复制到 `apps/desktop/src-tauri/icons/` 和 `apps/web/public/` 对应位置。
