# Markdown 转 PDF 使用示例

这是一个用于演示 `md2pdf` 脚本的 Markdown 文档。它同时覆盖了常见的文档元素，包括不同级别的标题、行内公式、块级公式、代码块，以及本地图片 `界面.png`。

## 1. 基本用法

使用下面的命令可以把当前文档转换为 PDF：

```bash
node scripts/md2pdf.mjs usage-demo.md
```

### 1.1 指定输出文件

如果希望显式指定输出路径，可以使用 `--output`：

```bash
node scripts/md2pdf.mjs usage-demo.md --output usage-demo.pdf
```

### 1.2 指定纸张格式

脚本默认使用 `A4`，也可以切换到 `Letter`：

```bash
node scripts/md2pdf.mjs usage-demo.md --output usage-demo.pdf --format A4
```

## 2. 公式示例

这是一条行内公式：$E = mc^2$。下面再给一个更偏工程场景的行内公式：$p(x) = \frac{1}{\sqrt{2\pi\sigma^2}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}$。

### 2.1 块级公式

下面这条公式模拟一个带正则项的目标函数：

$$
\mathcal{L}(\theta) =
\sum_{i=1}^{n}
\left(
\frac{y_i - \hat{y}_i}{\sigma_i}
\right)^2
+ \lambda \lVert \theta \rVert_2^2
$$

### 2.2 矩阵公式

#### 2.2.1 线性变换示例

$$
A =
\begin{bmatrix}
1 & 2 & 0 \\
0 & \alpha & \beta \\
\gamma & 0 & 1
\end{bmatrix},
\qquad
\mathbf{z} = A \mathbf{x}
$$

## 3. 图片示例

下面这张图片来自项目根目录中的 `界面.png`。脚本会读取原始图片字节并嵌入 PDF，以尽量保留图片清晰度。

![界面截图](./界面.png)

### 3.1 图片保真说明

- 图片使用本地相对路径引用
- 转换时不会主动压缩图片
- PDF 中的文本仍保留为正常文本层，不会把整页先做成截图

## 4. 渲染说明

脚本当前支持以下内容稳定输出到 PDF：

- 多级标题
- 段落、列表、代码块、表格
- 行内公式 `$...$`
- 块级公式 `$$...$$`
- 本地图片引用

### 4.1 推荐场景

适合用在技术方案、实验记录、产品说明和带公式的知识文档导出。

## 5. 结论

如果你要生成自己的 PDF，只需要把 `usage-demo.md` 替换成你的 Markdown 文件路径即可。对于图片，优先使用本地高分辨率图片；对于公式，直接写标准的 LaTeX 数学表达式即可。
