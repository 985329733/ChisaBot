import {
  IconArrowUpRight,
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
  type LinkRef,
  splitLinkLines,
} from "@/lib/rich-previews/extract";
import { SmoothStreamdown } from "@/components/chat/smooth-markdown";
import { Lightbox, type LightboxImage } from "./lightbox";

/**
 * 聊天富预览（2026-10-13；DESIGN.md §31）：
 * - 链接卡（DESIGN.md §48）：单独占一行的链接（最多 3 个）在正文下面变成紧凑玻璃卡——缩略图 / 站点图标、
 *   标题、域名、可选标签（`[下载 0.1.7](网址)`），整张可点、新标签页打开（PC / 安卓客户端交给系统浏览器）。
 *   数据来自 `GET /api/link-preview`（服务器只连公网、图片也由服务器转存，浏览器不直接访问第三方）。
 *   取的时候是同尺寸骨架；取不到就画「图标 + 域名」的兜底卡，照样能点。
 * - 图片：一张就是一张图卡；两张以上叠成一摞（每张轻微倾斜），悬停 / 聚焦 / 第一次轻点时摊开，点哪张
 *   就从哪张打开看大图（{@link Lightbox}）。
 * - 文件：图标 + 文件名 + 类型 · 大小 + 下载。
 *
 * 流式回复时：写完的行（后面已经有换行）立刻出卡；最后一行要等文字停下约 0.9 秒（或后面来了换行）才算写完，
 * 之前它如果像一行链接，就先藏起来、卡片位置放骨架——不会拿半截网址去取预览，也不会先闪一行网址。
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
  /** 网页没取到（被拦 / 超时 / 不是网页）：只有域名和站点图标的兜底卡。 */
  degraded?: boolean;
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
 * 刚挂载时当作已经写完（历史消息、重放的记录立刻出卡）；之后每变一次都要再停 `ms` 才算写完。
 */
export function useSettledText(text: string, ms = 900): string {
  const [settled, setSettled] = useState(text);
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

/** 兜底卡用的短地址：github.com/ChisaAlter/Chis… */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    const text = `${u.hostname.replace(/^www\./, "")}${path}`;
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  } catch {
    return url;
  }
}

function isSquarish(img: HTMLImageElement): boolean {
  return img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight < 1.25;
}

function LinkCardSkeleton() {
  return (
    <div aria-hidden className="rp-link rp-link-skel" data-testid="link-card-skeleton">
      <span className="rp-link-tile sky-skel-block" />
      <span className="rp-link-body">
        <span className="rp-skel-bar sky-skel-bar" style={{ width: "78%" }} />
        <span className="rp-skel-bar sky-skel-bar" style={{ width: "40%" }} />
      </span>
    </div>
  );
}

