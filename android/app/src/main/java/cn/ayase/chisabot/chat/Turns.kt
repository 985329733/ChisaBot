package cn.ayase.chisabot.chat

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** 聊天画面里的一行（从上到下）。key 稳定，LazyColumn 靠它保持位置不跳（DESIGN §35）。 */
sealed class Row(val key: String) {
    class User(val msg: ChatMessage) : Row("u:" + msg.id)
    /** 机器人的一段话：opening = 开场一句，result = 结果，process = 过程话（还在跑时淡色显示，结束后收起）。 */
    class Bot(key: String, val text: String, val kind: Kind, val streaming: Boolean, val copyable: Boolean) : Row(key)
    /** 一轮一张干活卡（§75）：live = 这一轮还在跑。 */
    class Work(key: String, val turnKey: String, val calls: List<ToolCall>, val live: Boolean) : Row(key)
    /** render_ui 画的卡片（json-render spec）。 */
    class Card(key: String, val spec: String) : Row(key)
    /** 还没有干活卡、这一轮在跑、末尾不是字：「思考中」。 */
    class Thinking(key: String) : Row(key)
    /** 末尾是字、这一轮还在跑、没有干活卡：停住 0.9 秒后出小点（§78.2，由界面计时）。 */
    class Pause(key: String, val lastText: String) : Row(key)
    class Error(key: String, val text: String) : Row(key)

    enum class Kind { Opening, Process, Result }
}

private sealed class Seg {
    class Text(val id: String, val text: String) : Seg()
    class Tool(val call: ToolCall) : Seg()
}

object Turns {
    /** render_ui 的 spec：参数 {spec: "<json 字符串>"} 或 {spec: {…}}。 */
    fun renderSpec(call: ToolCall): String? {
        val args = WorkSteps.parseArgs(call.args)
        val spec = args["spec"] ?: return null
        return (spec as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: spec.toString()
    }

    fun build(messages: List<ChatMessage>, running: Boolean, error: String?): List<Row> {
        val rows = mutableListOf<Row>()
        // 第一条用户消息之前的机器人消息（欢迎语等）也按一轮处理
        val turns = mutableListOf<Pair<ChatMessage?, MutableList<ChatMessage>>>()
        for (m in messages) {
            if (m.role == "user") turns += m to mutableListOf()
            else if (turns.isEmpty()) turns += null to mutableListOf(m)
            else turns.last().second += m
        }
        for ((index, turn) in turns.withIndex()) {
            val (user, replies) = turn
            if (user != null) rows += Row.User(user)
            val last = index == turns.lastIndex
            buildTurn(rows, user?.id ?: "pre", replies, running && last)
        }
        if (!running && error != null) rows += Row.Error("err:" + (turns.lastOrNull()?.first?.id ?: "x"), error)
        return rows
    }

    private fun buildTurn(rows: MutableList<Row>, turnKey: String, replies: List<ChatMessage>, live: Boolean) {
        val segs = mutableListOf<Seg>()
        for (m in replies) {
            if (m.text.isNotBlank()) segs += Seg.Text(m.id, m.text)
            for (c in m.toolCalls) segs += Seg.Tool(c)
        }
        val calls = segs.filterIsInstance<Seg.Tool>().map { it.call }
        val workIdx = segs.indexOfFirst { it is Seg.Tool && WorkSteps.isWorkCall(it.call.name) }
        val lastToolIdx = segs.indexOfLast { it is Seg.Tool }
        // 结果：最后一个工具之后的字；以卡片收尾（后面没字）且这一轮结束 → 卡片前最后一段话当结果（§75.3）
        var resultIdx = -1
        if (lastToolIdx < 0) {
            resultIdx = segs.indexOfLast { it is Seg.Text }
        } else {
            val after = (lastToolIdx + 1 until segs.size).lastOrNull { segs[it] is Seg.Text }
            if (after != null) resultIdx = after
            else if (!live) {
                val lastTool = (segs[lastToolIdx] as Seg.Tool).call
                if (lastTool.name == "render_ui") resultIdx = (0 until lastToolIdx).lastOrNull { segs[it] is Seg.Text } ?: -1
            }
        }
        var workPlaced = false
        val hasWork = workIdx >= 0
        for ((n, seg) in segs.withIndex()) {
            when (seg) {
                is Seg.Text -> {
                    val streamingNow = live && n == segs.lastIndex
                    when {
                        n == resultIdx -> rows += Row.Bot("t:" + seg.id, seg.text, Row.Kind.Result, streamingNow, !live)
                        !hasWork || n < workIdx -> rows += Row.Bot("t:" + seg.id, seg.text, Row.Kind.Opening, streamingNow, false)
                        live -> rows += Row.Bot("t:" + seg.id, seg.text, Row.Kind.Process, streamingNow, false)
                        else -> Unit // 结束后过程话收起（§75）
                    }
                }
                is Seg.Tool -> {
                    if (n == workIdx && !workPlaced) {
                        rows += Row.Work("w:$turnKey", turnKey, calls, live)
                        workPlaced = true
                    }
                    if (seg.call.name == "render_ui") renderSpec(seg.call)?.let { rows += Row.Card("c:" + seg.call.id, it) }
                }
            }
        }
        if (live) {
            val tail = segs.lastOrNull()
            when {
                hasWork -> Unit // 有卡时末尾不再画「思考中」，卡片本身在动
                tail is Seg.Text -> rows += Row.Pause("p:$turnKey", tail.text)
                else -> rows += Row.Thinking("k:$turnKey")
            }
        }
    }
}
