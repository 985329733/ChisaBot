package cn.ayase.chisabot

import android.app.Application
import android.content.Context
import android.webkit.CookieManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cn.ayase.chisabot.chat.AgUiReducer
import cn.ayase.chisabot.chat.ChatMessage
import cn.ayase.chisabot.chat.a
import cn.ayase.chisabot.chat.o
import cn.ayase.chisabot.chat.parseHistory
import cn.ayase.chisabot.chat.s
import cn.ayase.chisabot.net.Api
import cn.ayase.chisabot.net.Unauthorized
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.Call
import java.util.UUID

private val Context.store by preferencesDataStore("native")
private val BOTS_CACHE = stringPreferencesKey("bots")

data class Bot(val id: String, val name: String, val title: String, val seed: String, val main: Boolean)

data class Panel(
    val id: String, val title: String, val status: String, val spec: String?, val sources: List<Pair<String, String>>,
    val refreshedAt: String?, val refreshMinutes: Int?, val refreshAt: String?, val refreshing: Boolean, val error: String?,
)

sealed class Screen {
    data object Login : Screen()
    data object Bots : Screen()
    data class Chat(val bot: Bot) : Screen()
    data class Panels(val bot: Bot) : Screen()
    data class Web(val path: String, val title: String) : Screen()
}

