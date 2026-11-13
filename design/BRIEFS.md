# 设计需求（给设计师）

品牌素材（图标、README banner、社交预览图、小尺寸变体）已完成。以下是仍可排期的项目，按优先级排列。

## 1. 空状态插画（应用内，两幅）— 可用 GPT-Image 生成

风格锚点：与图标同一支笔的手绘涂鸦；奶油 `#fdf4e2` 与咖啡 `#3a241c` 双色、粗圆描边、纯色平底（生成后可以把平色底抠成透明）。**每幅画两个版本**——深色版（奶油图形 + 深咖啡底，用于应用内与深色 README）和浅色版（咖啡图形 + 奶油底，用于浅色 README）——README 里用 `<picture>` + `prefers-color-scheme` 自动切换。画面里不要出现任何文字。

**1a. 空图书馆**

深色版：

```text
Hand-drawn flat illustration, two colors only: cream (#fdf4e2) shapes on a solid dark coffee (#17100a) background. A cute round cat with closed happy eyes, tiny nose and a few whiskers, sitting with its head tilted toward an empty wooden bookshelf with three bare shelves. Thick rounded hand-drawn outlines, sticker doodle style, cozy tavern mood, simple composition, generous padding, no text, no letters, no gradients, no shading, no extra objects.
```

浅色版：同一段提示词，把第一句换成 `cream (#fdf4e2) shapes on a solid dark coffee (#17100a) background` 的反色版本 `coffee-brown (#3a241c) shapes on a solid cream (#fdf4e2) background`，其余不变。

**1b. 暂无聊天**

深色版：

```text
Hand-drawn flat illustration, two colors only: cream (#fdf4e2) shapes on a solid dark coffee (#17100a) background. A cute round cat napping curled on top of an open book, one ear folded, tail curled around the book, eyes closed, relaxed pose. Thick rounded hand-drawn outlines, sticker doodle style, cozy tavern mood, simple composition, generous padding, no text of any kind, no letters, no gradients, no shading.
```

浅色版：颜色句同样反色为 `coffee-brown (#3a241c) shapes on a solid cream (#fdf4e2) background`。

尺寸与比例：**3:2 横版**，GPT-Image 用 1536×1024；主体占画面约 70%，四周留白。应用内的空状态展示区约 5:4（约 200×160 px），我会按 3:2 居中裁切使用。如果工具只能出 1:1（1024×1024），也可以，同样是居中裁切。

## 2. 专用 32px 图标（设计师）

当前所有尺寸（包括 ico / favicon 的小尺寸槽位）都直接由 `catcup-icon.svg` 缩放。请单独绘制一版
16–32 px 专用图标：保留方砖、咖啡圆盘、猫头轮廓与杯沿这几个关键元素，去掉气泡、胡须、腮红等
小细节，保证 16 px 下依然清晰。交付 SVG 后由我嵌入 ico / favicon 的小尺寸槽位。
