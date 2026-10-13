import {
  IconDownload,
  IconFile,
  IconFileCode,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypeDoc,
  IconFileTypePdf,
  IconFileZip,
  IconPhoto,
  IconWorld,
} from "@tabler/icons-react";
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ExtractedImage,
  extensionOf,
  extractRichContent,
  formatBytes,
} from "@/lib/rich-previews/extract";
import { Lightbox, type LightboxImage } from "./lightbox";

/**
 * 聊天富预览（2026-10-13；DESIGN.md §31）：
 * - 链接卡：消息里的网址（最多 3 个）在气泡下面变成玻璃卡片——预览图、图标、标题、域名，点开新标签页。
 *   数据来自 `GET /api/link-preview`（服务器只连公网、图片也由服务器转存，浏览器不直接访问第三方）。
 *   取的时候是同形状骨架；取不到就整张卡不出现（不报错）。
 * - 图片：一张就是一张图卡；两张以上叠成一摞（每张轻微倾斜），悬停 / 聚焦 / 第一次轻点时摊开，点哪张
 *   就从哪张打开看大图（{@link Lightbox}）。
 * - 文件：图标 + 文件名 + 类型 · 大小 + 下载。
 *
 * 流式回复时文字一直在变：等文字停下约 0.9 秒再找网址，不会拿半截网址去取预览。
 */

export type LinkPreviewData = {
  url: string;
  finalUrl: string;
  title: string;
  siteName: string;
  domain: string;
  description: string;
  image: string | null;
  imageKind: "og" | "shot" | "direct" | "none";
  imagePending: boolean;
  favicon: string | null;
};

class PreviewMissing extends Error {}

/**
 * 预览自己的查询缓存：不依赖页面上有没有 QueryClientProvider（频道记录、测试、以后别的地方都能直接用），
 * 也不和应用的其它查询混在一起。
 */
const previewClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function WithPreviewClient({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={previewClient}>{children}</QueryClientProvider>
  );
}

