import { describe, expect, test } from "bun:test";
import { decodeBase64, maskShareLink, parseShareLink, shareScheme, shareSecrets, toSingBoxOutbound, type ShareLink } from "./proxy-links";

/** 「Claude 上游代理」的节点链接解析（shared/proxy-links.ts，DESIGN.md §85）。所有链接都是编的，不是真节点。 */

const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";

function ok(text: string): ShareLink {
  const r = parseShareLink(text);
  if (!r.ok) throw new Error(`应该能解析：${text} → ${r.error}`);
  return r.link;
}
function bad(text: string): string {
  const r = parseShareLink(text);
  if (r.ok) throw new Error(`不该能解析：${text}`);
  return r.error;
}
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("认出链接类型", () => {
  test("各种开头", () => {
    expect(shareScheme("trojan://x@h:1")).toBe("trojan");
    expect(shareScheme("  VLESS://x@h:1")).toBe("vless");
    expect(shareScheme("vmess://abc")).toBe("vmess");
    expect(shareScheme("ss://abc")).toBe("shadowsocks");
    expect(shareScheme("hy2://a@h:1")).toBe("hysteria2");
    expect(shareScheme("hysteria2://a@h:1")).toBe("hysteria2");
    expect(shareScheme("tuic://a@h:1")).toBe("tuic");
    expect(shareScheme("socks5://h:1")).toBeNull();
    expect(shareScheme("http://h:1")).toBeNull();
    expect(shareScheme("")).toBeNull();
    expect(shareScheme("trojan:x")).toBeNull();
  });
});

describe("trojan", () => {
  test("用户给的格式：allowInsecure / insecure / security=tls / type=tcp / headerType=none / 节点名", () => {
    const l = ok("trojan://p%40ss%3Aw0rd@node.example.com:443?allowInsecure=1&insecure=1&security=tls&type=tcp&headerType=none#%E9%A6%99%E6%B8%AF%2001");
    expect(l).toMatchObject({ protocol: "trojan", host: "node.example.com", port: 443, password: "p@ss:w0rd", name: "香港 01", transport: { type: "tcp" } });
    expect(l.tls).toMatchObject({ enabled: true, insecure: true, serverName: null });
    expect(toSingBoxOutbound(l)).toEqual({ type: "trojan", tag: "up", server: "node.example.com", server_port: 443, password: "p@ss:w0rd", tls: { enabled: true, server_name: "node.example.com", insecure: true } });
    expect(maskShareLink("trojan://secret@node.example.com:443#HK")).toBe("Trojan · node.example.com:443 · HK");
  });
  test("sni / alpn / fp / ws 路径和 Host / ed", () => {
    const l = ok("trojan://pw@1.2.3.4:8443?security=tls&sni=cdn.example.org&alpn=h2,http%2F1.1&fp=chrome&type=ws&host=ws.example.org&path=%2Fray%3Fed%3D2048#n");
    const o = toSingBoxOutbound(l);
    expect(o.tls).toEqual({ enabled: true, server_name: "cdn.example.org", alpn: ["h2", "http/1.1"], utls: { enabled: true, fingerprint: "chrome" } });
    expect(o.transport).toEqual({ type: "ws", path: "/ray", headers: { Host: "ws.example.org" }, max_early_data: 2048, early_data_header_name: "Sec-WebSocket-Protocol" });
  });
  test("grpc serviceName", () => {
    expect(toSingBoxOutbound(ok("trojan://pw@h.example:443?type=grpc&serviceName=svc&sni=h.example")).transport).toEqual({ type: "grpc", service_name: "svc" });
  });
  test("IPv6 主机", () => {
    const l = ok("trojan://pw@[2001:db8::1]:443#v6");
    expect(l.host).toBe("2001:db8::1");
    expect(maskShareLink("trojan://pw@[2001:db8::1]:443#v6")).toBe("Trojan · [2001:db8::1]:443 · v6");
    expect(toSingBoxOutbound(l).server).toBe("2001:db8::1");
  });
  test("密码里没编码的 @ 也行；节点名乱码不报错", () => {
    expect(ok("trojan://a@b@h.example:443#%E4%").password).toBe("a@b");
    expect(ok("trojan://a@h.example:443#%E4%").name).toBe("%E4%");
  });
  test("写错的", () => {
    expect(bad("trojan://h.example:443")).toContain("密码");
    expect(bad("trojan://pw@h.example")).toContain("端口");
    expect(bad("trojan://pw@h.example:70000")).toContain("端口");
    expect(bad("trojan://pw@:443")).toContain("服务器地址");
    expect(bad("trojan://pw@h.example:443?type=kcp")).toContain("kcp");
    expect(bad("trojan://pw@h.example:443?type=tcp&headerType=http")).toContain("http 伪装");
    expect(bad("trojan://pw@h.example:443?security=reality&pbk=x")).toContain("Reality 只支持 VLESS");
    expect(bad("trojan://pw@h.example:443 trojan://pw@h2:443")).toContain("一次只填一个");
  });
});

