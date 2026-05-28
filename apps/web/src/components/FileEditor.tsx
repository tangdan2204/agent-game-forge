import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { UsagesResponse } from '@ogf/contracts';
import {
  applyPack as apiApplyPack,
  applyRegen,
  discardPack as apiDiscardPack,
  discardRegen,
  fetchFileContent,
  fetchRegenStaging,
  fetchUsages,
  writeFileContent,
} from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';
import {
  RegenerateOptionsModal,
  type RegenerateOptions,
  type PackContext,
} from './RegenerateOptionsModal.js';
import { SpriteSlicerModal, type SliceMetadata } from './SpriteSlicerModal.js';
import { TableEditor } from './TableEditor.js';

interface Props {
  projectPath: string;
  relPath: string;
  /** Engine kind from the daemon's analysis. Drives engine-specific Codex
   *  prompts (e.g. 'apply slicing' wording differs for godot vs web). */
  engine?: string;
  fileKind?: 'text' | 'image' | 'binary';
  recentlyChanged?: boolean;
  onClose?: () => void;
  /** Click on a usage hit → open that file at that line. */
  onJumpTo?: (relPath: string, line: number) => void;
  /** Ask Codex via the agent pane. */
  onAskCodex?: (prompt: string) => void;
  /** Notify parent that slicing metadata changed (so it can refresh "pending" panel). */
  onSlicingSaved?: () => void;
  /** Counter that bumps when sidecar metadata changes elsewhere — triggers re-fetch. */
  metadataRev?: number;
  /** Open the global PackReviewModal (multi-pack browser). FileEditor
   *  only handles "the pack this file belongs to"; the modal is for
   *  switching between packs and seeing the layout diff table. */
  onOpenPackReview?: () => void;
  /** Called after a pack apply/discard so App can refresh pendingPacks
   *  state + re-poll the file tree. */
  onPackResolved?: () => void;
}

interface PipelineMeta {
  cols?: number;
  rows?: number;
  cell_size?: number;
  fit_scale?: number;
  align?: string;
  duration?: number;
  trim_border?: number;
  prompt?: string;
  target?: string;
  mode?: string;
  frame_labels?: string[];
}

