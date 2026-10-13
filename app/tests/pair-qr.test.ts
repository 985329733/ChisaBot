import { describe, expect, test } from "bun:test";
import { pairingUri } from "../../shared/devices";
import { qrPath } from "../src/lib/qr";
import { qrcodegen } from "../src/lib/qr/qrcodegen";

describe("绑定手机二维码", () => {
  const uri = pairingUri("https://chisabot.example.com:8443", `cbp_${"x".repeat(32)}`);

  test("encodes the pairing link at a phone-scannable size", () => {
    const qr = qrPath(uri);
    expect(qr.size).toBeGreaterThanOrEqual(29);
    expect(qr.size).toBeLessThanOrEqual(45);
    expect(qr.path.startsWith("M")).toBe(true);
  });

  test("the path covers exactly the dark modules", () => {
    const reference = qrcodegen.QrCode.encodeText(uri, qrcodegen.QrCode.Ecc.MEDIUM);
    let dark = 0;
    for (let y = 0; y < reference.size; y++) for (let x = 0; x < reference.size; x++) if (reference.getModule(x, y)) dark++;
    const widths = [...qrPath(uri).path.matchAll(/h(\d+)v1/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    expect(widths).toBe(dark);
  });
});