async function fetchPreview(url: string): Promise<LinkPreviewData> {
  const response = await fetch(
    `/api/link-preview?url=${encodeURIComponent(url)}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new PreviewMissing(String(response.status));
  const body = (await response.json().catch(() => null)) as {
    preview?: LinkPreviewData;
  } | null;
  if (!body?.preview || typeof body.preview.title !== "string")
    throw new PreviewMissing("bad body");
  return body.preview;
}

function previewQuery(url: string) {
  return {
    queryKey: ["link-preview", url] as const,
    queryFn: () => fetchPreview(url),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: (failures: number, error: unknown) =>
      !(error instanceof PreviewMissing) && failures < 1,
    refetchOnWindowFocus: false,
    // 截图在服务器后台做：先拿到标题，图还在路上时每 2.5 秒问一次，最多约 30 秒。
    refetchInterval: (query: {
      state: { data?: LinkPreviewData; dataUpdateCount: number };
    }) =>
      query.state.data?.imagePending && query.state.dataUpdateCount < 12
        ? 2500
        : false,
  };
}

/**
 * 文字停下 `ms` 毫秒后才返回它（流式回复时不追着半截文字跑）。
 *
 * 刚挂载时先用「去掉最后一个没写完的词」的文字：历史消息里句中的网址立刻出卡片，结尾那个网址可能还在
 * 流式输出，等停下再算。
 */
export function useSettledText(text: string, ms = 900): string {
  const [settled, setSettled] = useState(() =>
    /[\s。！？.!?)）]$/.test(text) ? text : text.replace(/\S+$/, ""),
  );
  useEffect(() => {
    if (settled === text) return;
    const timer = window.setTimeout(() => setSettled(text), ms);
    return () => window.clearTimeout(timer);
  }, [text, ms, settled]);
  return settled;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------------------------
// 链接卡
// ---------------------------------------------------------------------------------------------

function LinkCard({ url }: { url: string }) {
  const { data, isPending, isError } = useQuery(previewQuery(url));
  const [imageBroken, setImageBroken] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  if (isError) return null;
  if (isPending || !data) {
    return (
      <div aria-hidden className="rp-link rp-link-skel">
        <div className="rp-link-media sky-skel-block" />
        <div className="rp-link-body">
          <span className="rp-skel-bar sky-skel-bar" style={{ width: "42%" }} />
          <span className="rp-skel-bar sky-skel-bar" style={{ width: "88%" }} />
        </div>
      </div>
    );
  }
  const showImage = (data.image && !imageBroken) || data.imagePending;
  const site =
    data.siteName && data.siteName !== data.title ? data.siteName : data.domain;
  return (
    <a
      className="rp-link"
      data-has-image={showImage ? "" : undefined}
      href={data.url}
      rel="noopener noreferrer"
      target="_blank"
      title={data.finalUrl}
    >
      {showImage ? (
        <div className="rp-link-media" data-kind={data.imageKind}>
          {data.image && !imageBroken ? (
            <img
              alt=""
              decoding="async"
              loading="lazy"
              onError={() => setImageBroken(true)}
              src={data.image}
            />
          ) : (
            <span className="sky-skel-block rp-link-media-wait" />
          )}
        </div>
      ) : null}
      <div className="rp-link-body">
        <span className="rp-link-site">
          {data.favicon && !iconBroken ? (
            <img
              alt=""
              className="rp-link-icon"
              onError={() => setIconBroken(true)}
              src={data.favicon}
            />
          ) : (
            <IconWorld
              aria-hidden
              className="rp-link-icon rp-link-icon-fallback"
            />
          )}
          <span className="rp-link-site-name">{site}</span>
          {site !== data.domain ? (
            <span className="rp-link-domain">{data.domain}</span>
          ) : null}
        </span>
        <span className="rp-link-title">{data.title || data.domain}</span>
        {data.description && !showImage ? (
          <span className="rp-link-desc">{data.description}</span>
        ) : null}
      </div>
    </a>
  );
}

function LinkPreviewCardsInner({ urls }: { urls: readonly string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="rp-links" data-count={urls.length}>
      {urls.map((url) => (
        <LinkCard key={url} url={url} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 图片：单张 / 一摞
// ---------------------------------------------------------------------------------------------

export type PileImage = LightboxImage;

const ROTATIONS = [-5, 4, -2.5, 3];
const MAX_IN_PILE = 4;

export function ImagePile({
  images,
  align = "start",
}: {
  images: readonly PileImage[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [spread, setSpread] = useState(false);
  const [step, setStep] = useState(64);
  const root = useRef<HTMLDivElement | null>(null);
  // 按下那一刻是否已经摊开：轻点会先触发 focus（把这一摞摊开），click 时再读 state 就晚了。
  const spreadAtPress = useRef<boolean | null>(null);
  const shown = useMemo(
    () => images.filter((image) => !broken[image.src]),
    [images, broken],
  );

  // 摊开时每张错开多少：容器越宽错开越多（窄栏 / 手机也不会出界）。
  useLayoutEffect(() => {
    const el = root.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const visible = Math.min(shown.length, MAX_IN_PILE);
      const card =
        root.current?.querySelector<HTMLElement>(".rp-pile-card")
          ?.offsetWidth ?? 160;
      const width = el.clientWidth;
      setStep(
        visible > 1
          ? Math.max(
              24,
              Math.min(card * 0.82, (width - card - 8) / (visible - 1)),
            )
          : 0,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown.length]);

  if (shown.length === 0) return null;
  const markBroken = (src: string) => setBroken((b) => ({ ...b, [src]: true }));

  if (shown.length === 1) {
    const image = shown[0]!;
    return (
      <div className="rp-images" data-align={align}>
        <button
          aria-label={`查看图片${image.name ? `：${image.name}` : ""}`}
          className="rp-image-single"
          onClick={() => setOpen(0)}
          type="button"
        >
          <img
            alt={image.alt || image.name || "图片"}
            decoding="async"
            loading="lazy"
            onError={() => markBroken(image.src)}
            src={image.src}
          />
        </button>
        {open !== null ? (
          <Lightbox
            images={shown}
            onClose={() => setOpen(null)}
            startIndex={open}
          />
        ) : null}
      </div>
    );
  }

  const visible = shown.slice(0, MAX_IN_PILE);
  const extra = shown.length - visible.length;
  const coarse =
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: none)").matches;
  return (
    <div className="rp-images" data-align={align}>
      {/* biome-ignore lint/a11y/useSemanticElements: 一摞图片是一组按钮，不是表单（fieldset 会带来表单语义和默认样式） */}
      <div
        aria-label={`${shown.length} 张图片`}
        className="rp-pile"
        data-spread={spread || undefined}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setSpread(false);
        }}
        onFocus={() => setSpread(true)}
        onMouseEnter={() => !coarse && setSpread(true)}
        onPointerDownCapture={() => {
          spreadAtPress.current = spread;
        }}
        onMouseLeave={() => !coarse && setSpread(false)}
        ref={root}
        role="group"
        style={
          {
            "--rp-step": `${step}px`,
            "--rp-n": visible.length,
          } as CSSProperties
        }
      >
        {visible.map((image, i) => {
          const order = visible.length - 1 - i; // 第一张在最上面
          return (
            <button
              aria-label={`查看第 ${i + 1} 张图片（共 ${shown.length} 张）`}
              className="rp-pile-card"
              // biome-ignore lint/suspicious/noArrayIndexKey: 同一地址可以出现两次（两个附件指向同一份文件），位置才是唯一的
              key={`${i}:${image.src}`}
              onClick={() => {
                // 手机上第一次轻点先摊开，再点哪张开哪张。
                const wasSpread = spreadAtPress.current ?? spread;
                spreadAtPress.current = null;
                if (coarse && !wasSpread) {
                  setSpread(true);
                  return;
                }
                setOpen(i);
              }}
              style={
                {
                  "--rp-i": i,
                  "--rp-rot": `${ROTATIONS[i % ROTATIONS.length]}deg`,
                  zIndex: order + 1,
                } as CSSProperties
              }
              type="button"
            >
              <img
                alt={image.alt || image.name || `图片 ${i + 1}`}
                decoding="async"
                draggable={false}
                loading="lazy"
                onError={() => markBroken(image.src)}
                src={image.src}
              />
              {i === visible.length - 1 && extra > 0 ? (
                <span className="rp-pile-more">+{extra}</span>
              ) : null}
            </button>
          );
        })}
        <span aria-hidden className="rp-pile-count">
          <IconPhoto className="size-3.5" />
          {shown.length}
        </span>
      </div>
      {open !== null ? (
        <Lightbox
          images={shown}
          onClose={() => setOpen(null)}
          startIndex={open}
        />
      ) : null}
    </div>
  );
}

/** 网址指向第三方的图片：先请服务器转存（同一个链接预览接口），浏览器只读本站的副本。 */
function useResolvedImages(images: readonly ExtractedImage[]): PileImage[] {
  const external = images.filter((image) => /^https?:/i.test(image.src));
  const results = useQueries({
    queries: external.map((image) => previewQuery(image.src)),
  });
  return images.flatMap((image): PileImage[] => {
    if (!/^https?:/i.test(image.src))
      return [{ src: image.src, alt: image.alt }];
    const result = results[external.indexOf(image)];
    const data = result?.data;
    if (!data?.image || data.imageKind !== "direct") return [];
    return [{ src: data.image, alt: image.alt, name: data.title }];
  });
}

// ---------------------------------------------------------------------------------------------
// 文件卡
// ---------------------------------------------------------------------------------------------

function fileIcon(ext: string) {
  if (ext === "pdf") return IconFileTypePdf;
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return IconFileTypeDoc;
  if (["xls", "xlsx", "csv", "tsv", "ods", "numbers"].includes(ext))
    return IconFileSpreadsheet;
  if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext))
    return IconFileZip;
  if (
    [
      "js",
      "ts",
      "tsx",
      "jsx",
      "py",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "h",
      "json",
      "yaml",
      "yml",
      "toml",
      "sh",
      "html",
      "css",
      "sql",
      "xml",
    ].includes(ext)
  )
    return IconFileCode;
  if (["txt", "md", "log"].includes(ext)) return IconFileText;
  return IconFile;
}

/** 同站文件的大小：HEAD 一下读 content-length（拿不到就不显示）。 */
function useRemoteSize(
  url: string,
  known: number | null | undefined,
  probe: boolean,
): number | null {
  const sameOrigin = url.startsWith("/") && !url.startsWith("//");
  const { data } = useQuery({
    queryKey: ["file-size", url],
    enabled: probe && sameOrigin && (known === undefined || known === null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const response = await fetch(url, {
        method: "HEAD",
        credentials: "include",
      });
      const length = Number(response.headers.get("content-length"));
      return response.ok && Number.isFinite(length) && length > 0
        ? length
        : null;
    },
  });
  return known ?? data ?? null;
}

function lastSegment(url: string): string {
  const raw = url.split("?")[0]?.split("/").pop() || "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function FileCardInner({
  url,
  name,
  size,
  mimeType,
  probeSize = true,
}: {
  url: string;
  name?: string;
  size?: number | null;
  mimeType?: string;
  /** 调用方自己已经 HEAD 过（频道附件），就别再问一次。 */
  probeSize?: boolean;
}) {
  const label = name || lastSegment(url) || "未命名文件";
  const ext =
    extensionOf(label) ||
    (mimeType?.split("/")[1] ?? "").replace(/^x-/, "").slice(0, 6);
  const bytes = useRemoteSize(url, size, probeSize);
  const Icon = fileIcon(ext);
  const meta = [ext ? ext.toUpperCase() : "文件", formatBytes(bytes)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rp-file">
      <span aria-hidden className="rp-file-icon" data-ext={ext || undefined}>
        <Icon className="size-5" />
      </span>
      <a
        className="rp-file-text"
        href={url}
        rel="noopener noreferrer"
        target="_blank"
        title={label}
      >
        <span className="rp-file-name">{label}</span>
        <span className="rp-file-meta">{meta}</span>
      </a>
      <a
        aria-label={`下载 ${label}`}
        className="rp-file-dl"
        download={label}
        href={url}
        title="下载"
      >
        <IconDownload className="size-4" />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 一条消息下面的全部预览
// ---------------------------------------------------------------------------------------------

export type MessageMedia = {
  images?: readonly PileImage[];
  files?: readonly {
    url: string;
    name?: string;
    size?: number | null;
    mimeType?: string;
  }[];
};

function MessageRichPreviewsInner({
  text,
  align = "start",
  media,
}: {
  text: string;
  align?: "start" | "end";
  media?: MessageMedia;
}) {
  const settled = useSettledText(text);
  const found = useMemo(() => extractRichContent(settled), [settled]);
  const fromText = useResolvedImages(found.images);
  const images = useMemo(
    () => [...(media?.images ?? []), ...fromText],
    [media?.images, fromText],
  );
  const files = media?.files ?? [];
  if (images.length === 0 && files.length === 0 && found.links.length === 0)
    return null;
  return (
    <div className="rp-stack" data-align={align}>
      {images.length > 0 ? <ImagePile align={align} images={images} /> : null}
      {files.length > 0 ? (
        <div className="rp-files">
          {files.map((file) => (
            <FileCard key={file.url} {...file} />
          ))}
        </div>
      ) : null}
      <LinkPreviewCards urls={found.links} />
    </div>
  );
}

export function LinkPreviewCards(
  props: Parameters<typeof LinkPreviewCardsInner>[0],
) {
  return (
    <WithPreviewClient>
      <LinkPreviewCardsInner {...props} />
    </WithPreviewClient>
  );
}

export function FileCard(props: Parameters<typeof FileCardInner>[0]) {
  return (
    <WithPreviewClient>
      <FileCardInner {...props} />
    </WithPreviewClient>
  );
}

export function MessageRichPreviews(
  props: Parameters<typeof MessageRichPreviewsInner>[0],
) {
  return (
    <WithPreviewClient>
      <MessageRichPreviewsInner {...props} />
    </WithPreviewClient>
  );
}

/** Markdown 里的内联图片不在正文里画（避免浏览器直连第三方、也避免和下面的图片卡重复）。 */
export function HiddenMarkdownImage() {
  return null;
}

export { hostOf };
