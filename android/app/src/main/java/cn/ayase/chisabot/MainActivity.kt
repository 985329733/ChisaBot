package cn.ayase.chisabot

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * ChisaBot Android：服务器上 ChisaBot 网页的原生外壳（与 PC 客户端同一套网页、同一个登录网关）。
 *
 * 登录（0.2.5 起）：本机的「登录 ChisaBot」页（assets/login/，和 PC 的 pc/src/ui/login.html 是同一份文件），
 * 在单独的 loginWeb 里打开，只有它能用 window.ChisaLogin。填服务器地址（保存在本机、带历史）、账号、密码、记住登录；
 * 先探测地址，再由本壳直接请求服务器登录网关（GatewayAuth），会话 Cookie 写进 CookieManager，然后载入网页。
 * 密码从不保存：记住登录 = 服务器发 30 天的会话 Cookie；不勾就是会话 Cookie，下次冷启动清掉。
 * 启动时会话仍有效就直接进入；网页被服务器跳到 /login（会话过期）时换回本机登录页。
 * 其余：文件上传 / 下载、返回键、外链交给浏览器、APK 在线更新（见 Updater）。网页本身的更新由网页横幅处理。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var loginWeb: WebView? = null
    private lateinit var root: FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingDownload: (() -> Unit)? = null
    private lateinit var updater: Updater

    private val prefs by lazy { getSharedPreferences("chisabot", Context.MODE_PRIVATE) }
    /** 用户登录过的地址 → 构建期默认值 → 空（通用版首次运行，登录页里填写）。 */
    private val server: String
        get() = prefs.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER
    private val serverHost: String?
        get() = Uri.parse(server).host

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        root = FrameLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString ChisaBotAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "ChisaBotAndroid")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener(Downloads())

        updater = Updater(this)
        when {
            prefs.getString("server", null).isNullOrBlank() -> showLogin()
            savedInstanceState != null && web.restoreState(savedInstanceState) != null -> Unit
            else -> enterApp(coldStart = true)
        }
        if (savedInstanceState == null) {
            updater.check(silent = true)
            handleIntent(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** 桌面图标长按 →「切换服务器」/「退出登录」快捷方式。 */
    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            ACTION_SERVER -> showLogin("switch")
            ACTION_LOGOUT -> confirmLogout()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        updater.onResume()
    }

    override fun onPause() {
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity.onBackPressed is still the simplest path on minSdk 24")
    override fun onBackPressed() {
        when {
            // 从网页里「切换服务器」打开的登录页：返回键回到网页
            loginWeb != null && web.url != null && hasSession -> hideLogin()
            loginWeb != null -> @Suppress("DEPRECATION") super.onBackPressed()
            web.canGoBack() -> web.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    // ---------- 本机登录页 ----------

    private var hasSession = false

    private fun origin(): String? = runCatching { GatewayAuth.normalize(server) }.getOrNull()

    private fun cookieFor(origin: String): String? = CookieManager.getInstance().getCookie("$origin/")

    /** 启动：会话还有效就直接进入；没有 / 过期去登录页；连不上就照常载入（显示「连不上」对话框）。 */
    private fun enterApp(coldStart: Boolean) {
        val o = origin() ?: return showLogin()
        val cookies = CookieManager.getInstance()
        val proceed = {
            Thread {
                val status = runCatching { GatewayAuth.probe(o, cookieFor(o)) }
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    val session = status.getOrNull()
                    when {
                        session == null -> web.loadUrl(o)
                        session.gateway && session.authenticated != true ->
                            showLogin(if (prefs.getBoolean("loggedIn", false)) "expired" else "")
                        else -> {
                            hasSession = true
                            web.loadUrl(o)
                        }
                    }
                }
            }.start()
        }
        // 没勾「记住登录」：会话 Cookie 只活到这次进程结束
        if (coldStart && !prefs.getBoolean("remember", true)) cookies.removeSessionCookies { proceed() } else proceed()
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun showLogin(notice: String = "") {
        pendingNotice = notice
        loginWeb?.let { view ->
            if (notice.isNotEmpty()) view.evaluateJavascript("window.__chisaLoginNotice&&window.__chisaLoginNotice(${JSONObject.quote(notice)})", null)
            return
        }
        val view = WebView(this)
        view.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            setSupportMultipleWindows(false)
        }
        view.addJavascriptInterface(LoginBridge(), "ChisaLogin")
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean =
                !request.url.toString().startsWith(LOGIN_URL_PREFIX)
        }
        view.setBackgroundColor(getColor(R.color.splash_bg))
        view.alpha = 0f
        root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.loadUrl(LOGIN_URL) // 提示文字由 ChisaLogin.state() 的 notice 带过去（asset 地址不带查询串）
        view.animate().alpha(1f).setDuration(220).start()
        loginWeb = view
    }

    private var pendingNotice = ""

    private fun hideLogin() {
        val view = loginWeb ?: return
        loginWeb = null
        view.animate().alpha(0f).setDuration(200).withEndAction {
            root.removeView(view)
            view.destroy()
        }.start()
    }

    private fun recentServers(): MutableList<String> {
        val list = mutableListOf<String>()
        runCatching { JSONArray(prefs.getString("recent", "[]")) }.getOrNull()?.let { arr ->
            for (i in 0 until arr.length()) arr.optString(i).takeIf { it.isNotBlank() }?.let(list::add)
        }
        return list
    }

    private fun saveRecent(list: List<String>) {
        prefs.edit().putString("recent", JSONArray(list.take(6)).toString()).apply()
    }

    /** 只挂在 loginWeb 上（只载入 file:///android_asset/login/），网页拿不到。 */
    inner class LoginBridge {
        private fun reply(id: Int, ok: Boolean, payload: String) = runOnUiThread {
            loginWeb?.evaluateJavascript("window.__chisaLoginReply($id,$ok,${JSONObject.quote(payload)})", null)
        }

        private fun async(id: Int, block: () -> JSONObject) {
            Thread {
                try {
                    reply(id, true, block().toString())
                } catch (e: GatewayAuth.LoginError) {
                    reply(id, false, "[${e.kind}] ${e.message}")
                } catch (e: Exception) {
                    reply(id, false, "[invalid] ${e.message ?: e.javaClass.simpleName}")
                }
            }.start()
        }

        @JavascriptInterface
        fun state(): String {
            val saved = prefs.getString("server", null)?.takeIf { it.isNotBlank() }
            return JSONObject()
                .put("server", saved ?: BuildConfig.DEFAULT_SERVER)
                .put("recent", JSONArray(recentServers()))
                .put("username", prefs.getString("username", "") ?: "")
                .put("remember", prefs.getBoolean("remember", true))
                .put("version", BuildConfig.VERSION_NAME)
                .put("notice", pendingNotice)
                .toString()
        }

        @JavascriptInterface
        fun forget(url: String): String {
            val list = recentServers().filter { it != url }
            saveRecent(list)
            return JSONArray(list).toString()
        }

        @JavascriptInterface
        fun probe(id: Int, json: String) = async(id) {
            val o = GatewayAuth.normalize(JSONObject(json).optString("serverUrl"))
            val session = GatewayAuth.probe(o, null)
            JSONObject().put("origin", o).put("gateway", session.gateway)
        }

        @JavascriptInterface
        fun login(id: Int, json: String) = async(id) {
            val input = JSONObject(json)
            val o = GatewayAuth.normalize(input.optString("serverUrl"))
            val username = input.optString("username").trim()
            val remember = input.optBoolean("remember", true)
            val setCookies = GatewayAuth.login(o, username, input.optString("password"), remember)
            val cm = CookieManager.getInstance()
            val previous = origin()
            if (previous != null && previous != o) {
                // 换服务器：清掉旧服务器的登录
                val latch = java.util.concurrent.CountDownLatch(1)
                runOnUiThread { cm.removeAllCookies { latch.countDown() } }
                latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
            }
            for (line in setCookies) cm.setCookie("$o/", line)
            cm.flush()
            prefs.edit()
                .putString("server", o)
                .putString("username", username)
                .putBoolean("remember", remember)
                .putBoolean("loggedIn", true)
                .apply()
            saveRecent(listOf(o) + recentServers().filter { it != o })
            JSONObject().put("warning", "")
        }

        @JavascriptInterface
        fun open() = runOnUiThread {
            hasSession = true
            offlineShown = false
            web.clearHistory()
            web.loadUrl(server)
            hideLogin()
        }
    }

    private fun isLoginPage(uri: Uri): Boolean =
        isServer(uri) && (uri.path ?: "").trimEnd('/').let { it == "/login" || it == "/sign" }

    /** 网页被服务器带到它自己的登录页（会话过期 / 被退出）：换成本机登录页。 */
    private fun sessionExpired() {
        if (loginWeb != null) return
        hasSession = false
        web.stopLoading()
        web.loadUrl("about:blank")
        showLogin("expired")
    }

    private fun confirmLogout() {
        if (origin() == null) return showLogin()
        AlertDialog.Builder(this)
            .setTitle("退出登录？")
            .setMessage("会清除这台设备上的登录状态。服务器地址和账号会保留，方便下次登录。")
            .setPositiveButton("退出登录") { _, _ -> logout() }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun logout() {
        val o = origin() ?: return showLogin()
        val cookie = cookieFor(o)
        Thread {
            GatewayAuth.logout(o, cookie)
            runOnUiThread {
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                prefs.edit().putBoolean("loggedIn", false).apply()
                hasSession = false
                web.loadUrl("about:blank")
                web.clearHistory()
                showLogin("logout")
            }
        }.start()
    }

    private fun isServer(uri: Uri): Boolean =
        uri.scheme.equals("https", true) && uri.host != null && uri.host.equals(serverHost, true) &&
            (Uri.parse(server).port.let { it == -1 || it == uri.port || (uri.port == -1 && it == 443) })

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "没有可以打开此链接的应用", Toast.LENGTH_SHORT).show()
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (request.isForMainFrame && isLoginPage(uri)) {
                sessionExpired()
                return true
            }
            if (isServer(uri)) return false
            when (uri.scheme?.lowercase()) {
                "http", "https" -> openExternal(uri)
                "intent" -> runCatching { startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)) }
                "blob", "data", "about", "javascript" -> return false
                else -> openExternal(uri)
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            if (url != null && isLoginPage(Uri.parse(url))) sessionExpired()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && loginWeb == null) offline(error.description?.toString())
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val intent = params.createIntent().apply {
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            return try {
                startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }
    }

    @Deprecated("startActivityForResult keeps the shell free of AndroidX activity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FILE) return super.onActivityResult(requestCode, resultCode, data)
        val cb = fileCallback ?: return
        fileCallback = null
        if (resultCode != RESULT_OK || data == null) return cb.onReceiveValue(null)
        val clip = data.clipData
        val uris = if (clip != null && clip.itemCount > 0) Array(clip.itemCount) { clip.getItemAt(it).uri }
        else WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        cb.onReceiveValue(uris)
    }

    /** 普通 https 下载交给系统下载管理器（带上登录 Cookie）；blob:/data: 由网页把内容交给 Bridge 保存。 */
    private inner class Downloads : DownloadListener {
        override fun onDownloadStart(url: String, userAgent: String, disposition: String?, mime: String?, length: Long) {
            val name = URLUtil.guessFileName(url, disposition, mime)
            when {
                url.startsWith("blob:") -> web.evaluateJavascript(blobJs(url, name, mime ?: ""), null)
                url.startsWith("data:") -> saveDataUrl(url, name)
                else -> withStorage {
                    val req = DownloadManager.Request(Uri.parse(url)).apply {
                        CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                        addRequestHeader("User-Agent", userAgent)
                        setMimeType(mime)
                        setTitle(name)
                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                    }
                    (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                    Toast.makeText(this@MainActivity, "正在下载 $name", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun blobJs(url: String, name: String, mime: String): String {
        fun q(s: String) = "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
        return """(function(){fetch(${q(url)}).then(function(r){return r.blob()}).then(function(b){
            var f=new FileReader();f.onloadend=function(){ChisaBotAndroid.saveDataUrl(f.result,${q(name)},${q(mime)}||b.type)};
            f.readAsDataURL(b)}).catch(function(e){ChisaBotAndroid.saveFailed(String(e))})})();"""
    }

    private fun saveDataUrl(dataUrl: String, name: String, mimeHint: String? = null) {
        val comma = dataUrl.indexOf(',')
        if (comma < 0) return
        val meta = dataUrl.substring(5, comma)
        val mime = mimeHint?.takeIf { it.isNotBlank() } ?: meta.substringBefore(';').ifBlank { "application/octet-stream" }
        val payload = dataUrl.substring(comma + 1)
        val bytes = if (meta.endsWith(";base64")) Base64.decode(payload, Base64.DEFAULT) else Uri.decode(payload).toByteArray()
        withStorage {
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                } else {
                    @Suppress("DEPRECATION")
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    dir.mkdirs()
                    File(dir, name).writeBytes(bytes)
                }
            }.onSuccess { Toast.makeText(this, "已保存到「下载」：$name", Toast.LENGTH_SHORT).show() }
                .onFailure { Toast.makeText(this, "保存失败：${it.message}", Toast.LENGTH_LONG).show() }
        }
    }

    /** Android 9 及以下写公共下载目录要存储权限；10 起不需要。 */
    private fun withStorage(action: () -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        ) return action()
        pendingDownload = action
        requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode != REQ_STORAGE) return
        val action = pendingDownload
        pendingDownload = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) action?.invoke()
        else Toast.makeText(this, "没有存储权限，无法保存文件", Toast.LENGTH_SHORT).show()
    }

    /** 只给服务器自己的页面用。 */
    inner class Bridge {
        @JavascriptInterface
        fun saveDataUrl(dataUrl: String, name: String, mime: String) = runOnUiThread {
            if (web.url?.let { isServer(Uri.parse(it)) } == true) this@MainActivity.saveDataUrl(dataUrl, name, mime)
        }

        @JavascriptInterface
        fun saveFailed(message: String) = runOnUiThread {
            Toast.makeText(this@MainActivity, "下载失败：$message", Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun checkUpdate() = runOnUiThread { updater.check(silent = false) }

        @JavascriptInterface
        fun changeServer() = runOnUiThread {
            if (web.url?.let { isServer(Uri.parse(it)) } == true) showLogin("switch")
        }

        @JavascriptInterface
        fun logout() = runOnUiThread {
            if (web.url?.let { isServer(Uri.parse(it)) } == true) confirmLogout()
        }
    }

    private var offlineShown = false

    private fun offline(reason: String?) {
        if (offlineShown || isFinishing) return
        offlineShown = true
        AlertDialog.Builder(this)
            .setTitle("连不上 ChisaBot")
            .setMessage("$server\n${reason ?: ""}".trim())
            .setCancelable(false)
            .setPositiveButton("重试") { _, _ -> offlineShown = false; enterApp(coldStart = false) }
            .setNeutralButton("切换服务器") { _, _ -> offlineShown = false; showLogin("switch") }
            .setNegativeButton("退出") { _, _ -> finish() }
            .show()
    }

    companion object {
        private const val REQ_FILE = 41
        private const val REQ_STORAGE = 42
        const val ACTION_SERVER = "cn.ayase.chisabot.SERVER"
        const val ACTION_LOGOUT = "cn.ayase.chisabot.LOGOUT"
        private const val LOGIN_URL_PREFIX = "file:///android_asset/login/"
        private const val LOGIN_URL = LOGIN_URL_PREFIX + "login.html"
    }
}
