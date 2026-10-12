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
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File

/**
 * ChisaBot Android：服务器上 ChisaBot 网页的原生外壳（与 PC 客户端同一套网页、同一个登录网关）。
 * 登录由网页自己完成（网关 Cookie 存在 WebView 的 CookieManager 里）；本壳只补网页做不到的事：
 * 文件上传 / 下载、返回键、外链交给浏览器、APK 在线更新（见 Updater）。网页本身的更新由网页横幅处理。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingDownload: (() -> Unit)? = null
    private lateinit var updater: Updater

    private val prefs by lazy { getSharedPreferences("chisabot", Context.MODE_PRIVATE) }
    /** 用户填过的地址 → 构建期默认值 → 空（通用版首次运行，弹出「服务器地址」）。 */
    private val server: String
        get() = prefs.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER
    private val serverHost: String?
        get() = Uri.parse(server).host

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(FrameLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        })

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
            server.isBlank() -> askServer(firstRun = true)
            savedInstanceState == null || web.restoreState(savedInstanceState) == null -> web.loadUrl(server)
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

    /** 桌面图标长按 →「服务器地址」快捷方式。 */
    private fun handleIntent(intent: Intent?) {
        if (intent?.action == ACTION_SERVER) askServer()
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
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
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
            if (isServer(uri)) return false
            when (uri.scheme?.lowercase()) {
                "http", "https" -> openExternal(uri)
                "intent" -> runCatching { startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)) }
                "blob", "data", "about", "javascript" -> return false
                else -> openExternal(uri)
            }
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) offline(error.description?.toString())
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
        fun changeServer() = runOnUiThread { askServer() }
    }

    private var offlineShown = false

    private fun offline(reason: String?) {
        if (offlineShown || isFinishing) return
        offlineShown = true
        AlertDialog.Builder(this)
            .setTitle("连不上 ChisaBot")
            .setMessage("$server\n${reason ?: ""}".trim())
            .setCancelable(false)
            .setPositiveButton("重试") { _, _ -> offlineShown = false; web.loadUrl(server) }
            .setNeutralButton("更改服务器") { _, _ -> offlineShown = false; askServer() }
            .setNegativeButton("退出") { _, _ -> finish() }
            .show()
    }

    private fun askServer(firstRun: Boolean = false) {
        val pad = (20 * resources.displayMetrics.density).toInt()
        val input = EditText(this).apply {
            setText(server)
            setSingleLine()
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            hint = "https://chisabot.example.com:8443"
        }
        val box = FrameLayout(this).apply { setPadding(pad, pad / 2, pad, 0); addView(input) }
        val dialog = AlertDialog.Builder(this)
            .setTitle("服务器地址")
            .setMessage("就是你在浏览器里打开 ChisaBot 的地址（你自己或管理员部署的服务器）。以后可以长按桌面图标 →「服务器地址」修改。")
            .setView(box)
            .setCancelable(!firstRun)
            .setPositiveButton("连接", null)
            .apply { if (firstRun) setNegativeButton("退出") { _, _ -> finish() } else setNegativeButton("取消", null) }
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                var v = input.text.toString().trim().trimEnd('/')
                if (v.isNotEmpty() && !v.contains("://")) v = "https://$v"
                val uri = Uri.parse(v)
                if (!uri.scheme.equals("https", true) || uri.host.isNullOrBlank()) {
                    input.error = "请输入 https:// 开头的地址"
                    return@setOnClickListener
                }
                prefs.edit().putString("server", v).apply()
                dialog.dismiss()
                web.clearHistory()
                web.loadUrl(v)
            }
        }
        dialog.show()
    }

    companion object {
        private const val REQ_FILE = 41
        private const val REQ_STORAGE = 42
        const val ACTION_SERVER = "cn.ayase.chisabot.SERVER"
    }
}