function LinkCard({ link }: { link: LinkRef }) {
  const { data, isPending, isError } = useQuery(previewQuery(link.url));
  const [imageBroken, setImageBroken] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  // 接近方形的 og 图（logo）整张放进缩略图，宽的分享图居中裁（styles.css §48）。
  const [square, setSquare] = useState(false);
  if (isPending && !isError) return <LinkCardSkeleton />;
  const domain = data?.domain || hostOf(link.url);
  const degraded = !data || data.degraded === true;
  const image =
    data?.image && data.imageKind !== "none" && !imageBroken ? data.image : null;
  const favicon = data?.favicon && !iconBroken ? data.favicon : null;
  const title = data?.title || domain;
  // 兜底卡标题就是域名时，第二行给短地址，不要两行都是同一个域名。
  const meta = title === domain ? shortUrl(link.url) : domain;
  const kind = image ? "image" : favicon ? "icon" : "none";
  return (
    <a
      aria-label={`${link.label ? `${link.label}：` : ""}${title}（${domain}），在新窗口打开`}
      className="rp-link"
      data-degraded={degraded ? "" : undefined}
      data-testid="link-card"
      href={link.url}
      rel="noopener noreferrer"
      target="_blank"
      title={data?.finalUrl || link.url}
    >
      <span
        className="rp-link-tile"
        data-kind={kind}
        data-square={kind === "image" && square ? "" : undefined}
      >
        {image ? (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            onError={() => setImageBroken(true)}
            onLoad={(event) => setSquare(isSquarish(event.currentTarget))}
            // 已经在缓存里的图可能在 React 挂上 onLoad 之前就加载完了：挂载时再量一次。
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) setSquare(isSquarish(img));
            }}
            referrerPolicy="no-referrer"
            src={image}
          />
        ) : favicon ? (
          <img
            alt=""
            decoding="async"
            onError={() => setIconBroken(true)}
            referrerPolicy="no-referrer"
            src={favicon}
          />
        ) : (
          <IconWorld aria-hidden />
        )}
      </span>
      <span className="rp-link-body">
        <span className="rp-link-title">{title}</span>
        <span className="rp-link-meta">
          {link.label ? <span className="rp-link-label">{link.label}</span> : null}
          {image && favicon ? (
            <img
              alt=""
              className="rp-link-icon"
              onError={() => setIconBroken(true)}
              src={favicon}
            />
          ) : null}
          <span className="rp-link-domain">{meta}</span>
        </span>
      </span>
      <IconArrowUpRight aria-hidden className="rp-link-go" />
    </a>
  );
}

function LinkPreviewCardsInner({
  links,
  pending = false,
}: {
  links: readonly LinkRef[];
  /** 流式中最后一行像是一行链接：多放一个骨架占位。 */
  pending?: boolean;
}) {
  const count = links.length + (pending ? 1 : 0);
  if (count === 0) return null;
  return (
    <div className="rp-links" data-count={count} data-testid="link-cards">
      {links.map((link) => (
        <LinkCard key={link.url} link={link} />
      ))}
      {pending ? <LinkCardSkeleton key="pending" /> : null}
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
  // 用户消息是一次发完的；机器人消息在文字停下前最后一行不算写完。
  const final = align === "end" || settled === text;
  const split = useMemo(() => splitLinkLines(text, { final }), [text, final]);
  const found = useMemo(() => extractRichContent(settled), [settled]);
  const fromText = useResolvedImages(found.images);
  const images = useMemo(
    () => [...(media?.images ?? []), ...fromText],
    [media?.images, fromText],
  );
  const imageSet = useMemo(() => new Set(found.images.map((i) => i.src)), [found.images]);
  const links = useMemo(
    () => split.links.filter((l) => !imageSet.has(l.url)),
    [split.links, imageSet],
  );
  const files = media?.files ?? [];
  if (
    images.length === 0 &&
    files.length === 0 &&
    links.length === 0 &&
    !split.pending
  )
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
      <LinkPreviewCards links={links} pending={split.pending} />
    </div>
  );
}

/**
 * 给 Markdown 渲染的正文：出了链接卡的那几行拿掉（和 {@link MessageRichPreviews} 用同一套判断，DESIGN.md §48）。
 * 只用于机器人消息；用户自己的消息原样显示。
 */
export function useDisplayText(text: string): string {
  const settled = useSettledText(text);
  return useMemo(
    () => splitLinkLines(text, { final: settled === text }).display,
    [text, settled],
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

/** 机器人的 Markdown 正文（频道聊天用）：出卡的链接行拿掉，内联图片不画。 */
export function RichBotStreamdown({
  text,
  components,
}: {
  text: string;
  components: Record<string, unknown>;
}) {
  const display = useDisplayText(text);
  return (
    <SmoothStreamdown components={components as never}>{display}</SmoothStreamdown>
  );
}

/** Markdown 里的内联图片不在正文里画（避免浏览器直连第三方、也避免和下面的图片卡重复）。 */
export function HiddenMarkdownImage() {
  return null;
}

export { hostOf };