describe("vless", () => {
  test("reality + vision", () => {
    const pbk = "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw";
    const l = ok(`vless://${UUID}@203.0.113.9:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=safari&pbk=${pbk}&sid=6ba85179e30d4fc2&type=tcp&headerType=none#%F0%9F%87%BA%F0%9F%87%B8%20US`);
    expect(l.name).toBe("🇺🇸 US");
    expect(toSingBoxOutbound(l)).toEqual({
      type: "vless",
      tag: "up",
      server: "203.0.113.9",
      server_port: 443,
      uuid: UUID,
      flow: "xtls-rprx-vision",
      tls: { enabled: true, server_name: "www.microsoft.com", utls: { enabled: true, fingerprint: "safari" }, reality: { enabled: true, public_key: pbk, short_id: "6ba85179e30d4fc2" } },
    });
  });
  test("reality 没写 fp 时默认 chrome；没 sid 也行", () => {
    const o = toSingBoxOutbound(ok(`vless://${UUID}@h.example:443?security=reality&sni=a.com&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw`));
    expect(o.tls).toMatchObject({ utls: { enabled: true, fingerprint: "chrome" }, reality: { short_id: "" } });
  });
  test("ws + tls / 无 tls / httpupgrade / h2", () => {
    expect(toSingBoxOutbound(ok(`vless://${UUID}@h.example:80?type=ws&path=%2F&host=a.b`)).tls).toBeUndefined();
    expect(toSingBoxOutbound(ok(`vless://${UUID}@h.example:443?security=tls&type=httpupgrade&path=%2Fup&host=a.b`)).transport).toEqual({ type: "httpupgrade", path: "/up", host: "a.b" });
    expect(toSingBoxOutbound(ok(`vless://${UUID}@h.example:443?security=tls&type=h2&path=%2Fh&host=a.b,c.d`)).transport).toEqual({ type: "http", path: "/h", host: ["a.b", "c.d"] });
  });
  test("写错的", () => {
    expect(bad("vless://not-a-uuid@h.example:443")).toContain("UUID");
    expect(bad(`vless://${UUID}@h.example:443?security=reality&sni=a.com`)).toContain("pbk");
    expect(bad(`vless://${UUID}@h.example:443?security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw`)).toContain("sni");
    expect(bad(`vless://${UUID}@h.example:443?flow=xtls-rprx-direct`)).toContain("flow");
    expect(bad(`vless://${UUID}@h.example:443?security=tls&flow=xtls-rprx-vision&type=ws`)).toContain("tcp");
    expect(bad(`vless://${UUID}@h.example:443?type=xhttp`)).toContain("xhttp");
    expect(bad(`vless://${UUID}@h.example:443?encryption=mlkem768`)).toContain("加密");
  });
});

describe("vmess", () => {
  const cfg = { v: "2", ps: "日本 東京 ✈", add: "jp.example.net", port: "443", id: UUID, aid: "0", scy: "auto", net: "ws", type: "none", host: "cdn.example.net", path: "/vm?ed=1024", tls: "tls", sni: "", alpn: "", fp: "" };
  test("v2rayN base64 JSON（标准 / url 安全 / 不补 =）", () => {
    for (const enc of [b64(JSON.stringify(cfg)), b64url(JSON.stringify(cfg))]) {
      const l = ok(`vmess://${enc}`);
      expect(l).toMatchObject({ protocol: "vmess", host: "jp.example.net", port: 443, uuid: UUID, name: "日本 東京 ✈", alterId: 0, security: "auto" });
      expect(toSingBoxOutbound(l)).toEqual({
        type: "vmess",
        tag: "up",
        server: "jp.example.net",
        server_port: 443,
        uuid: UUID,
        security: "auto",
        alter_id: 0,
        tls: { enabled: true, server_name: "cdn.example.net" },
        transport: { type: "ws", path: "/vm", headers: { Host: "cdn.example.net" }, max_early_data: 1024, early_data_header_name: "Sec-WebSocket-Protocol" },
      });
    }
  });
  test("数字端口、grpc、无 tls", () => {
    const o = toSingBoxOutbound(ok(`vmess://${b64(JSON.stringify({ ...cfg, port: 8080, net: "grpc", path: "svc", tls: "" }))}`));
    expect(o).toMatchObject({ server_port: 8080, transport: { type: "grpc", service_name: "svc" } });
    expect(o.tls).toBeUndefined();
  });
  test("写错的", () => {
    expect(bad("vmess://!!!")).toContain("base64");
    expect(bad(`vmess://${b64("not json")}`)).toContain("JSON");
    expect(bad(`vmess://${b64(JSON.stringify({ ...cfg, id: "x" }))}`)).toContain("UUID");
    expect(bad(`vmess://${b64(JSON.stringify({ ...cfg, port: "0" }))}`)).toContain("端口");
    expect(bad(`vmess://${b64(JSON.stringify({ ...cfg, net: "tcp", type: "http" }))}`)).toContain("http 伪装");
    expect(bad(`vmess://${b64(JSON.stringify({ ...cfg, scy: "rc4" }))}`)).toContain("加密");
  });
});

