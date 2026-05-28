import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Block, ToolFamily, ToolItem } from '../lib/blocks.js';
import { buildTurn, extractFileChanges, extractImageResult, summarizeGroup } from '../lib/blocks.js';
import type { AgentEvent, QuestionFormAnswers } from '@ogf/contracts';
import { I } from './icons.js';
import { QuestionFormCard } from './QuestionFormCard.js';
import { fetchFileContent } from '../lib/api.js';

export type TurnStatus = 'streaming' | 'done' | 'failed' | 'canceled';

export interface TurnProps {
  userText: string;
  events: AgentEvent[];
  status: TurnStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** Per-form id, true once user has submitted (locks the card). */
  submittedForms?: Set<string>;
  /** Submit handler for question-forms emitted by the agent. */
  onSubmitForm?: (answers: QuestionFormAnswers) => void;
  /** Project path — passed through so spec-approval forms can fetch
   *  .ogf/spec.md for inline review. */
  projectPath?: string;
}

export function Turn(props: TurnProps) {
  const built = buildTurn(props.events);
  const elapsed = formatElapsed(
    Math.max(0, (props.endedAt ?? Date.now()) - props.startedAt),
  );

  // Form-submit user messages are ugly walls of '## Form answers (id=...)'
  // markdown when rendered raw. Detect them and render as a compact tool-
  // style pill — the actual prompt sent to Codex is unchanged, just the
  // chat presentation collapses.
  const formSubmit = parseFormSubmitMessage(props.userText);

  return (
    <>
      {formSubmit ? (
        <FormSubmitPill formId={formSubmit.formId} entries={formSubmit.entries} />
      ) : (
        <div className="msg-user">{props.userText}</div>
      )}

      <div className="msg-agent">
        {built.blocks.length === 0 && props.status === 'streaming' && (
          <div className="agent-thinking">
            <span className="dot-pulse" />
            <span>思考中…</span>
          </div>
        )}

        {built.blocks.map((b, i) => (
          <BlockView
            key={i}
            block={b}
            streaming={props.status === 'streaming'}
            submittedForms={props.submittedForms}
            onSubmitForm={props.onSubmitForm}
            projectPath={props.projectPath}
          />
        ))}

        {props.status === 'streaming' && built.blocks.length > 0 && (
          <span className="stream-cursor" />
        )}

        {props.error && (
          <div className="msg-sys err">
            {I.warn} {props.error}
          </div>
        )}

        <TurnFooter
          status={props.status}
          elapsed={elapsed}
          usage={built.footer.usage}
        />
      </div>
    </>
  );
}

function BlockView({
  block,
  streaming,
  submittedForms,
  onSubmitForm,
  projectPath,
}: {
  block: Block;
  streaming: boolean;
  submittedForms?: Set<string>;
  onSubmitForm?: (answers: QuestionFormAnswers) => void;
  projectPath?: string;
}) {
  if (block.kind === 'form') {
    const locked = submittedForms?.has(block.form.id) ?? false;
    return (
      <QuestionFormCard
        form={block.form}
        locked={locked}
        onSubmit={onSubmitForm}
        projectPath={projectPath}
        // Demo-friendly fallback: if the user doesn't engage within
        // 5 minutes, auto-submit with the defaults so the agent isn't
        // stuck waiting. 30s was too aggressive — users actually
        // reading a spec ran out of time before they could pick.
        // QuestionFormCard cancels the timer on any interaction and
        // skips when required fields would still be empty.
        autoSubmitSeconds={locked ? undefined : 300}
      />
    );
  }
  if (block.kind === 'text') {
    return (
      <div className="md-block">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // External links open in new tab; in-product links could later resolve to files
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            // Single-line `code` stays inline; fenced blocks become a styled pre
            code: ({ className, children, ...rest }) => {
              const isBlock = !!className;
              if (isBlock) {
                return (
                  <pre className="md-pre">
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                );
              }
              return <code {...rest}>{children}</code>;
            },
          }}
        >
          {block.text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <ToolGroup
      family={block.family}
      items={block.items}
      streaming={streaming}
      projectPath={projectPath}
    />
  );
}

