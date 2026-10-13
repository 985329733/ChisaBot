import { qrcodegen } from "./qrcodegen";

/**
 * 文本 → 二维码 SVG 路径（一个模块 = 1×1 方块，不含静区）。纠错等级 M：绑定链接约 120 字节，
 * 出来是 33×33 左右，手机在 1 米内都能扫。
 */
export function qrPath(text: string): { size: number; path: string } {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    let run = -1;
    for (let x = 0; x <= qr.size; x++) {
      const dark = x < qr.size && qr.getModule(x, y);
      if (dark && run < 0) run = x;
      if (!dark && run >= 0) {
        parts.push(`M${run} ${y}h${x - run}v1h${run - x}z`);
        run = -1;
      }
    }
  }
  return { size: qr.size, path: parts.join("") };
}