describe("shadowsocks", () => {
  test("SIP002 base64 userinfo", () => {
    const l = ok(`ss://${b64url("aes-256-gcm:pa:ss")}@198.51.100.7:8388#%E6%96%B0%E5%8A%A0%E5%9D%A1`);
    expect(l).toMatchObject({ protocol: "shadowsocks", method: "aes-256-gcm", password: "pa:ss", host: "198.51.100.7", port: 8388, name: "新加坡" });
    expect(toSingBoxOutbound(l)).toEqual({ type: "shadowsocks", tag: "up", server: "198.51.100.7", server_port: 8388, method: "aes-256-gcm", password: "pa:ss" });
  });
  test("SIP002 明文 2022 方法（密码 url 编码）+ 末尾 /", () => {
    const l = ok("ss://2022-blake3-aes-128-gcm:YctPZ6U7xPPcU%2Bgp3u%2BiAw%3D%3D@h.example:443/#x");
    expect(l).toMatchObject({ method: "2022-blake3-aes-128-gcm", password: "YctPZ6U7xPPcU+gp3u+iAw==" });
  });
  test("旧式整段 base64 + IPv6", () => {
    expect(ok(`ss://${b64("chacha20-ietf-poly1305:pw@h.example:1234")}#old`)).toMatchObject({ method: "chacha20-ietf-poly1305", password: "pw", host: "h.example", port: 1234, name: "old" });
    expect(ok(`ss://${b64("aes-128-gcm:pw")}@[2001:db8::2]:8388`).host).toBe("2001:db8::2");
  });
  test("写错的", () => {
    expect(bad(`ss://${b64("bf-cfb:pw")}@h.example:1`)).toContain("加密方式");
    expect(bad(`ss://${b64("aes-128-gcm:pw")}@h.example:1?plugin=obfs-local%3Bobfs%3Dhttp`)).toContain("插件");
    expect(bad("ss://nonsense")).toBeTruthy();
    expect(bad(`ss://${b64("aes-128-gcm:pw")}@h.example`)).toContain("端口");
  });
});

describe("hysteria2", () => {
  test("hy2 / hysteria2，obfs，insecure，sni，带宽，默认端口 443", () => {
    const l = ok("hy2://my%20pass@hy.example.com:8443/?sni=real.example.com&insecure=1&obfs=salamander&obfs-password=ob%26fs&up=50&down=200#Hy");
    expect(toSingBoxOutbound(l)).toEqual({
      type: "hysteria2",
      tag: "up",
      server: "hy.example.com",
      server_port: 8443,
      password: "my pass",
      obfs: { type: "salamander", password: "ob&fs" },
      up_mbps: 50,
      down_mbps: 200,
      tls: { enabled: true, server_name: "real.example.com", insecure: true, alpn: ["h3"] },
    });
    expect(ok("hysteria2://pw@hy.example.com").port).toBe(443);
    expect(ok("hysteria2://user:pw@hy.example.com:443").password).toBe("user:pw");
  });
  test("写错的", () => {
    expect(bad("hy2://hy.example.com:443")).toContain("密码");
    expect(bad("hy2://pw@hy.example.com:443,5000-6000")).toContain("多端口");
    expect(bad("hy2://pw@hy.example.com:443?obfs=xor")).toContain("混淆");
    expect(bad("hy2://pw@hy.example.com:443?obfs=salamander")).toContain("obfs-password");
  });
});

describe("tuic", () => {
  test("uuid:password，拥塞控制、udp 模式、alpn", () => {
    const l = ok(`tuic://${UUID}:p%40ss@tuic.example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=tuic.example.com&allow_insecure=1#T`);
    expect(toSingBoxOutbound(l)).toEqual({
      type: "tuic",
      tag: "up",
      server: "tuic.example.com",
      server_port: 443,
      uuid: UUID,
      password: "p@ss",
      congestion_control: "bbr",
      udp_relay_mode: "native",
      tls: { enabled: true, server_name: "tuic.example.com", insecure: true, alpn: ["h3"] },
    });
  });
  test("写错的", () => {
    expect(bad("tuic://abc:pw@h.example:443")).toContain("UUID");
    expect(bad(`tuic://${UUID}:pw@h.example:443?congestion_control=reno2`)).toContain("拥塞");
  });
});

