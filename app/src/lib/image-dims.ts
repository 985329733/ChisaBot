/**
 * 图片的像素宽高（DESIGN.md §83.2）：服务器存图时读出，随消息 part 的 `metadata`、工具结果的文件清单、
 * 链接预览一起给网页。这里只做「读得出就是正整数，否则当没有」——数据来自存储 / 回放，类型不可信。
 */
export type ImageDims = { width: number; height: number };

const side = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000;

export function readImageDims(width: unknown, height: unknown): ImageDims | undefined {
  return side(width) && side(height) ? { width, height } : undefined;
}
