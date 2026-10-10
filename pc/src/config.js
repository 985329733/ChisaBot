"use strict";
/**
 * 本机配置与本机审计日志（userData 目录）。
 * 设备令牌用 Electron safeStorage（Windows 上是 DPAPI）加密后保存；不可用时才明文保存并在设置页提示。
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  serverUrl: "",
  username: "",
  deviceId: "",
  deviceName: "",
  tokenEnc: "",
  tokenPlain: "",
  autoStart: false,
  forceLocalApproval: true,
  localPaused: false,
  startHidden: false,
};

function createConfig({ dir, safeStorage }) {
  const file = path.join(dir, "config.json");
  const auditFile = path.join(dir, "audit.jsonl");
  let data = { ...DEFAULTS };
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {}

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const encryptionAvailable = () => {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  return {
    get: () => ({ ...data }),
    set(patch) {
      data = { ...data, ...patch };
      save();
      return { ...data };
    },
    getToken() {
      if (data.tokenEnc && encryptionAvailable()) {
        try {
          return safeStorage.decryptString(Buffer.from(data.tokenEnc, "base64"));
        } catch {
          return null;
        }
      }
      return data.tokenPlain || null;
    },
    setToken(token) {
      if (!token) {
        data.tokenEnc = "";
        data.tokenPlain = "";
      } else if (encryptionAvailable()) {
        data.tokenEnc = safeStorage.encryptString(token).toString("base64");
        data.tokenPlain = "";
      } else {
        data.tokenEnc = "";
        data.tokenPlain = token;
      }
      save();
    },
    tokenProtected: () => !!data.tokenEnc,
    appendAudit(entry) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`);
        const stat = fs.statSync(auditFile);
        if (stat.size > 2 * 1024 * 1024) {
          const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n");
          fs.writeFileSync(auditFile, `${lines.slice(-2000).join("\n")}\n`);
        }
      } catch {}
    },
    readAudit(limit = 200) {
      try {
        const lines = fs.readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean);
        return lines.slice(-limit).reverse().map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

module.exports = { createConfig, DEFAULTS };
