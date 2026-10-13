package cn.ayase.chisabot

import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * 扫码绑定（DESIGN.md §33）。网页「设置 → 设备 → 绑定手机」的二维码内容：
 * `chisabot://pair?server=<https 源>&code=cbp_<32 位 base64url>`（和 shared/devices.ts 的 pairingUri 同一格式）。
 */
object Pairing {

    class Link(val server: String, val code: String)

    private val CODE = Regex("^cbp_[A-Za-z0-9_-]{32}$")

    /** 解析二维码 / 链接；不是 ChisaBot 绑定码返回 null。服务器地址按登录页同一规则规范化（必须 https）。 */
    fun parse(text: String?): Link? {
        val raw = text?.trim().orEmpty()
        if (raw.isEmpty() || raw.length > 600) return null
        val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
        if (!uri.scheme.equals("chisabot", true) || !uri.host.equals("pair", true)) return null
        val code = uri.getQueryParameter("code")?.trim().orEmpty()
        val server = uri.getQueryParameter("server")?.trim().orEmpty()
        if (!CODE.matches(code) || server.isEmpty()) return null
        val origin = runCatching { GatewayAuth.normalize(server) }.getOrNull() ?: return null
        return Link(origin, code)
    }

    /** 设备列表里显示的名字：系统「设备名称」（如「Ayase 的 Xiaomi 14」），没有就用厂商 + 型号。 */
    fun deviceName(resolver: ContentResolver): String {
        val named = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
            runCatching { Settings.Global.getString(resolver, Settings.Global.DEVICE_NAME) }.getOrNull()
        } else null
        return named?.trim()?.takeIf { it.isNotEmpty() }?.take(64) ?: model()
    }

    fun model(): String {
        val maker = Build.MANUFACTURER.orEmpty().trim().replaceFirstChar { it.uppercase() }
        val model = Build.MODEL.orEmpty().trim()
        val text = if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
        return text.ifEmpty { "Android 手机" }.take(64)
    }

    fun osVersion(): String = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
}
