# md2pdf

Markdown 转 PDF 工具，支持本地图片保真嵌入和 LaTeX 数学公式渲染。

## 功能特性

- **图片保真**：读取本地图片原始字节嵌入 PDF，保持图片清晰度
- **数学公式**：支持 KaTeX 渲染行内公式 `$...$` 和块级公式 `$$...$$`
- **多种格式**：支持 A4 和 Letter 纸张格式
- **文本层**：PDF 保留可搜索的文本层，非截图

## 安装

```bash
npm install
```

## 使用方法

```bash
node scripts/md2pdf.mjs <input.md> [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--output <path>` | 输出 PDF 路径 | `<input>.pdf` |
| `--format <format>` | 纸张格式 (`A4` / `Letter`) | `A4` |

### 示例

转换当前目录下的 Markdown 文件：

```bash
node scripts/md2pdf.mjs usage-demo.md
```

指定输出路径：

```bash
node scripts/md2pdf.mjs usage-demo.md --output usage-demo.pdf
```

指定纸张格式：

```bash
node scripts/md2pdf.mjs usage-demo.md --output usage-demo.pdf --format Letter
```

## 支持的 Markdown 特性

- 多级标题、段落、列表、代码块、表格
- 行内公式 `$E = mc^2$`
- 块级公式
  ```
  $$
  \mathcal{L}(\theta) = ...
  $$
  ```
- 本地图片引用 `![alt](./image.png)`

## 项目结构

```
md2pdf/
├── scripts/
│   └── md2pdf.mjs      # 主脚本
├── test/
│   └── md2pdf.test.mjs # 测试文件
├── usage-demo.md        # 使用示例
├── usage-demo.pdf       # 示例输出
├── package.json
└── .gitignore
```

## 运行测试

```bash
npm test
```

## 依赖

- [markdown-it](https://github.com/markdown-it/markdown-it) - Markdown 解析
- [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath) - 公式插件
- [katex](https://github.com/KaTeX/KaTeX) - 数学公式渲染
- [playwright](https://github.com/microsoft/playwright) - PDF 生成