export function FileEditor(props: Props) {
  const { confirm, notify } = useDialog();
  const [content, setContent] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [size, setSize] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [kind, setKind] = useState<'text' | 'image' | 'binary'>('text');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLoadedRef = useRef<string>('');

  // Image-specific
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [slice, setSlice] = useState<SliceMetadata | null>(null);
  const [pipelineMeta, setPipelineMeta] = useState<PipelineMeta | null>(null);
  const [sliceSource, setSliceSource] = useState<'ogf-slice' | 'pipeline-meta' | 'none'>('none');
  const [showSlicer, setShowSlicer] = useState(false);
  const [showRegenOpts, setShowRegenOpts] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [usages, setUsages] = useState<UsagesResponse['hits'] | null>(null);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [jsonView, setJsonView] = useState<'auto' | 'text' | 'table'>('auto');

  // Regen staging — populated when .ogf/regen/<relPath> exists. The
  // 'Regenerate' button instructs Codex to write there instead of
  // overwriting; this state drives the side-by-side comparison panel.
  const [regenBase64, setRegenBase64] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<'apply' | 'discard' | null>(null);
  const [regenNaturalW, setRegenNaturalW] = useState(0);
  const [regenNaturalH, setRegenNaturalH] = useState(0);
  // True iff this file lives in a directory that has a staged
  // pipeline-meta.json — i.e. it's part of a pending animation PACK,
  // not a one-off single-file regen. When true we suppress the
  // FileEditor's per-file diff banner so the user goes through the
  // pack review flow (chip → PackReviewModal) instead. Otherwise the
  // user clicks 'Use new' here and only sheet.png swaps while the
  // other 10 staged files sit orphaned in .ogf/regen/.
  const [inPendingPack, setInPendingPack] = useState(false);

  const segments = props.relPath.split('/').filter(Boolean);
  const dir = segments.slice(0, -1).join('/');

  // Is this file a JSON that's likely table-shaped (array-of-objects somewhere)?
  const jsonHasTable = useMemo(() => {
    if (!props.relPath.toLowerCase().endsWith('.json') || content === null) return false;
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data) && data.length > 0 && data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return true;
      }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return Object.values(data as Record<string, unknown>).some(
          (v) => Array.isArray(v) && v.length > 0 && (v as unknown[]).every((x) => x && typeof x === 'object' && !Array.isArray(x)),
        );
      }
    } catch {
      // ignore
    }
    return false;
  }, [content, props.relPath]);

  const showAsTable = jsonHasTable && (jsonView === 'auto' || jsonView === 'table');

  // Initial file fetch
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDirty(false);
    setContent(null);
    setBase64(null);
    setNaturalW(0);
    setNaturalH(0);
    setSlice(null);
    setPipelineMeta(null);
    setSliceSource('none');
    setUsages(null);
    setRegenBase64(null);
    setRegenBusy(null);
    setRegenNaturalW(0);
    setRegenNaturalH(0);
    setInPendingPack(false);

    fetchFileContent(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setKind(r.kind);
        setSize(r.size);
        setTruncated(!!r.truncated);
        if (r.kind === 'text') {
          const c = r.content ?? '';
          setContent(c);
          lastLoadedRef.current = c;
        } else if (r.kind === 'image') {
          setBase64(r.base64 ?? '');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath]);

  // For images: load slicing metadata + sibling pipeline-meta.json + usages.
  // Re-runs when metadataRev bumps (revert / discard / save).
  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;

    // Reset so a stale sidecar value doesn't linger after revert.
    setSlice(null);
    setPipelineMeta(null);
    setSliceSource('none');

    // 1. Try .ogf-slice.json sidecar (our format)
    const sidecar = props.relPath.replace(/\.(png|jpg|jpeg|gif|webp|bmp)$/i, '.ogf-slice.json');
    let sidecarFound = false;
    fetchFileContent(props.projectPath, sidecar)
      .then((r) => {
        if (cancelled) return;
        if (r.kind === 'text' && r.content) {
          try {
            const parsed = JSON.parse(r.content) as SliceMetadata;
            setSlice(parsed);
            setSliceSource('ogf-slice');
            sidecarFound = true;
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});

    // 2. Try pipeline-meta.json sibling (sprite_maker convention)
    const pipelinePath = dir ? `${dir}/pipeline-meta.json` : 'pipeline-meta.json';
    fetchFileContent(props.projectPath, pipelinePath)
      .then((r) => {
        if (cancelled) return;
        if (r.kind === 'text' && r.content) {
          try {
            const parsed = JSON.parse(r.content) as PipelineMeta;
            setPipelineMeta(parsed);
            // Fall back to pipeline meta only if no sidecar was found.
            if (!sidecarFound &&
                typeof parsed.cols === 'number' &&
                typeof parsed.rows === 'number') {
              setSlice({
                cols: parsed.cols,
                rows: parsed.rows,
                padding: 0,
                offsetX: 0,
                offsetY: 0,
                anchor: (parsed.align as SliceMetadata['anchor']) || 'center',
                fps: parsed.duration ? Math.round(1000 / parsed.duration) : 8,
                source: props.relPath,
              });
              setSliceSource('pipeline-meta');
            }
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});

    // 3. Fetch usages
    setUsagesLoading(true);
    fetchUsages(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setUsages(r.hits);
      })
      .catch(() => setUsages([]))
      .finally(() => {
        if (!cancelled) setUsagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, props.projectPath, props.relPath, dir, props.metadataRev]);

  // Probe for a staged regenerate at .ogf/regen/<relPath>. The
  // 'Regenerate' button writes there (instead of overwriting); when the
  // staging file exists we surface a side-by-side comparison panel.
  // Refetched on every relPath change AND every metadataRev bump
  // (which the parent advances after the agent finishes a turn — so a
  // fresh regen completed during a chat run shows up immediately).
  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;
    // Probe BOTH the per-file staging AND the pack-meta marker in the
    // same parent dir. If both staging and meta exist, this is a pack
    // — set inPendingPack=true so the JSX hides the single-file banner.
    const dir = props.relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const metaRel = dir ? `${dir}/pipeline-meta.json` : 'pipeline-meta.json';
    Promise.all([
      fetchRegenStaging(props.projectPath, props.relPath),
      fetchRegenStaging(props.projectPath, metaRel),
    ])
      .then(([selfR, metaR]) => {
        if (cancelled) return;
        const isPack = selfR.exists && metaR.exists;
        setInPendingPack(isPack);
        // KEEP regenBase64 set even in pack mode — the canvas uses it
        // for the Original vs New diff. The actionbar above the canvas
        // chooses the right action set (per-file Use new / Keep original
        // OR per-pack Apply pack / Discard pack / Review).
        if (selfR.exists && selfR.base64) setRegenBase64(selfR.base64);
        else setRegenBase64(null);
      })
      .catch(() => {
        if (!cancelled) {
          setRegenBase64(null);
          setInPendingPack(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, props.projectPath, props.relPath, props.metadataRev]);

  async function applyRegenChange() {
    setRegenBusy('apply');
    try {
      await applyRegen(props.projectPath, props.relPath);
      setRegenBase64(null);
      // Bump our base64 by re-fetching the file so the inspector reloads
      // the now-applied bytes (the file content endpoint returns cached
      // bytes only on URL change; we trigger a fresh load via state reset).
      setBase64(null);
      const r = await fetchFileContent(props.projectPath, props.relPath);
      if (r.kind === 'image') setBase64(r.base64 ?? '');
      props.onSlicingSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  async function discardRegenChange() {
    setRegenBusy('discard');
    try {
      await discardRegen(props.projectPath, props.relPath);
      setRegenBase64(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  /** Apply the pack this file belongs to. Calls the same /apply-pack
   *  endpoint the modal uses, with a confirm prompt — this is a
   *  multi-file destructive op (replaces ~10 live files atomically). */
  async function applyPackFromHere() {
    const packDir = props.relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!packDir) return;
    const ok = await confirm({
      title: '应用动画包？',
      body: `将 ${packDir}/ 下全部文件替换为暂存版本。该实体的其他动作不会受影响。`,
      confirmLabel: '应用动画包',
    });
    if (!ok) return;
    setRegenBusy('apply');
    try {
      const r = await apiApplyPack({ projectPath: props.projectPath, packDir });
      if (r.failed.length > 0) {
        notify({
          kind: 'warn',
          title: '部分文件处理失败',
          body: r.failed.slice(0, 5).map((f) => `${f.relPath}: ${f.err}`).join('\n'),
        });
      }
      // Refresh local state — the file we're viewing now has fresh bytes.
      setRegenBase64(null);
      setInPendingPack(false);
      setBase64(null);
      const fresh = await fetchFileContent(props.projectPath, props.relPath);
      if (fresh.kind === 'image') setBase64(fresh.base64 ?? '');
      props.onPackResolved?.();
      props.onSlicingSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  async function discardPackFromHere() {
    const packDir = props.relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (!packDir) return;
    const ok = await confirm({
      title: '丢弃动画包？',
      body: `将删除 .ogf/regen/${packDir}/ 下的暂存文件。线上目录不会被修改。`,
      confirmLabel: '丢弃',
      danger: true,
    });
    if (!ok) return;
    setRegenBusy('discard');
    try {
      await apiDiscardPack({ projectPath: props.projectPath, packDir });
      setRegenBase64(null);
      setInPendingPack(false);
      props.onPackResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  async function save() {
    if (kind !== 'text' || content === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFileContent({
        projectPath: props.projectPath,
        relPath: props.relPath,
        content,
      });
      lastLoadedRef.current = content;
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && kind === 'text') {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, saving, kind]);

  function askCodexToApplySlicing(m: SliceMetadata) {
    if (!props.onAskCodex) return;
    const usagesText =
      usages && usages.length > 0
        ? '\n\nThis sheet is referenced in:\n' +
          usages.map((u) => `- ${u.file}:${u.line}  ${u.snippet}`).join('\n')
        : '';
    // Engine-aware update instruction. Each engine stores frame metadata
    // differently and lives in different files — the wrong wording sends
    // Codex looking for keys that don't exist (e.g. searching for
    // 'frame_cols' in a vanilla JS web project).
    const updateInstruction =
      props.engine === 'godot'
        ? 'Please update the relevant Godot config so the game uses these values. Look for `frame_cols`, `frame_rows`, and `animation_fps` keys (or equivalent) in the .tscn / .tres / .gd files wherever this sheet is loaded, and update them.'
        : props.engine === 'web'
          ? "Please update the web project so the game uses these values. The sheet is sliced in JS — look at the references below (typically a Sprite/Animation entry in `data/*.json` or a constant in `src/*.js`) and update fields like `cols` / `rows` / `fps` / `frameWidth` / `frameHeight` / `anchor` / `offset` (whatever names the project actually uses; preserve them — don't rename)."
          : 'Please update the project so the game uses these values. Look at the references below to find where this sheet is loaded and update the slicing metadata (cols / rows / fps / anchor / offset).';
    const prompt = `The sprite sheet \`${props.relPath}\` should be sliced as **${m.cols}×${m.rows}** at ${m.fps} fps (anchor: ${m.anchor}, padding ${m.padding}, offset (${m.offsetX}, ${m.offsetY})).

${updateInstruction}${usagesText}

Show me the diff before applying.`;
    props.onAskCodex(prompt);
  }

  function openRegenerateOptions() {
    if (!props.onAskCodex) return;
    setShowRegenOpts(true);
  }

  function submitRegenerate(
    opts: RegenerateOptions,
    references: string[],
    packCtx: PackContext,
  ) {
    setShowRegenOpts(false);
    if (!props.onAskCodex) return;

    const lines: string[] = [];

    if (packCtx.isPack && packCtx.packDir) {
      // ─── Animation-pack regenerate ─────────────────────────────────
      const packDir = packCtx.packDir;
      const stagingDir = `.ogf/regen/${packDir}`;
      const segs = packDir.split('/');
      const action = segs[segs.length - 1];
      const entity = segs[segs.length - 2];

      lines.push(
        `Regenerate the animation pack for **${entity} / ${action}** at \`${packDir}/\` via the \`generate2dsprite\` skill.`,
      );
      lines.push('');
      lines.push(
        `Stage the ENTIRE pack (sheet.png + individual frames + pipeline-meta.json + intermediates + animation.gif) to \`${stagingDir}/\` — DON'T overwrite the live folder. The user reviews + applies the swap atomically.`,
      );
      lines.push('');
      lines.push(
        `Pass \`--output-dir ${stagingDir}\` to the skill so it writes the full file set there in one call.`,
      );
    } else {
      // ─── Single-file regen (legacy path: file isn't part of a pack) ──
      const regenPath = `.ogf/regen/${props.relPath.replace(/\\/g, '/')}`;
      lines.push(
        `Remake the sprite at \`${props.relPath}\` via \`generate2dsprite\`. Write the new sheet to STAGING at \`${regenPath}\` — DON'T overwrite the original. The user reviews + applies the swap.`,
      );
    }

    lines.push('');
    if (opts.hint) {
      lines.push(`**What should change:** ${opts.hint}`);
    } else {
      lines.push('**What should change:** fresh take with the same intent — same character, refreshed.');
    }

    // Consistency is the only HARD rule. Everything else is the agent's call.
    lines.push('');
    lines.push('## Visual consistency (the only hard rule)');
    lines.push(
      'This must read as the SAME character as the existing sprites — silhouette, palette, face/eye features, costume marks, accessories, body proportions all preserved. Only the action changes.',
    );
    lines.push('');
    lines.push('Before generating, do this in order:');
    lines.push('1. `view_image .ogf/style-anchor.png` (if it exists)');
    if (opts.matchSiblingStyle && references.length > 0) {
      const refLabel = packCtx.isPack
        ? 'These are OTHER actions (sibling animation packs) of the same entity:'
        : 'These are OTHER images in the same folder:';
      lines.push(`2. \`view_image\` each of these reference sprites. ${refLabel}`);
      for (const r of references) {
        lines.push(`   - \`${r}\``);
      }
    } else if (opts.matchSiblingStyle) {
      lines.push(
        '2. (No sibling references found — generate from style-anchor only.)',
      );
    }
    lines.push(
      "3. In the `generate2dsprite` call, use the \"Same character, new animation\" reference role from conventions (`reference: 'generated_image'` after view_image).",
    );

    // Mode-specific guidance.
    lines.push('');
    if (opts.mode === 'auto') {
      lines.push('## Layout & dimensions — your call');
      lines.push(
        "Pick whatever frame count, grid (cols × rows), fps, and pixel dimensions make this action read best. Don't try to match the original layout if a different one fits better — an attack swing often wants more frames or wider cells than idle. Don't force a square aspect on a non-square action; that squashes the sprite. Trust your judgment.",
      );
    } else {
      lines.push('## Layout & dimensions (user-specified)');
      lines.push(`- Frames: **${opts.frames}** in a **${opts.cols}×${opts.rows}** grid`);
      lines.push(`- FPS: **${opts.fps}**`);
      if (opts.aspectRatio === 'same' && naturalW > 0 && naturalH > 0) {
        lines.push(`- Aspect ratio: keep close to current (${naturalW}:${naturalH}). Pixel size can change.`);
      } else if (opts.aspectRatio === 'free') {
        lines.push('- Aspect ratio: free.');
      } else {
        lines.push(`- Aspect ratio: ${opts.aspectRatio} per cell.`);
      }
      lines.push(
        "If the chosen layout would force squashing the character (e.g. forcing 1:1 cells when the action is wider), say so and ask before generating — don't squash silently.",
      );
    }

    // Reporting — keep it short. Don't pre-edit code.
    lines.push('');
    lines.push('## When done');
    if (packCtx.isPack && packCtx.packDir) {
      lines.push(
        `- Confirm the staging dir contains the full pack: \`${`.ogf/regen/${packCtx.packDir}`}/\`.`,
      );
      lines.push(
        '- The pipeline-meta.json the skill writes will record the actual layout (cols / rows / fps / cell_size). The user-facing review UI reads it directly — no need to repeat it in chat.',
      );
      lines.push(
        '- DO NOT touch the live folder, data files, or source code. Patching catalog/code happens in a follow-up turn AFTER the user applies the swap (OGF will prompt you with the layout diff).',
      );
    } else {
      lines.push(
        `- Confirm the staging file path.`,
      );
      lines.push('- Report the actual layout used: frames, grid (cols × rows), fps, frame dimensions.');
      if (slice) {
        lines.push(
          `- If your layout differs from the existing slicing (${slice.cols}×${slice.rows} @ ${slice.fps}fps), say so. The user will apply the swap first; ONLY THEN, in a follow-up turn, update slicing config in code/data. DO NOT pre-edit code now.`,
        );
      } else {
        lines.push('- DO NOT edit other files. Just write the staged sprite.');
      }
    }
    lines.push('- Stay focused. Regenerate touches the staging dir/file only.');

    props.onAskCodex(lines.join('\n'));
  }

  const isImage = kind === 'image' && base64;
  const ext = props.relPath.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const imageUrl = isImage ? `data:${mime};base64,${base64}` : null;

  return (
    <div className="inspector">
      <div className="crumbs">
        {segments.slice(0, -1).map((s, i) => (
          <span key={i}>
            <span>{s}</span>
            <span className="sep">/</span>
          </span>
        ))}
        <span className="last">{segments[segments.length - 1] ?? props.relPath}</span>
        <span className="badge-dim">
          {isImage && naturalW > 0 ? `${naturalW}×${naturalH}` : formatSize(size)} · {kind === 'text' ? '文本' : kind === 'image' ? '图片' : '二进制'}
        </span>
        {dirty && (
          <span className="badge-dim" style={{ color: 'var(--accent)', borderColor: 'var(--accent-line)' }}>
            ● 未保存
          </span>
        )}
        <span className="actions">
          {kind === 'text' && jsonHasTable && (
            <span className="view-toggle" style={{ marginRight: 6 }}>
              <button
                className={`view-toggle-btn ${showAsTable ? 'active' : ''}`}
                onClick={() => setJsonView('table')}
                title="按表格编辑"
              >
                表格
              </button>
              <button
                className={`view-toggle-btn ${!showAsTable ? 'active' : ''}`}
                onClick={() => setJsonView('text')}
                title="按原始 JSON 编辑"
              >
                文本
              </button>
            </span>
          )}
          {kind === 'text' && (
            <button
              className={`btn btn-sm ${dirty ? 'btn-primary' : ''}`}
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          )}
          {isImage && props.onAskCodex && (
            <button
              className="btn btn-sm"
              onClick={openRegenerateOptions}
              title="重生成此精灵，可设置帧数/网格/长宽比/说明"
            >
              {I.refresh} 重生成
            </button>
          )}
          {isImage && (
            <button className="btn btn-sm" onClick={() => setShowSlicer(true)}>
              {I.scissors} {slice ? '编辑切片' : '定义切片'}
            </button>
          )}
          {props.onClose && (
            <button className="btn btn-sm btn-ghost" onClick={props.onClose} title="关闭">
              {I.close}
            </button>
          )}
        </span>
      </div>

      {props.recentlyChanged && (
        <div className="diff-banner" style={{ position: 'static', margin: '12px 14px 0' }}>
          <span className="dot" />
          <span className="text">
            <b>Codex</b> 刚刚重生成了这个文件 <span className="when">刚刚</span>
          </span>
          <span className="actions">
            <button>查看差异</button>
            <button className="primary">保留</button>
          </span>
        </div>
      )}

      {error && <div className="msg-sys err" style={{ margin: 12, alignSelf: 'flex-start' }}>{I.warn} {error}</div>}
      {truncated && <div className="msg-sys" style={{ margin: 12, alignSelf: 'flex-start' }}>{I.warn} 文件过大（{formatSize(size)}）</div>}

      {kind === 'text' && content !== null && showAsTable && (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TableEditor
            content={content}
            projectPath={props.projectPath}
            relPath={props.relPath}
            onContentChange={(next) => {
              setContent(next);
              setDirty(next !== lastLoadedRef.current);
            }}
          />
        </div>
      )}

      {kind === 'text' && content !== null && !showAsTable && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            language={languageOf(props.relPath)}
            value={content}
            onChange={(v) => {
              const next = v ?? '';
              setContent(next);
              setDirty(next !== lastLoadedRef.current);
            }}
            options={{
              fontSize: 12.5,
              fontFamily: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              tabSize: 2,
              renderWhitespace: 'selection',
              automaticLayout: true,
            }}
          />
        </div>
      )}

      {isImage && imageUrl && inPendingPack && (
        <div className="pack-actionbar">
          <span className="pack-actionbar-icon">{I.refresh}</span>
          <div className="pack-actionbar-text">
            <strong>待处理动画包</strong>
            <span className="muted">
              请先对比下方原图与新图。点击应用后会原子替换
              <code>{props.relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')}/</code> 下全部文件。
            </span>
          </div>
          <button
            className="btn btn-sm"
            onClick={discardPackFromHere}
            disabled={regenBusy !== null}
          >
            {regenBusy === 'discard' ? '丢弃中…' : '丢弃动画包'}
          </button>
          {props.onOpenPackReview && (
            <button
              className="btn btn-sm"
              onClick={props.onOpenPackReview}
              title="打开完整动画包审查（布局差异、多包切换）"
            >
              查看详情
            </button>
          )}
          <button
            className="btn btn-sm btn-primary"
            onClick={applyPackFromHere}
            disabled={regenBusy !== null}
          >
            {regenBusy === 'apply' ? '应用中…' : '应用动画包'}
          </button>
        </div>
      )}

      {isImage && imageUrl && regenBase64 && !inPendingPack && (
        <div className="regen-actionbar">
          <span className="regen-banner-icon">{I.refresh}</span>
          <span>待处理重生成结果，请先审核再应用</span>
          <span className="regen-banner-spacer" />
          <button
            className="btn btn-sm btn-primary"
            onClick={() => void applyRegenChange()}
            disabled={regenBusy !== null}
            title="用新图替换原图"
          >
            {regenBusy === 'apply' ? '应用中…' : '使用新图'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void discardRegenChange()}
            disabled={regenBusy !== null}
            title="丢弃重生成图片，保留原图"
          >
            {regenBusy === 'discard' ? '丢弃中…' : '保留原图'}
          </button>
        </div>
      )}

      {isImage && imageUrl && (
        <div className="inspector-body" style={{ flex: 1, minHeight: 0 }}>
          <div className="canvas-area" style={{ position: 'relative' }}>
            {regenBase64 ? (
              <div className="regen-compare">
                <figure className="regen-side">
                  <figcaption>原图</figcaption>
                  <img
                    src={imageUrl}
                    alt="original"
                    onLoad={(e) => {
                      setNaturalW(e.currentTarget.naturalWidth);
                      setNaturalH(e.currentTarget.naturalHeight);
                    }}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {slice && naturalW > 0 && (
                    <div className="regen-anim">
                      <SpritePreview
                        imageUrl={imageUrl}
                        natW={naturalW}
                        natH={naturalH}
                        slice={slice}
                      />
                    </div>
                  )}
                </figure>
                <figure className="regen-side regen-side-new">
                  <figcaption>新图</figcaption>
                  <img
                    src={`data:${mime};base64,${regenBase64}`}
                    alt="regenerated"
                    onLoad={(e) => {
                      setRegenNaturalW(e.currentTarget.naturalWidth);
                      setRegenNaturalH(e.currentTarget.naturalHeight);
                    }}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {slice && regenNaturalW > 0 && (
                    <div className="regen-anim">
                      <SpritePreview
                        imageUrl={`data:${mime};base64,${regenBase64}`}
                        natW={regenNaturalW}
                        natH={regenNaturalH}
                        slice={slice}
                      />
                    </div>
                  )}
                </figure>
              </div>
            ) : (
              <img
                src={imageUrl}
                alt={props.relPath}
                onLoad={(e) => {
                  setNaturalW(e.currentTarget.naturalWidth);
                  setNaturalH(e.currentTarget.naturalHeight);
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  imageRendering: 'pixelated',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
              />
            )}

            {!regenBase64 && (
              <div className="canvas-toolbar">
                <button className="ico" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="缩小">{I.zoomOut}</button>
                <span className="zoom-val">{Math.round(zoom * 100)}%</span>
                <button className="ico" onClick={() => setZoom((z) => Math.min(6, z + 0.25))} title="放大">{I.zoomIn}</button>
              </div>
            )}
          </div>

          <div className="meta-rail">
            <div className="meta-section">
              <h4>文件 <span className="pill">{ext.toUpperCase()}</span></h4>
              <dl className="kv">
                <dt>路径</dt><dd style={{ wordBreak: 'break-all' }}>{props.relPath}</dd>
                <dt>尺寸</dt><dd>{naturalW} × {naturalH}</dd>
                <dt>大小</dt><dd>{formatSize(size)}</dd>
              </dl>
            </div>

            <div className="meta-section">
              <h4>
                切片
                {slice && (
                  <span className="pill" title={`来源: ${sliceSource}`}>
                    {sliceSource === 'pipeline-meta' ? 'pipeline-meta' : sliceSource === 'ogf-slice' ? 'ogf-slice' : '推断'}
                  </span>
                )}
              </h4>
              {slice ? (
                <dl className="kv">
                  <dt>网格</dt><dd>{slice.cols} × {slice.rows}</dd>
                  <dt>单帧</dt><dd>{slice.frameW ?? Math.round(naturalW / slice.cols)} × {slice.frameH ?? Math.round(naturalH / slice.rows)}</dd>
                  <dt>FPS</dt><dd>{slice.fps}</dd>
                  <dt>锚点</dt><dd>{slice.anchor}</dd>
                  {(slice.padding > 0 || slice.offsetX !== 0 || slice.offsetY !== 0) && (
                    <>
                      <dt>内边距</dt><dd>{slice.padding}px</dd>
                      <dt>偏移</dt><dd>{slice.offsetX}, {slice.offsetY}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  未检测到切片元数据。
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => setShowSlicer(true)}
                >
                  {I.scissors} {slice ? '编辑' : '定义'}
                </button>
                {slice && props.onAskCodex && (
                  <button
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => askCodexToApplySlicing(slice)}
                    title="让 Codex 更新引擎配置以匹配该切片参数"
                  >
                    {I.spark} 通过 Codex 应用
                  </button>
                )}
              </div>
            </div>

            {pipelineMeta && (
              <div className="meta-section">
                <h4>流水线元数据 <span className="pill">sprite_maker</span></h4>
                <dl className="kv">
                  {pipelineMeta.target && <><dt>目标</dt><dd>{pipelineMeta.target}</dd></>}
                  {pipelineMeta.mode && <><dt>模式</dt><dd>{pipelineMeta.mode}</dd></>}
                  {pipelineMeta.cell_size != null && <><dt>单元格</dt><dd>{pipelineMeta.cell_size}px</dd></>}
                  {pipelineMeta.fit_scale != null && <><dt>适配缩放</dt><dd>{pipelineMeta.fit_scale}</dd></>}
                  {pipelineMeta.duration != null && <><dt>帧时长(ms)</dt><dd>{pipelineMeta.duration}</dd></>}
                  {pipelineMeta.trim_border != null && <><dt>裁边</dt><dd>{pipelineMeta.trim_border}px</dd></>}
                </dl>
                {pipelineMeta.prompt && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-2)', fontStyle: 'italic', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    “{pipelineMeta.prompt}”
                  </div>
                )}
              </div>
            )}

            {slice && imageUrl && naturalW > 0 && (
              <div className="meta-section">
                <h4>动画预览</h4>
                <SpritePreview
                  imageUrl={imageUrl}
                  natW={naturalW}
                  natH={naturalH}
                  slice={slice}
                />
              </div>
            )}

            <div className="meta-section">
              <h4>
                被引用 {usages && <span className="pill">{usages.length}</span>}
              </h4>
              {usagesLoading && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>扫描中…</div>}
              {!usagesLoading && usages && usages.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  该文件在项目中暂无引用。
                </div>
              )}
              {!usagesLoading && usages && usages.length > 0 && (
                <div className="usages-list">
                  {usages.map((u, i) => (
                    <div
                      key={i}
                      className="usage-row"
                      onClick={() => props.onJumpTo?.(u.file, u.line)}
                      title={`跳转到 ${u.file}:${u.line}`}
                    >
                      <div className="usage-path">
                        <span style={{ color: 'var(--ink-1)' }}>{u.file}</span>
                        <span style={{ color: 'var(--ink-3)' }}>:{u.line}</span>
                      </div>
                      <code className="usage-snippet">{u.snippet}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {kind === 'binary' && (
        <div className="canvas-area" style={{ flex: 1 }}>
          <div className="muted mono">二进制文件 · {formatSize(size)} · 无预览</div>
        </div>
      )}

      {showSlicer && isImage && (
        <SpriteSlicerModal
          projectPath={props.projectPath}
          imageRelPath={props.relPath}
          initial={slice ?? undefined}
          onClose={() => setShowSlicer(false)}
          onSaved={(m) => {
            setSlice(m);
            setSliceSource('ogf-slice');
            props.onSlicingSaved?.();
          }}
          onAskCodex={props.onAskCodex ? askCodexToApplySlicing : undefined}
        />
      )}

      {showRegenOpts && isImage && (
        <RegenerateOptionsModal
          projectPath={props.projectPath}
          relPath={props.relPath}
          initial={{
            cols: slice?.cols,
            rows: slice?.rows,
            fps: slice?.fps,
            naturalW,
            naturalH,
          }}
          onCancel={() => setShowRegenOpts(false)}
          onSubmit={submitRegenerate}
        />
      )}
    </div>
  );
}

function SpritePreview({
  imageUrl,
  natW,
  natH,
  slice,
}: {
  imageUrl: string;
  natW: number;
  natH: number;
  slice: SliceMetadata;
}) {
  const total = slice.cols * slice.rows;
  const fW = natW / slice.cols;
  const fH = natH / slice.rows;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (total === 0) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % total), 1000 / slice.fps);
    return () => clearInterval(id);
  }, [slice.fps, total]);

  const previewSize = 96;
  const previewScale = previewSize / Math.max(fW, fH || 1);
  const bgW = natW * previewScale;
  const bgH = natH * previewScale;
  const col = frame % slice.cols;
  const row = Math.floor(frame / slice.cols);

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div
        style={{
          width: previewSize,
          height: previewSize,
          background: 'var(--bg-2)',
          borderRadius: 4,
          border: '1px solid var(--line)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: bgW,
            height: bgH,
            left: -((col * fW + slice.offsetX + slice.padding) * previewScale),
            top: -((row * fH + slice.offsetY + slice.padding) * previewScale),
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: `${bgW}px ${bgH}px`,
            imageRendering: 'pixelated',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
        帧 {frame} / {total - 1}
        <br />
        {slice.fps} fps
      </div>
    </div>
  );
}

function languageOf(relPath: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', lua: 'lua',
    json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
    sh: 'shell', bash: 'shell', ps1: 'powershell',
    xml: 'xml', svg: 'xml',
    gd: 'python',
    tscn: 'ini', tres: 'ini', godot: 'ini',
    cfg: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
