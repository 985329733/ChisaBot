package cn.ayase.chisabot.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** 一次工具调用（AG-UI toolCalls[] + 对应的 tool 消息）。 */
data class ToolCall(
    val id: String,
    val name: String,
    val args: String = "",
    val result: String? = null,
    val ended: Boolean = false,
)

/** 界面用的一条消息（从 AG-UI Message 或流式事件来）。 */
data class ChatMessage(
    val id: String,
    val role: String,
    val text: String = "",
    val toolCalls: List<ToolCall> = emptyList(),
    val images: List<String> = emptyList(),
)

fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
fun JsonObject.s(key: String): String? = this[key].str()
fun JsonObject.o(key: String): JsonObject? = this[key] as? JsonObject
fun JsonObject.a(key: String): JsonArray? = this[key] as? JsonArray

/** user 消息的 content 可能是字符串，也可能是 [{type:text,text}, {type:image|binary, url|source…}]。 */
fun contentParts(content: JsonElement?): Pair<String, List<String>> {
    if (content == null || content is JsonNull) return "" to emptyList()
    if (content is JsonPrimitive) return (content.contentOrNull ?: "") to emptyList()
    val text = StringBuilder()
    val images = mutableListOf<String>()
    (content as? JsonArray)?.forEach { part ->
        val p = part as? JsonObject ?: return@forEach
        when (p.s("type")) {
            "text" -> p.s("text")?.let { if (text.isNotEmpty()) text.append("\n"); text.append(it) }
            else -> {
                val url = p.s("url") ?: p.o("source")?.s("url") ?: p.o("image_url")?.s("url")
                val mime = p.s("mimeType") ?: p.o("source")?.s("mimeType") ?: ""
                if (url != null && (p.s("type") == "image" || mime.startsWith("image/") || p.s("type") == "image_url")) images += url
            }
        }
    }
    return text.toString() to images
}

/** GET /api/copilotkit/threads/<id>/messages 的 messages[] → 界面消息（tool 结果并进对应的调用）。 */
fun parseHistory(messages: JsonArray): List<ChatMessage> {
    val out = mutableListOf<ChatMessage>()
    val results = HashMap<String, String>()
    for (el in messages) {
        val m = el as? JsonObject ?: continue
        if (m.s("role") == "tool") m.s("toolCallId")?.let { results[it] = m["content"].let { c -> c.str() ?: c.toString() } }
    }
    for (el in messages) {
        val m = el as? JsonObject ?: continue
        val role = m.s("role") ?: continue
        if (role == "tool" || role == "system" || role == "developer") continue
        val (text, images) = contentParts(m["content"])
        val calls = m.a("toolCalls")?.mapNotNull { c ->
            val call = c as? JsonObject ?: return@mapNotNull null
            val id = call.s("id") ?: return@mapNotNull null
            val fn = call.o("function")
            ToolCall(id, fn?.s("name") ?: "", fn?.s("arguments") ?: "", results[id], ended = true)
        } ?: emptyList()
        out += ChatMessage(m.s("id") ?: "m${out.size}", role, text, calls, images)
    }
    return out
}

/**
 * AG-UI 事件 → 消息列表（纯函数，便于单测）。只处理画面需要的事件；其余（STATE_*、ACTIVITY_*、REASONING_* …）忽略。
 */
class AgUiReducer(initial: List<ChatMessage> = emptyList()) {
    val messages = initial.toMutableList()
    var running = false
        private set
    var error: String? = null
        private set
    var finished = false
        private set

    private fun indexOf(id: String) = messages.indexOfFirst { it.id == id }

    private fun ensureAssistant(id: String?): Int {
        if (id != null) {
            val at = indexOf(id)
            if (at >= 0) return at
            messages += ChatMessage(id, "assistant")
            return messages.lastIndex
        }
        val last = messages.lastIndex
        if (last >= 0 && messages[last].role == "assistant") return last
        messages += ChatMessage("a${messages.size}", "assistant")
        return messages.lastIndex
    }

    private fun updateCall(callId: String, change: (ToolCall) -> ToolCall) {
        for (i in messages.indices.reversed()) {
            val m = messages[i]
            val at = m.toolCalls.indexOfFirst { it.id == callId }
            if (at >= 0) {
                messages[i] = m.copy(toolCalls = m.toolCalls.toMutableList().also { it[at] = change(it[at]) })
                return
            }
        }
    }

    fun apply(event: JsonObject) {
        when (event.s("type")) {
            "RUN_STARTED" -> { running = true; error = null }
            "RUN_FINISHED" -> { running = false; finished = true }
            "RUN_ERROR" -> { running = false; finished = true; error = event.s("message") ?: "这一轮没有完成" }
            "TEXT_MESSAGE_START" -> { if ((event.s("role") ?: "assistant") == "assistant") ensureAssistant(event.s("messageId")) }
            "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK" -> {
                val delta = event.s("delta") ?: return
                val at = ensureAssistant(event.s("messageId"))
                messages[at] = messages[at].copy(text = messages[at].text + delta)
            }
            "TOOL_CALL_START", "TOOL_CALL_CHUNK" -> {
                val id = event.s("toolCallId") ?: return
                if (messages.any { m -> m.toolCalls.any { it.id == id } }) {
                    event.s("delta")?.let { d -> updateCall(id) { it.copy(args = it.args + d) } }
                    return
                }
                val at = ensureAssistant(event.s("parentMessageId"))
                val call = ToolCall(id, event.s("toolCallName") ?: "", event.s("delta") ?: "")
                messages[at] = messages[at].copy(toolCalls = messages[at].toolCalls + call)
            }
            "TOOL_CALL_ARGS" -> {
                val id = event.s("toolCallId") ?: return
                val d = event.s("delta") ?: return
                updateCall(id) { it.copy(args = it.args + d) }
            }
            "TOOL_CALL_END" -> event.s("toolCallId")?.let { id -> updateCall(id) { it.copy(ended = true) } }
            "TOOL_CALL_RESULT" -> event.s("toolCallId")?.let { id ->
                val content = event["content"].let { c -> c.str() ?: c.toString() }
                updateCall(id) { it.copy(result = content, ended = true) }
            }
            "MESSAGES_SNAPSHOT" -> event.a("messages")?.let { snap ->
                val parsed = parseHistory(snap)
                if (parsed.isNotEmpty()) { messages.clear(); messages.addAll(parsed) }
            }
        }
    }
}
