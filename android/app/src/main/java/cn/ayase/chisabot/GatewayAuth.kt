package cn.ayase.chisabot

import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException

/**
 * 本机登录页用的网络请求（和 PC 的 pc/src/agent/auth.js 同一套规则）：
 *  - normalize：补 https://、去掉路径和末尾 /；
 *  - probe：/auth/session（登录网关，不需要登录）→ /health → /api/version，有 HTTP 回应就算连得上；
 *  - login：直接 POST 服务器登录网关 /auth/login（和网页登录表单同一个请求，带 Origin），
 *    不是网关的部署退回 Better Auth（/api/auth/sign-in/email）；返回服务器下发的 Set-Cookie 原文；
 *  - logout：POST /auth/logout。
 * 错误统一成 LoginError(kind, 中文说明)，kind = unreachable | cert | auth | rate | invalid | server。
 */
object GatewayAuth {

    class LoginError(val kind: String, message: String) : Exception(message)

    class Session(val gateway: Boolean, val authenticated: Boolean?)

    fun normalize(input: String): String {
        var text = input.trim().trimEnd('/')
        if (text.isEmpty()) throw LoginError("invalid", "请填写服务器地址。")
        if (!text.contains("://")) text = "https://$text"
        val url = try {
            URL(text)
        } catch (_: Exception) {
            throw LoginError("invalid", "服务器地址格式不对，例如 chisabot.example.com:8443")
        }
        if (!url.protocol.equals("https", true)) throw LoginError("invalid", "服务器地址必须是 https。")
        if (url.host.isNullOrBlank()) throw LoginError("invalid", "服务器地址格式不对，例如 chisabot.example.com:8443")
        if (url.userInfo != null) throw LoginError("invalid", "服务器地址里不能包含账号密码。")
        return "https://" + url.host + (if (url.port == -1 || url.port == 443) "" else ":" + url.port)
    }

    private fun networkError(e: Throwable): LoginError {
        var cause: Throwable? = e
        while (cause != null) {
            if (cause is SSLException || cause is CertificateException) {
                return LoginError("cert", "证书错误：服务器的 HTTPS 证书无效或不受信任（${cause.javaClass.simpleName}）。")
            }
            cause = cause.cause
        }
        return when (e) {
            is UnknownHostException -> LoginError("unreachable", "地址无法连接：找不到这个域名，请检查拼写。")
            is ConnectException -> LoginError("unreachable", "地址无法连接：服务器拒绝连接，请检查端口。")
            is SocketTimeoutException -> LoginError("unreachable", "地址无法连接：服务器没有响应（超时）。")
            else -> LoginError("unreachable", "地址无法连接（${e.javaClass.simpleName}），请检查地址和网络。")
        }
    }

    private class Reply(val status: Int, val body: String, val setCookies: List<String>)

    private fun request(url: String, method: String, origin: String?, cookie: String?, json: String?, timeoutMs: Int = 10000): Reply {
        val conn = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw networkError(e)
        }
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.requestMethod = method
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "ChisaBotAndroid/${BuildConfig.VERSION_NAME}")
            if (origin != null) conn.setRequestProperty("Origin", origin)
            if (!cookie.isNullOrBlank()) conn.setRequestProperty("Cookie", cookie)
            if (json != null) {
                val bytes = json.toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            val cookies = conn.headerFields.entries
                .filter { it.key != null && it.key.equals("Set-Cookie", true) }
                .flatMap { it.value }
            return Reply(status, body, cookies)
        } catch (e: LoginError) {
            throw e
        } catch (e: IOException) {
            throw networkError(e)
        } finally {
            conn.disconnect()
        }
    }

    fun probe(origin: String, cookie: String?): Session {
        var last: LoginError? = null
        for (path in listOf("/auth/session", "/health", "/api/version")) {
            val reply = request(origin + path, "GET", null, cookie, null, 8000)
            if (path == "/auth/session" && reply.status == 200) {
                val body = runCatching { JSONObject(reply.body) }.getOrNull()
                if (body != null && body.has("authenticated")) return Session(true, body.optBoolean("authenticated"))
            }
            if (reply.status < 500 && reply.status != 404) return Session(false, null)
            if (reply.status >= 500) last = LoginError("server", "服务器暂时不可用（${reply.status}），请稍后再试。")
        }
        throw last ?: LoginError("invalid", "这个地址能打开，但不像 ChisaBot 服务器，请检查地址。")
    }

    private fun error(reply: Reply, fallback: String): String =
        runCatching { JSONObject(reply.body).optString("error").ifBlank { null } }.getOrNull() ?: fallback

    /** 返回服务器下发的 Set-Cookie 原文（交给 CookieManager）。 */
    fun login(origin: String, username: String, password: String, remember: Boolean): List<String> {
        if (username.isBlank() || password.isEmpty()) throw LoginError("auth", "请填写账号和密码。")
        val gatewayBody = JSONObject().put("username", username).put("password", password).put("remember", remember).toString()
        var reply = request("$origin/auth/login", "POST", origin, null, gatewayBody)
        if (reply.status == 404 || reply.status == 405) {
            val body = JSONObject().put("email", username).put("password", password).put("rememberMe", remember).toString()
            reply = request("$origin/api/auth/sign-in/email", "POST", origin, null, body)
        }
        when {
            reply.status == 429 -> throw LoginError("rate", "尝试次数过多，请稍后再试。")
            reply.status == 401 || reply.status == 400 -> throw LoginError("auth", "账号或密码错误。")
            reply.status == 403 -> throw LoginError("invalid", error(reply, "服务器拒绝了这次登录（来源不匹配），请确认地址和浏览器里打开的完全一致。"))
            reply.status >= 500 -> throw LoginError("server", "服务器暂时不可用（${reply.status}），请稍后再试。")
            reply.status !in 200..299 -> throw LoginError("invalid", error(reply, "登录失败（${reply.status}）。"))
        }
        if (reply.setCookies.isEmpty()) throw LoginError("invalid", "登录成功但服务器没有返回会话，请检查服务器地址。")
        return reply.setCookies
    }

    fun logout(origin: String, cookie: String?) {
        runCatching { request("$origin/auth/logout", "POST", origin, cookie, null, 6000) }
    }
}
