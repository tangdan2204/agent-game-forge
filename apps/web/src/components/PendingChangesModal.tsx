import type { PendingSliceEntry } from '@ogf/contracts';
import { I } from './icons.js';
import { useDialog } from '../lib/dialog.js';

interface Props {
  pending: PendingSliceEntry[];
  /** Engine kind from the daemon's analysis. Drives engine-specific Codex
   *  wording in the batch-apply prompt. */
  engine?: string;
  onClose: () => void;
  onApplyAll: (prompt: string) => void;
  onClearAll: () => void;
  onDiscardOne: (sidecarPath: string) => void;
}

export function PendingChangesModal(props: Props) {
  const { confirm: askConfirm } = useDialog();
  return (
    <div className="modal-scrim" onClick={props.onClose}>
      <div
        className="modal"
        style={{ height: 'min(680px, 90vh)', width: 'min(820px, 100%)', display: 'grid', gridTemplateRows: '48px 1fr 56px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.scissors}</span>
          <span className="title">待处理切片变更</span>
          <span className="sub">
            已在本地编辑 {props.pending.length} 张图集 · 尚未应用到引擎
          </span>
          <button className="close" onClick={props.onClose}>{I.close}</button>
        </div>

        <div className="pending-list">
          {props.pending.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>
              暂无待处理变更。
            </div>
          )}
          {props.pending.map((p) => (
            <div key={p.sidecarPath} className="pending-row">
              <div className="pending-row-head">
                <code className="pending-source">{p.sourcePath}</code>
                <span className="pill" title="OGF 元数据中的切片配置">
                  {p.cols}×{p.rows} · {p.fps}fps · {p.anchor}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  title="丢弃此变更（删除对应 .ogf-slice.json 侧车文件）"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: '丢弃待处理切片变更？',
                      body: p.sourcePath,
                      danger: true,
                      confirmLabel: '丢弃',
                    });
                    if (ok) props.onDiscardOne(p.sidecarPath);
                  }}
                >
                  {I.close} 丢弃
                </button>
              </div>
              <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: '90px 1fr' }}>
                <dt>帧</dt>
                <dd>
                  {p.frameW ?? '?'} × {p.frameH ?? '?'}
                  {(p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0) && (
                    <>
                      {' · '}内边距 {p.padding}，偏移 ({p.offsetX}, {p.offsetY})
                    </>
                  )}
                </dd>
                <dt>侧车文件</dt>
                <dd style={{ color: 'var(--ink-3)', fontSize: 11 }}>{p.sidecarPath}</dd>
                <dt>引用位置</dt>
                <dd>
                  {p.usages.length === 0 ? (
                    <span style={{ color: 'var(--ink-3)' }}>(未找到引用)</span>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {p.usages.map((u, i) => (
                        <li key={i} style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                          <code style={{ color: 'var(--ink-1)' }}>{u.file}:{u.line}</code>
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>
                            {u.snippet.length > 80 ? u.snippet.slice(0, 80) + '…' : u.snippet}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span className="info">
            <span style={{ color: 'var(--ink-2)' }}>
              通过 Codex 应用：会自动生成覆盖全部条目的提示词并发送给智能体，
              {' '}你只需审核后发送。
            </span>
          </span>
          <span className="grow" />
          <button
            className="btn btn-sm"
            onClick={props.onClearAll}
            disabled={props.pending.length === 0}
            title="丢弃全部待处理变更（删除 .ogf-slice.json 侧车文件，不改动底层 Godot 文件）"
          >
            {I.retry} 全部还原
          </button>
          <button className="btn btn-sm" onClick={props.onClose}>
            取消
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={props.pending.length === 0}
            onClick={() => props.onApplyAll(buildBatchPrompt(props.pending, props.engine))}
          >
            {I.spark} 通过 Codex 全部应用
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildBatchPrompt(
  pending: PendingSliceEntry[],
  engine?: string,
): string {
  // Per-engine update wording. Searching for `frame_cols` in a vanilla JS
  // web project sends Codex on a wild goose chase; web sheets are usually
  // sliced via fields named `cols` / `rows` / `fps` in a JSON catalog or
  // a constant in src/.
  const updateLine =
    engine === 'godot'
      ? '请逐项更新对应 Godot 配置（通常是场景、脚本或 `.tres` 中的 `frame_cols` / `frame_rows` / `animation_fps`），让游戏使用新参数。'
      : engine === 'web'
        ? '请逐项更新 Web 项目配置，让游戏使用新参数。图集切片通常写在 `data/*.json` 或 `src/*.js` 常量中（如 `cols` / `rows` / `fps` / `frameWidth` / `frameHeight` / `anchor` / `offset`），请保持原字段名不要重命名。'
        : '请逐项更新项目配置，让游戏使用新参数。根据下方每张图的引用位置找到切片配置并同步 cols / rows / fps / anchor / offset。';
  const lines: string[] = [
    '# 应用待处理精灵切片变更',
    '',
    `我在 OGF 中本地修改了 ${pending.length} 张精灵图集的切片配置。`,
    updateLine,
    '',
    '请先给出计划（逐条列出将修改的文件和字段），待我确认后再应用。',
    '应用成功后，请删除对应图集的 `.ogf-slice.json` 侧车文件，避免 OGF 继续显示为待处理。',
    '',
    '## 待处理变更',
    '',
  ];

  pending.forEach((p, i) => {
    lines.push(`### ${i + 1}. \`${p.sourcePath}\``);
    lines.push('');
    const detail = `**${p.cols} × ${p.rows}**，${p.fps} fps · 锚点：${p.anchor}`;
    const extra = p.padding > 0 || p.offsetX !== 0 || p.offsetY !== 0
      ? ` · 内边距 ${p.padding}，偏移 (${p.offsetX}, ${p.offsetY})`
      : '';
    lines.push(`目标切片：${detail}${extra}`);
    if (p.frameW && p.frameH) {
      lines.push(`单帧尺寸：${p.frameW} × ${p.frameH}px`);
    }
    lines.push(`应用后需删除的侧车文件：\`${p.sidecarPath}\``);
    if (p.usages.length > 0) {
      lines.push('');
      lines.push('引用位置：');
      for (const u of p.usages) {
        lines.push(`- \`${u.file}:${u.line}\`  ${u.snippet}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}
