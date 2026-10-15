import { IconArrowLeft, IconFile, IconFolder, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ccDiffQueryOptions, ccFileQueryOptions, ccFilesQueryOptions } from "@/lib/cloud-cc";
import { cn } from "@/lib/utils";

export type RightTab = "changes" | "files";

/** unified diff 按文件切开（`diff --git a/x b/x` 开头）。 */
function splitPatch(patch: string): Map<string, string> {
  const map = new Map<string, string>();
  const chunks = patch.split(/^(?=diff --git )/m);
  for (const chunk of chunks) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    if (m) map.set(m[2]!, chunk);
  }
  return map;
}

/** 加行绿、删行红、@@ 灰，带新文件的行号（DESIGN.md §73.3）。 */
function DiffView({ patch }: { patch: string }) {
  const rows = useMemo(() => {
    const out: { cls: string; no: string; text: string }[] = [];
    let newNo = 0;
    for (const line of patch.split("\n").slice(0, 4000)) {
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(line)) continue;
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) {
        newNo = Number(hunk[1]);
        out.push({ cls: "is-hunk", no: "", text: line });
      } else if (line.startsWith("+")) out.push({ cls: "is-add", no: String(newNo++), text: line });
      else if (line.startsWith("-")) out.push({ cls: "is-del", no: "", text: line });
      else if (line.startsWith("\\")) continue;
      else if (line || newNo) out.push({ cls: "", no: String(newNo++), text: line });
    }
    return out;
  }, [patch]);
  if (!rows.length) return <div className="cc-rp-empty">{"没有文字改动（可能是二进制文件）。"}</div>;
  return (
    <pre className="cc-diff" data-testid="cc-diff">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diff 行没有稳定 id
        <span className={cn("cc-diff-row", r.cls)} key={i}>
          <span className="cc-diff-no">{r.no}</span>
          <span className="cc-diff-tx">{r.text || " "}</span>
        </span>
      ))}
    </pre>
  );
}

function ChangesTab({ sessionId, turnId, enabled }: { sessionId: string; turnId: string | null; enabled: boolean }) {
  const diff = useQuery(ccDiffQueryOptions(sessionId, turnId, enabled));
  const [selected, setSelected] = useState<string | null>(null);
  const byFile = useMemo(() => splitPatch(diff.data?.patch ?? ""), [diff.data?.patch]);
  if (diff.isPending) return <div className="cc-rp-empty">{"读取改动…"}</div>;
  if (diff.isError) return <div className="cc-rp-empty is-err">{diff.error.message}</div>;
  const files = diff.data.files;
  if (!files.length) return <div className="cc-rp-empty">{"这一轮没有改文件。"}</div>;
  const current = selected && byFile.has(selected) ? selected : files[0]!.path;
  return (
    <div className="cc-rp-changes">
      <div className="cc-rp-sub">
        <span>{"这一轮"}</span>
        <button aria-label="刷新" className="cc-icon-btn" onClick={() => void diff.refetch()} type="button">
          <IconRefresh className="size-3.5" />
        </button>
      </div>
      <div className="cc-rp-files" role="listbox">
        {files.map((f) => (
          <button aria-selected={f.path === current} className="cc-rp-file" data-testid="cc-rp-file" key={f.path} onClick={() => setSelected(f.path)} role="option" type="button">
            <i aria-hidden className={cn("cc-file-mark", f.status === "A" ? "is-add" : f.status === "D" ? "is-del" : "is-mod")} />
            <span className="cc-rp-file-p">{f.path}</span>
            <span className="cc-plus">{f.add === null ? "" : `+${f.add}`}</span>
            <span className="cc-minus">{f.del === null ? "" : `−${f.del}`}</span>
          </button>
        ))}
      </div>
      <DiffView patch={byFile.get(current) ?? ""} />
    </div>
  );
}