/**
 * 整个应用的状态。登录信息沿用 WebView 版的 SharedPreferences「chisabot」（同一组键）和 CookieManager，
 * 原生版只多一个 DataStore「native」缓存机器人列表（冷启动先画缓存，不白屏）。
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    val prefs = app.getSharedPreferences("chisabot", Context.MODE_PRIVATE)
    private val ctx get() = getApplication<Application>()

    val stack = mutableStateListOf<Screen>()
    val screen: Screen get() = stack.lastOrNull() ?: Screen.Login
    var notice by mutableStateOf("")

    val server: String get() = prefs.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_SERVER
    fun origin(): String? = runCatching { GatewayAuth.normalize(server) }.getOrNull()

    private var apiCache: Api? = null
    val api: Api?
        get() {
            val o = origin() ?: return null
            if (apiCache?.origin != o) apiCache = Api(o) { renewWithDevice(o) }
            return apiCache
        }

    // ---------- 登录 ----------

    private val deviceToken: String?
        get() = prefs.getString("deviceToken", null)?.takeIf { it.startsWith("cbd_") && prefs.getString("deviceServer", null) == origin() }

    private var lastRenewAt = 0L
    /** 会话没了：用扫码绑定的设备令牌静默换一个（60 秒内最多一次）。 */
    private suspend fun renewWithDevice(o: String): Boolean = withContext(Dispatchers.IO) {
        val token = deviceToken ?: return@withContext false
        if (System.currentTimeMillis() - lastRenewAt < 60_000) return@withContext false
        lastRenewAt = System.currentTimeMillis()
        try {
            setCookies(o, GatewayAuth.deviceSession(o, token, Pairing.osVersion()))
            true
        } catch (e: GatewayAuth.LoginError) {
            if (e.kind == "revoked") {
                prefs.edit().remove("deviceToken").remove("deviceServer").remove("deviceId").remove("deviceName").apply()
                withContext(Dispatchers.Main) { notice = e.message ?: "" }
            }
            false
        } catch (_: Exception) { false }
    }

    private fun setCookies(o: String, lines: List<String>) {
        val cm = CookieManager.getInstance()
        for (line in lines) cm.setCookie("$o/", line)
        cm.flush()
    }

    fun start() {
        if (stack.isNotEmpty()) return
        if (prefs.getString("server", null).isNullOrBlank()) { stack += Screen.Login; return }
        stack += Screen.Bots
        viewModelScope.launch {
            runCatching { ctx.store.data.first()[BOTS_CACHE] }.getOrNull()?.let { cached ->
                runCatching { bots = parseBots(Api.json.parseToJsonElement(cached) as JsonArray) }
            }
            loadBots()
        }
    }

    fun recentServers(): List<String> = runCatching {
        org.json.JSONArray(prefs.getString("recent", "[]")).let { arr -> (0 until arr.length()).map { arr.getString(it) } }
    }.getOrDefault(emptyList())

    private fun saveRecent(o: String) {
        val list = listOf(o) + recentServers().filter { it != o }
        prefs.edit().putString("recent", org.json.JSONArray(list.take(6)).toString()).apply()
    }

    /** 扫码 / 系统相机链接：绑定码 → 设备令牌 → 网关会话（和 WebView 版同一套请求）。 */
    suspend fun pair(link: Pairing.Link) = withContext(Dispatchers.IO) {
        val os = Pairing.osVersion()
        val paired = GatewayAuth.pair(link.server, link.code, Pairing.deviceName(ctx.contentResolver), Pairing.model(), os)
        val oldToken = prefs.getString("deviceToken", null)
        val oldServer = prefs.getString("deviceServer", null)
        if (oldToken != null && oldServer != null) GatewayAuth.unenroll(oldServer, oldToken)
        prefs.edit().putString("deviceToken", paired.token).putString("deviceServer", link.server)
            .putString("deviceId", paired.deviceId).putString("deviceName", paired.deviceName).apply()
        setCookies(link.server, GatewayAuth.deviceSession(link.server, paired.token, os))
        prefs.edit().putString("server", link.server).putBoolean("remember", true).putBoolean("loggedIn", true).apply()
        saveRecent(link.server)
    }

    suspend fun passwordLogin(serverInput: String, username: String, password: String, remember: Boolean) = withContext(Dispatchers.IO) {
        val o = GatewayAuth.normalize(serverInput)
        GatewayAuth.probe(o, null)
        setCookies(o, GatewayAuth.login(o, username.trim(), password, remember))
        val oldServer = prefs.getString("deviceServer", null)
        if (oldServer != null && oldServer != o) prefs.getString("deviceToken", null)?.let { GatewayAuth.unenroll(oldServer, it) }
        prefs.edit().putString("server", o).putString("username", username.trim()).putBoolean("remember", remember).putBoolean("loggedIn", true).apply()
        saveRecent(o)
    }

    /** 没有登录网关的服务器（自己部署、本机预览）：只记地址，直接进。 */
    suspend fun openWithoutGateway(serverInput: String) = withContext(Dispatchers.IO) {
        val o = GatewayAuth.normalize(serverInput)
        GatewayAuth.probe(o, null)
        prefs.edit().putString("server", o).putBoolean("loggedIn", true).apply()
        saveRecent(o)
    }

    fun enterApp() {
        notice = ""
        stack.clear(); stack += Screen.Bots
        bots = emptyList()
        viewModelScope.launch { loadBots() }
    }

    fun logout() {
        val o = origin()
        val token = deviceToken
        viewModelScope.launch(Dispatchers.IO) {
            if (o != null) {
                if (token != null) GatewayAuth.unenroll(o, token)
                GatewayAuth.logout(o, CookieManager.getInstance().getCookie("$o/"))
            }
        }
        prefs.edit().putBoolean("loggedIn", false).remove("deviceToken").remove("deviceServer").remove("deviceId").remove("deviceName").apply()
        CookieManager.getInstance().removeAllCookies(null)
        stopRun()
        stack.clear(); stack += Screen.Login
    }

    /** 会话失效（服务器把我们带回登录）：不解除绑定，只回登录页；有设备令牌时下次请求会先静默续期。 */
    fun expired() {
        stopRun()
        notice = if (notice.isNotBlank()) notice else "登录已过期，请重新登录或扫码绑定。"
        stack.clear(); stack += Screen.Login
    }

    // ---------- 导航 ----------
    fun push(s: Screen) { stack += s }
    fun back(): Boolean {
        if (stack.size <= 1) return false
        val top = stack.removeAt(stack.lastIndex)
        if (top is Screen.Chat) stopWatching()
        return true
    }

    // ---------- 机器人 ----------
    var bots by mutableStateOf<List<Bot>>(emptyList())
    var botsLoading by mutableStateOf(false)
    var botsError by mutableStateOf<String?>(null)

    private fun parseBots(arr: JsonArray, mainId: String? = null): List<Bot> {
        val list = arr.mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            if (o["hidden"]?.toString() == "true") return@mapNotNull null
            Bot(o.s("id") ?: return@mapNotNull null, o.s("name") ?: "机器人", o.s("title") ?: "", o.s("avatarSeed") ?: "", o["main"]?.toString() == "true")
        }
        val withMain = if (mainId != null) list.map { it.copy(main = it.id == mainId) } else list
        // 主机器人置顶（ADR-0001：左栏只列机器人，主机器人在最上面）
        return withMain.sortedByDescending { it.main }
    }

    fun loadBots() {
        val api = api ?: return
        botsLoading = true
        viewModelScope.launch {
            try {
                val agents = api.get("/api/agents").a("agents") ?: JsonArray(emptyList())
                val mainId = runCatching { api.get("/api/settings/preferences").o("preferences")?.s("mainBotId") }.getOrNull()
                bots = parseBots(agents, mainId)
                botsError = null
                val cache = buildJsonArray { bots.forEach { b -> add(buildJsonObject { put("id", b.id); put("name", b.name); put("title", b.title); put("avatarSeed", b.seed); put("main", b.main) }) } }
                ctx.store.edit { it[BOTS_CACHE] = cache.toString() }
            } catch (_: Unauthorized) {
                expired()
            } catch (e: Exception) {
                botsError = e.message ?: "无法加载机器人列表"
            } finally { botsLoading = false }
        }
    }

    // ---------- 聊天 ----------
    var chatBot by mutableStateOf<Bot?>(null)
    var threadId by mutableStateOf<String?>(null)
    var channelId by mutableStateOf<String?>(null)
    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
    var running by mutableStateOf(false)
    var runError by mutableStateOf<String?>(null)
    var chatLoading by mutableStateOf(false)
    var chatLoadError by mutableStateOf<String?>(null)
    /** 这台手机上看着干活卡跑起来的时间（turnKey → 毫秒），收成一行时才能写用时（§70.2）。 */
    val workStarted = HashMap<String, Long>()
    val workEnded = HashMap<String, Long>()
    private var runJob: Job? = null
    private var watchJob: Job? = null
    private var liveCall: Call? = null

    fun openChat(bot: Bot) {
        stopRun()
        chatBot = bot; threadId = null; channelId = null; messages = emptyList(); runError = null; chatLoadError = null
        push(Screen.Chat(bot))
        loadChat(bot)
    }

    fun loadChat(bot: Bot) {
        val api = api ?: return
        chatLoading = true
        viewModelScope.launch {
            try {
                val channels = api.get("/api/channels?limit=100").a("channels") ?: JsonArray(emptyList())
                // 机器人这一行打开它最近的一对一会话（和网页 latestChannelFor 一样；列表按最近排序）
                val mine = channels.mapNotNull { it as? JsonObject }.filter { c ->
                    val ids = c.a("agentIds")?.map { (it as? JsonPrimitive)?.content }
                    ids?.size == 1 && ids[0] == bot.id
                }
                val chosen = mine.maxByOrNull { it.s("lastMessageAt") ?: "" } ?: mine.firstOrNull()
                val t = chosen?.s("threadId")
                threadId = t
                channelId = chosen?.s("id")
                if (t != null) {
                    val hist = api.get("/api/copilotkit/threads/$t/messages").a("messages") ?: JsonArray(emptyList())
                    if (!running) messages = parseHistory(hist)
                    val inbox = runCatching { api.get("/api/copilotkit/threads/$t/inbox") }.getOrNull()
                    if (inbox?.get("running")?.toString() == "true" && !running) watch(bot, t)
                }
                chatLoadError = null
            } catch (_: Unauthorized) { expired() }
            catch (e: Exception) { chatLoadError = e.message ?: "无法加载对话" }
            finally { chatLoading = false }
        }
    }

    /** 别的设备上正在回答（或刷新前开始的一轮）：每 1.5 秒读一次历史，直到这一轮结束。流式续接放到第二阶段。 */
    private fun watch(bot: Bot, t: String) {
        watchJob?.cancel()
        watchJob = viewModelScope.launch {
            val api = api ?: return@launch
            running = true
            try {
                while (true) {
                    delay(1500)
                    if (chatBot?.id != bot.id || threadId != t) break
                    val hist = api.get("/api/copilotkit/threads/$t/messages").a("messages") ?: break
                    messages = parseHistory(hist)
                    val inbox = api.get("/api/copilotkit/threads/$t/inbox")
                    if (inbox["running"]?.toString() != "true") break
                }
            } catch (_: Exception) { } finally { running = false }
        }
    }

    private fun stopWatching() { watchJob?.cancel(); watchJob = null }

    /** 发一条：没有会话就先建（POST /api/channels），然后 POST /api/copilotkit/agent/<bot>/run 读 AG-UI 事件流。 */
    suspend fun send(text: String): Boolean {
        val bot = chatBot ?: return false
        val api = api ?: return false
        if (running) return false
        runError = null
        try {
            var t = threadId
            if (t == null) {
                val created = api.post("/api/channels", buildJsonObject { putJsonArray("agentIds") { add(JsonPrimitive(bot.id)) } })
                t = created.o("channel")?.s("threadId") ?: throw IllegalStateException("无法开始会话")
                threadId = t
                channelId = created.o("channel")?.s("id")
            }
            val userMsg = ChatMessage(UUID.randomUUID().toString(), "user", text)
            messages = messages + userMsg
            val tid = t
            running = true
            runJob = viewModelScope.launch { runTurn(api, bot, tid, userMsg) }
            return true
        } catch (_: Unauthorized) { expired(); return false }
        catch (e: Exception) { runError = e.message ?: "发送失败"; return false }
    }

    private suspend fun runTurn(api: Api, bot: Bot, t: String, userMsg: ChatMessage) {
        val reducer = AgUiReducer(messages)
        val body = buildJsonObject {
            put("threadId", t)
            put("runId", UUID.randomUUID().toString())
            // 服务器以存下的历史为准，客户端只追加新消息（server local-conversations.ts prepareConversationMessages）
            putJsonArray("messages") { add(buildJsonObject { put("id", userMsg.id); put("role", "user"); put("content", userMsg.text) }) }
            putJsonArray("tools") {}
            putJsonArray("context") {}
            putJsonObject("state") {}
            putJsonObject("forwardedProps") {}
        }
        var lastPush = 0L
        try {
            api.stream("/api/copilotkit/agent/${bot.id}/run", body, onCall = { liveCall = it }) { event ->
                reducer.apply(event)
                val now = System.currentTimeMillis()
                // 每 50ms 最多推一次画面（逐字平滑由界面负责，§ streaming.md）
                if (now - lastPush >= 50 || event.s("type") == "RUN_FINISHED" || event.s("type")?.startsWith("TOOL_CALL") == true) {
                    lastPush = now
                    val snapshot = reducer.messages.toList()
                    withContext(Dispatchers.Main) { if (threadId == t) messages = snapshot }
                }
            }
            withContext(Dispatchers.Main) {
                if (threadId == t) {
                    messages = reducer.messages.toList()
                    runError = reducer.error
                }
            }
        } catch (_: Unauthorized) { withContext(Dispatchers.Main) { expired() } }
        catch (e: Exception) {
            withContext(Dispatchers.Main) {
                if (threadId == t && liveCall?.isCanceled() != true) runError = "连接断了：${e.message ?: e.javaClass.simpleName}"
            }
        } finally {
            withContext(Dispatchers.Main) {
                running = false
                liveCall = null
                // 读一次服务器存下的历史，让本机和别的设备一致（含 MESSAGES_SNAPSHOT 之外的整理）
                if (threadId == t) runCatching { api.get("/api/copilotkit/threads/$t/messages").a("messages") }.getOrNull()?.let {
                    val parsed = parseHistory(it)
                    if (parsed.isNotEmpty()) messages = parsed
                }
            }
        }
    }

    fun stop() {
        val bot = chatBot ?: return
        val t = threadId ?: return
        val api = api ?: return
        viewModelScope.launch {
            runCatching { api.post("/api/copilotkit/agent/${bot.id}/stop/$t") }
            delay(400)
            liveCall?.cancel()
        }
    }

    /** 新话题：下一条消息建一个新的一对一会话（和网页「新话题」一样，旧会话留在历史里）。 */
    fun newTopic() {
        if (running) return
        threadId = null; channelId = null; messages = emptyList(); runError = null
        workStarted.clear(); workEnded.clear()
    }

    private fun stopRun() { liveCall?.cancel(); runJob?.cancel(); stopWatching(); running = false }

    // ---------- 面板（只读，§77） ----------
    var panels by mutableStateOf<List<Panel>>(emptyList())
    var panelsLoading by mutableStateOf(false)
    var panelsError by mutableStateOf<String?>(null)
    private var panelsJob: Job? = null

    fun openPanels(bot: Bot) { push(Screen.Panels(bot)); loadPanels(bot, poll = true) }

    fun loadPanels(bot: Bot, poll: Boolean = false) {
        val api = api ?: return
        panelsJob?.cancel()
        panelsJob = viewModelScope.launch {
            panelsLoading = true
            do {
                try {
                    val items = api.get("/api/live-panels?botId=${bot.id}").a("items") ?: JsonArray(emptyList())
                    panels = items.mapNotNull { el ->
                        val o = el as? JsonObject ?: return@mapNotNull null
                        Panel(
                            o.s("id") ?: return@mapNotNull null, o.s("title") ?: "面板", o.s("status") ?: "ready", o.s("spec"),
                            o.a("sources")?.mapNotNull { s -> (s as? JsonObject)?.let { (it.s("name") ?: "") to (it.s("url") ?: "") } } ?: emptyList(),
                            o.s("refreshedAt"), o.s("refreshMinutes")?.toIntOrNull(), o.s("refreshAt"), o["refreshing"]?.toString() == "true", o.s("error"),
                        )
                    }
                    panelsError = null
                } catch (_: Unauthorized) { expired(); return@launch }
                catch (e: Exception) { panelsError = e.message ?: "无法加载面板" }
                panelsLoading = false
                // 有正在搭建 / 刷新的面板：5 秒后再看一次（只读，不触发刷新）
                val busy = panels.any { it.status == "building" || it.refreshing }
                if (!poll || !busy || screen !is Screen.Panels) break
                delay(5000)
            } while (true)
        }
    }
}