describe("打码和秘密", () => {
  test("打码里没有密码 / UUID", () => {
    const links = [
      "trojan://SuperSecretPw@h.example:443#n",
      `vless://${UUID}@h.example:443#n`,
      `vmess://${b64(JSON.stringify({ add: "h.example", port: 443, id: UUID, ps: "n" }))}`,
      `ss://${b64("aes-128-gcm:SuperSecretPw")}@h.example:443#n`,
      "hy2://SuperSecretPw@h.example:443?obfs=salamander&obfs-password=ObfsSecret#n",
      `tuic://${UUID}:SuperSecretPw@h.example:443#n`,
    ];
    for (const t of links) {
      const masked = maskShareLink(t)!;
      expect(masked).toContain("h.example:443");
      expect(masked).toContain(" · n");
      expect(masked).not.toContain("SuperSecretPw");
      expect(masked).not.toContain(UUID);
      for (const s of shareSecrets(ok(t))) expect(masked).not.toContain(s);
    }
    expect(shareSecrets(ok("hy2://SuperSecretPw@h.example:443?obfs=salamander&obfs-password=ObfsSecret"))).toEqual(["SuperSecretPw", "ObfsSecret"]);
  });
  test("长链接、普通代理地址不是节点链接", () => {
    expect(maskShareLink("socks5://a:b@h:1")).toBeNull();
    expect(bad(`trojan://${"a".repeat(9000)}@h:1`)).toContain("太长");
  });
  test("base64 解码", () => {
    expect(decodeBase64(b64url("中文 ✓"))).toBe("中文 ✓");
    expect(decodeBase64("a")).toBeNull();
    expect(decodeBase64("%%%")).toBeNull();
  });
});

/** 有 sing-box（CHISABOT_SINGBOX）时：每种链接生成的出站都要过 `sing-box check`（CI 没有就跳过）。 */
const SINGBOX = process.env.CHISABOT_SINGBOX ?? "";
describe.skipIf(!SINGBOX)("sing-box check 认这些出站", () => {
  const pbk = "Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw";
  const samples = [
    "trojan://p%40ss@node.example.com:443?allowInsecure=1&insecure=1&security=tls&type=tcp&headerType=none#n",
    "trojan://pw@1.2.3.4:8443?security=tls&sni=cdn.example.org&alpn=h2,http%2F1.1&fp=chrome&type=ws&host=ws.example.org&path=%2Fray%3Fed%3D2048",
    "trojan://pw@[2001:db8::1]:443?type=grpc&serviceName=svc",
    `vless://${UUID}@203.0.113.9:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=safari&pbk=${pbk}&sid=6ba85179e30d4fc2&type=tcp`,
    `vless://${UUID}@h.example:443?security=tls&type=httpupgrade&path=%2Fup&host=a.b`,
    `vless://${UUID}@h.example:443?security=tls&type=h2&path=%2Fh&host=a.b`,
    `vmess://${b64(JSON.stringify({ add: "jp.example.net", port: "443", id: UUID, aid: "0", scy: "auto", net: "ws", host: "cdn.example.net", path: "/vm?ed=1024", tls: "tls", ps: "n" }))}`,
    `ss://${b64url("aes-256-gcm:pa:ss")}@198.51.100.7:8388`,
    "ss://2022-blake3-aes-128-gcm:YctPZ6U7xPPcU%2Bgp3u%2BiAw%3D%3D@h.example:443",
    "hy2://pw@hy.example.com:8443/?sni=real.example.com&insecure=1&obfs=salamander&obfs-password=x&up=50&down=200",
    `tuic://${UUID}:pw@tuic.example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3`,
  ];
  for (const link of samples) {
    test(link.slice(0, 40), () => {
      const outbound = toSingBoxOutbound(ok(link));
      const cfg = JSON.stringify({ log: { level: "warn" }, inbounds: [{ type: "socks", listen: "127.0.0.1", listen_port: 1, users: [{ username: "u", password: "p" }] }], outbounds: [outbound], route: { final: "up" } });
      const r = Bun.spawnSync([SINGBOX, "check", "-c", "stdin"], { stdin: new TextEncoder().encode(cfg) });
      expect(r.stderr.toString()).toBe("");
      expect(r.exitCode).toBe(0);
    });
  }
});