function FilesTab({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const list = useQuery(ccFilesQueryOptions(sessionId, dir, enabled && !file));
  const content = useQuery(ccFileQueryOptions(sessionId, file ?? "", enabled && !!file));
  if (file)
    return (
      <div className="cc-rp-viewer">
        <div className="cc-rp-sub">
          <button className="cc-crumb" onClick={() => setFile(null)} type="button">
            <IconArrowLeft className="size-3.5" />
            {file}
          </button>
          <span className="cc-ro">{"只读"}</span>
        </div>
        {content.isPending ? (
          <div className="cc-rp-empty">{"读取中…"}</div>
        ) : content.isError ? (
          <div className="cc-rp-empty is-err">{content.error.message}</div>
        ) : content.data.tooLarge ? (
          <div className="cc-rp-empty">{"文件超过 1 MB，不在这里显示。"}</div>
        ) : content.data.binary ? (
          <div className="cc-rp-empty">{"二进制文件。"}</div>
        ) : (
          <pre className="cc-code-view" data-testid="cc-file-view">
            {(content.data.text ?? "").split("\n").map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 行号就是 key
              <span className="cc-diff-row" key={i}>
                <span className="cc-diff-no">{i + 1}</span>
                <span className="cc-diff-tx">{line || " "}</span>
              </span>
            ))}
          </pre>
        )}
      </div>
    );
  return (
    <div className="cc-rp-tree">
      <div className="cc-rp-sub">
        {dir ? (
          <button className="cc-crumb" onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))} type="button">
            <IconArrowLeft className="size-3.5" />
            {dir}
          </button>
        ) : (
          <span>{"会话目录"}</span>
        )}
        <button aria-label="刷新" className="cc-icon-btn" onClick={() => void list.refetch()} type="button">
          <IconRefresh className="size-3.5" />
        </button>
      </div>
      {list.isPending ? (
        <div className="cc-rp-empty">{"读取中…"}</div>
      ) : list.isError ? (
        <div className="cc-rp-empty is-err">{list.error.message}</div>
      ) : list.data.entries.length === 0 ? (
        <div className="cc-rp-empty">{"还是空的。让 Claude 写点东西吧。"}</div>
      ) : (
        list.data.entries.map((e) => (
          <button className="cc-rp-entry" data-testid="cc-rp-entry" key={e.name} onClick={() => (e.dir ? setDir(dir ? `${dir}/${e.name}` : e.name) : setFile(dir ? `${dir}/${e.name}` : e.name))} type="button">
            {e.dir ? <IconFolder className="size-4 flex-none opacity-70" /> : <IconFile className="size-4 flex-none opacity-60" />}
            <span className="cc-rp-entry-n">{e.name}</span>
            {e.size !== null ? <span className="cc-rp-entry-s">{e.size < 1024 ? `${e.size} B` : `${(e.size / 1024).toFixed(1)} KB`}</span> : null}
          </button>
        ))
      )}
    </div>
  );
}

/** 右栏（桌面）/ 底部抽屉（手机）的内容：分段「改动｜文件」，只读（§11 决定 3）。 */
export function CcRightContent({ sessionId, tab, onTab, turnId, enabled }: { sessionId: string; tab: RightTab; onTab: (t: RightTab) => void; turnId: string | null; enabled: boolean }) {
  return (
    <div className="cc-rp-body">
      <div aria-label="右栏内容" className="sg-segmented cc-rp-seg" role="radiogroup">
        <button aria-checked={tab === "changes"} className="sg-segmented-item" data-testid="cc-tab-changes" onClick={() => onTab("changes")} role="radio" type="button">
          {"改动"}
        </button>
        <button aria-checked={tab === "files"} className="sg-segmented-item" data-testid="cc-tab-files" onClick={() => onTab("files")} role="radio" type="button">
          {"文件"}
        </button>
      </div>
      {tab === "changes" ? <ChangesTab enabled={enabled} sessionId={sessionId} turnId={turnId} /> : <FilesTab enabled={enabled} sessionId={sessionId} />}
    </div>
  );
}