function ToolGroup({
  family,
  items,
  streaming,
  projectPath,
}: {
  family: ToolFamily;
  items: ToolItem[];
  streaming: boolean;
  projectPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const isRunning = streaming && items.some((it) => it.output === undefined);
  const summary = summarizeGroup({ family, items });
  const ico = familyIconClass(family);
  const icoEl = familyIconEl(family);

  return (
    <div className="tool-card" data-open={open} data-running={isRunning ? 'true' : 'false'}>
      <div className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className={`ico ${ico}`}>{icoEl}</span>
        <span className="name">{toolHeadName(family, items)}</span>
        <span className="arg">{summary}</span>
        <span className="dur">
          {isRunning ? <span style={{ color: 'var(--accent)' }}>运行中…</span> : `${items.length} 项`}
        </span>
        <span className="twirl">{I.caretRight}</span>
      </div>
      {/* Body has a hard max-height + scroll. Long bash outputs and big
       *  edit JSON dumps used to balloon the chat to thousands of
       *  pixels when expanded — now they cap at a reasonable size and
       *  the user scrolls within the card. */}
      <div className="tool-body">
        <div className="tool-body-scroll">
          {items.map((it) => (
            <ToolDetail key={it.id} item={it} projectPath={projectPath} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageGenDetail({ item, projectPath }: { item: ToolItem; projectPath?: string }) {
  const prompt = String((item.input as { prompt?: unknown })?.prompt ?? '');
  const size = String((item.input as { size?: unknown })?.size ?? '');
  const result = extractImageResult(item);
  const isRunning = item.output === undefined;
  const hasAnyResult = !!result.inlineBase64 || result.paths.length > 0;

  return (
    <div>
      {prompt && (
        <>
          <span className="label">提示词</span>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{prompt}</pre>
        </>
      )}
      {size && (
        <>
          <span className="label">尺寸</span>
          <pre>{size}</pre>
        </>
      )}
      {isRunning && (
        <div className="image-gen-pending">
          <span className="dot-pulse" /> 生成中…
        </div>
      )}
      {!isRunning && !hasAnyResult && item.output && (
        <>
          <span className="label">输出</span>
          <pre>{item.output.length > 500 ? item.output.slice(0, 500) + '…' : item.output}</pre>
        </>
      )}
      {hasAnyResult && (
        <>
          <span className="label">
            结果{(result.paths.length || 0) + (result.inlineBase64 ? 1 : 0) > 1 ? '（多项）' : ''}
          </span>
          <div className="image-gen-grid">
            {result.inlineBase64 && (
              <figure className="image-gen-card">
                <img
                  src={`data:image/png;base64,${result.inlineBase64}`}
                  alt="generated"
                />
                <figcaption title="来自 Codex CLI 的内联 base64">内联</figcaption>
              </figure>
            )}
            {result.paths.map((p, i) => (
              <ImagePreview key={p + i} path={p} projectPath={projectPath} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ImagePreview({ path, projectPath }: { path: string; projectPath?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  // Daemon emits absolute paths sometimes (when image_gen writes outside
  // cwd) and project-relative when it writes under the workspace.
  // fetchFileContent only accepts project-relative paths, so we strip
  // the project prefix when present, otherwise we try the path verbatim.
  const relPath = (() => {
    const norm = path.replace(/\\/g, '/');
    if (!projectPath) return norm;
    const proj = projectPath.replace(/\\/g, '/');
    if (norm.toLowerCase().startsWith(proj.toLowerCase() + '/')) {
      return norm.slice(proj.length + 1);
    }
    return norm;
  })();

  useEffect(() => {
    if (!projectPath || tried.current) return;
    tried.current = true;
    fetchFileContent(projectPath, relPath)
      .then((r) => {
        if (r.kind === 'image' && r.base64) {
          const ext = relPath.split('.').pop()?.toLowerCase() ?? 'png';
          const mime =
            ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : ext === 'gif'
                ? 'image/gif'
                : ext === 'webp'
                  ? 'image/webp'
                  : 'image/png';
          setSrc(`data:${mime};base64,${r.base64}`);
        } else {
          setError('不是图片');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectPath, relPath]);

  return (
    <figure className="image-gen-card">
      {src ? (
        <img src={src} alt={path} />
      ) : error ? (
        <div className="image-gen-err">⚠ {error}</div>
      ) : (
        <div className="image-gen-loading">加载中…</div>
      )}
      <figcaption title={path}>{shortPath(path)}</figcaption>
    </figure>
  );
}

function ToolDetail({ item, projectPath }: { item: ToolItem; projectPath?: string }) {
  if (item.family === 'image') {
    return <ImageGenDetail item={item} projectPath={projectPath} />;
  }

  if (item.family === 'edit') {
    const changes = extractFileChanges(item);
    return (
      <div>
        <span className="label">文件</span>
        {changes.length > 0 ? (
          <ul className="file-list">
            {changes.map((c, i) => (
              <li key={i} className={`file-row file-${c.kind}`}>
                <span className="file-kind">{kindLabel(c.kind)}</span>
                <code title={c.path}>{shortPath(c.path)}</code>
              </li>
            ))}
          </ul>
        ) : (
          <pre>（未记录到变更）</pre>
        )}
      </div>
    );
  }

  if (item.family === 'shell') {
    const command = String((item.input as { command?: unknown })?.command ?? '');
    return (
      <div>
        <span className="label">命令</span>
        <pre>{command}</pre>
        {item.output !== undefined && (
          <>
            <span className="label">{item.isError ? '错误' : '输出'}</span>
            <pre className={item.isError ? 'err' : ''}>{item.output || '（空）'}</pre>
          </>
        )}
      </div>
    );
  }

  if (item.family === 'thinking') {
    const text = String((item.input as { text?: unknown })?.text ?? '');
    return (
      <div>
        <pre style={{ fontStyle: 'italic', opacity: 0.85 }}>{text}</pre>
      </div>
    );
  }

  return (
    <div>
      <pre>{JSON.stringify(item.input, null, 2)}</pre>
      {item.output !== undefined && (
        <pre className={item.isError ? 'err' : ''}>{item.output}</pre>
      )}
    </div>
  );
}

function TurnFooter(props: {
  status: TurnStatus;
  elapsed: string;
  usage?: { input?: number; output?: number; cachedRead?: number };
}) {
  const labelMap: Record<TurnStatus, string> = {
    streaming: '执行中…',
    done: '完成',
    failed: '失败',
    canceled: '已停止',
  };
  const dotClass = props.status === 'streaming' ? 'dot-pulse' : `dot-${props.status}`;

  return (
    <div className="turn-footer">
      <span className={dotClass} />
      <span className="turn-state">{labelMap[props.status]}</span>
      <span className="turn-sep">·</span>
      <span>{props.elapsed}</span>
      {props.usage && (
        <>
          <span className="turn-sep">·</span>
          <span title={`缓存命中 ${props.usage.cachedRead ?? 0}`}>
            输入 {(props.usage.input ?? 0).toLocaleString()} / 输出 {(props.usage.output ?? 0).toLocaleString()}
          </span>
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function familyIconClass(f: ToolFamily): string {
  if (f === 'edit') return 'edit';
  if (f === 'shell') return 'bash';
  if (f === 'thinking') return 'view';
  if (f === 'image') return 'gen';
  return 'gen';
}

function familyIconEl(f: ToolFamily) {
  if (f === 'edit') return I.edit;
  if (f === 'shell') return I.bash;
  if (f === 'thinking') return I.spark;
  if (f === 'image') return I.image;
  return I.image;
}

function toolHeadName(f: ToolFamily, items: ToolItem[]): string {
  if (f === 'edit') return '文件编辑';
  if (f === 'shell') return '命令行';
  if (f === 'thinking') return '思考';
  if (f === 'image') return '图片生成';
  if (items.length > 0) return items[0].name.toLowerCase();
  return '工具';
}

function kindLabel(kind: string): string {
  if (kind === 'add') return '新增';
  if (kind === 'delete') return '删除';
  return '修改';
}

function shortPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

/** Parse a form-submit user message back into structured fields.
 *  App.tsx#onSubmitForm formats every form submit as:
 *    ## Form answers (id=<formId>)
 *
 *    - **<key>**: <value>
 *    - ...
 *  We reverse that here so the chat renders a compact pill instead of
 *  showing the raw markdown wall to the user. Codex still sees the
 *  original markdown — only the in-chat presentation changes. */
function parseFormSubmitMessage(
  userText: string,
): { formId: string; entries: { key: string; value: string }[] } | null {
  const m = /^## Form answers \(id=([^)]+)\)\s*\n\n([\s\S]+)$/.exec(userText);
  if (!m) return null;
  const [, formId, body] = m;
  const entries: { key: string; value: string }[] = [];
  for (const line of body.split('\n')) {
    const lm = /^- \*\*([^*]+)\*\*:\s*(.*)$/.exec(line.trim());
    if (lm) entries.push({ key: lm[1].trim(), value: lm[2].trim() });
  }
  return { formId, entries };
}

function FormSubmitPill({
  formId,
  entries,
}: {
  formId: string;
  entries: { key: string; value: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="form-submit-pill" data-open={open}>
      <button
        type="button"
        className="form-submit-head"
        onClick={() => setOpen((v) => !v)}
        title="展开/收起答案"
      >
        <span className="form-submit-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="form-submit-icon" aria-hidden>↩</span>
        <span className="form-submit-label">已提交</span>
        <code className="form-submit-id">{formId}</code>
        <span className="form-submit-count">
          {entries.length} 个字段
        </span>
      </button>
      {open && (
        <ul className="form-submit-body">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="form-submit-key">{e.key}</span>
              <span className="form-submit-value">{e.value || '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}m ${sec}s`;
}
