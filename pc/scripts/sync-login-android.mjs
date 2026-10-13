// 把本机登录页（src/ui/login.* 和它依赖的令牌 / 组件 / 天空）复制给 Android 客户端：
// android/app/src/main/assets/login/。PC 和 Android 用同一份登录页；test/login.check.js 会检查是否同步。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "src", "ui");
const to = join(here, "..", "..", "android", "app", "src", "main", "assets", "login");
mkdirSync(to, { recursive: true });
for (const file of ["login.html", "login.css", "login.js", "ui.css", "ui.js", "sky.js", "skyglass-tokens.css", "logo.png"]) {
  copyFileSync(join(from, file), join(to, file));
  console.log(`→ android/app/src/main/assets/login/${file}`);
}
