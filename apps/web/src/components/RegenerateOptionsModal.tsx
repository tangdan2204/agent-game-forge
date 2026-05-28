import { useEffect, useMemo, useState } from 'react';
import type { FileNode } from '@ogf/contracts';
import { fetchFileTree } from '../lib/api.js';
import { I } from './icons.js';

export interface RegenerateOptions {
  /** 'auto' = trust agent (default). 'manual' = use the numeric fields below. */
  mode: 'auto' | 'manual';
  /** Free-form change request — what should be different about this sprite. */
  hint: string;
  /** Auto-discover sibling sprites and ask agent to view_image each as character reference. */
  matchSiblingStyle: boolean;
  /** Manual-only: aspect ratio override. 'same' = keep current dims, 'free' = let model pick. */
  aspectRatio: 'same' | 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
  /** Manual-only: total frame count. */
  frames: number;
  /** Manual-only: grid layout. */
  cols: number;
  rows: number;
  /** Manual-only: animation fps. */
  fps: number;
}

/** What we figured out about this file: is it part of an animation pack
 *  (a directory with sheet.png + pipeline-meta.json), and if so, what
 *  other action folders exist in the same entity? */
export interface PackContext {
  /** True iff parent dir contains sheet.png AND pipeline-meta.json. */
  isPack: boolean;
  /** Project-relative pack dir (e.g. assets/sprites/scout/idle). */
  packDir: string | null;
  /** All files in the pack (project-relative). Used for the
   *  "10 files swap atomically" disclosure. */
  packFiles: string[];
  /** Parallel action folders under the same entity (e.g. walk, attack
   *  when regenerating idle). Each one's sheet.png is the canonical
   *  visual reference for the same character. */
  siblingActions: Array<{ name: string; sheetRelPath: string }>;
}

interface Props {
  /** Current slicing if known — pre-fills cols/rows/fps. */
  initial?: { cols?: number; rows?: number; fps?: number; naturalW?: number; naturalH?: number };
  /** Path of the sprite being regenerated; we use the parent dir to find siblings. */
  relPath: string;
  projectPath: string;
  onCancel: () => void;
  onSubmit: (opts: RegenerateOptions, siblings: string[], packCtx: PackContext) => void;
}

const ASPECTS: Array<{ value: RegenerateOptions['aspectRatio']; label: string }> = [
  { value: 'same', label: '与当前一致' },
  { value: '1:1', label: '1:1（正方形）' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: 'free', label: '自由（由模型决定）' },
];

/** Walk the file tree to determine whether `relPath` lives in an
 *  animation-pack directory. */
function detectPackContext(tree: FileNode, relPath: string): PackContext {
  const norm = relPath.replace(/\\/g, '/');
  const parts = norm.split('/');
  const fileName = parts.pop() ?? '';
  const parentRel = parts.join('/');

  // Locate the parent dir node.
  const parentNode = findNodeByRelPath(tree, parentRel);
  if (!parentNode || !parentNode.children) {
    return { isPack: false, packDir: null, packFiles: [], siblingActions: [] };
  }

  const childNames = parentNode.children
    .filter((c) => c.kind === 'file')
    .map((c) => c.name);
  const isPack =
    childNames.includes('sheet.png') && childNames.includes('pipeline-meta.json');
  if (!isPack) {
    return { isPack: false, packDir: null, packFiles: [], siblingActions: [] };
  }

  const packFiles = parentNode.children
    .filter((c) => c.kind === 'file')
    .map((c) => c.relPath.replace(/\\/g, '/'));

  // Sibling actions: parent of parent's children that ARE pack dirs
  // themselves, excluding the current pack.
  const siblingActions: Array<{ name: string; sheetRelPath: string }> = [];
  const grandparentRel = parts.slice(0, -1).join('/');
  const grandparent = findNodeByRelPath(tree, grandparentRel);
  if (grandparent?.children) {
    for (const sib of grandparent.children) {
      if (sib.kind !== 'dir' || sib.name === parts[parts.length - 1]) continue;
      if (!sib.children) continue;
      const sibChildren = sib.children
        .filter((c) => c.kind === 'file')
        .map((c) => c.name);
      if (
        sibChildren.includes('sheet.png') &&
        sibChildren.includes('pipeline-meta.json')
      ) {
        siblingActions.push({
          name: sib.name,
          sheetRelPath: `${sib.relPath.replace(/\\/g, '/')}/sheet.png`,
        });
      }
    }
  }

  // Mark fileName as used (avoid noUnusedLocals).
  void fileName;

  return {
    isPack: true,
    packDir: parentRel,
    packFiles,
    siblingActions,
  };
}

function findNodeByRelPath(tree: FileNode, relPath: string): FileNode | null {
  if (relPath === '' || tree.relPath.replace(/\\/g, '/') === relPath) return tree;
  if (!tree.children) return null;
  for (const c of tree.children) {
    const found = findNodeByRelPath(c, relPath);
    if (found) return found;
  }
  return null;
}

/** Suggest a reasonable cols × rows grid for a frame count.
 *  Prefers wider-than-tall (cols >= rows); falls back to N×1 for primes. */
function suggestGrid(frames: number): { cols: number; rows: number } {
  if (frames <= 0) return { cols: 1, rows: 1 };
  if (frames === 1) return { cols: 1, rows: 1 };
  // Try to find factors closest to sqrt
  const root = Math.sqrt(frames);
  for (let r = Math.floor(root); r >= 1; r--) {
    if (frames % r === 0) {
      return { cols: frames / r, rows: r };
    }
  }
  return { cols: frames, rows: 1 };
}

export function RegenerateOptionsModal(props: Props) {
  const initialFrames = (props.initial?.cols ?? 0) * (props.initial?.rows ?? 0) || 4;
  // Quick (auto) is the default — agent decides frame count / grid / aspect /
  // fps based on the action. Forcing a layout was causing the agent to
  // squash sprites to fit non-square cells when the requested aspect
  // didn't match what the action naturally needed.
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [hint, setHint] = useState('');
  const [matchSiblingStyle, setMatchSiblings] = useState(true);

  const [aspectRatio, setAspectRatio] = useState<RegenerateOptions['aspectRatio']>('same');
  const [frames, setFrames] = useState(initialFrames);
  const [cols, setCols] = useState(props.initial?.cols ?? 4);
  const [rows, setRows] = useState(props.initial?.rows ?? 1);
  const [fps, setFps] = useState(props.initial?.fps ?? 8);

  const [packCtx, setPackCtx] = useState<PackContext>({
    isPack: false,
    packDir: null,
    packFiles: [],
    siblingActions: [],
  });
  const [scanLoading, setScanLoading] = useState(true);
  /** Fallback for non-pack files: PNG siblings in the same dir. */
  const [flatSiblings, setFlatSiblings] = useState<string[]>([]);

  const parentDir = useMemo(() => {
    const segs = props.relPath.replace(/\\/g, '/').split('/');
    segs.pop();
    return segs.join('/');
  }, [props.relPath]);

  // Detect pack-ness + discover references in one tree walk.
  useEffect(() => {
    let cancelled = false;
    setScanLoading(true);
    fetchFileTree(props.projectPath)
      .then((res) => {
        if (cancelled) return;
        const ctx = detectPackContext(res.tree, props.relPath);
        setPackCtx(ctx);

        if (!ctx.isPack) {
          // Old behavior — flat sibling PNGs in same dir.
          const found: string[] = [];
          const walk = (node: FileNode): void => {
            if (node.children) for (const c of node.children) walk(c);
            if (node.kind !== 'file') return;
            const rp = node.relPath;
            if (rp === props.relPath) return;
            const norm = rp.replace(/\\/g, '/');
            const dir = norm.split('/').slice(0, -1).join('/');
            if (dir === parentDir && /\.(png|jpe?g|webp)$/i.test(norm)) {
              found.push(norm);
            }
          };
          walk(res.tree);
          setFlatSiblings(found);
        }
      })
      .catch(() => {
        setPackCtx({ isPack: false, packDir: null, packFiles: [], siblingActions: [] });
        setFlatSiblings([]);
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath, parentDir]);

  // The list passed to the agent as visual references depends on whether
  // this is a pack or a one-off file.
  const referenceFiles = packCtx.isPack
    ? packCtx.siblingActions.map((a) => a.sheetRelPath)
    : flatSiblings;

  // Keep cols/rows in sync with frames when user changes frame count.
  function applyFrames(n: number) {
    const v = Math.max(1, Math.floor(n || 0));
    setFrames(v);
    const g = suggestGrid(v);
    setCols(g.cols);
    setRows(g.rows);
  }

  function autoSuggest() {
    const g = suggestGrid(frames);
    setCols(g.cols);
    setRows(g.rows);
  }

  function submit() {
    props.onSubmit(
      {
        mode,
        hint: hint.trim(),
        matchSiblingStyle,
        aspectRatio,
        frames,
        cols,
        rows,
        fps,
      },
      referenceFiles,
      packCtx,
    );
  }

  const gridMismatch = cols * rows !== frames;

  // Parse entity / action from a pack dir like "assets/sprites/scout/idle".
  const packLabel = packCtx.packDir
    ? (() => {
        const segs = packCtx.packDir.split('/');
        const action = segs[segs.length - 1];
        const entity = segs[segs.length - 2];
        return `${entity} / ${action}`;
      })()
    : null;

  return (
    <div className="modal-scrim" onClick={props.onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{I.refresh}</span>
          <div className="modal-head-stack">
            <span className="title">
              {packCtx.isPack ? `重生成 ${packLabel}` : '重生成精灵'}
            </span>
            <span className="sub" title={packCtx.isPack ? packCtx.packDir ?? '' : props.relPath}>
              {packCtx.isPack ? packCtx.packDir : props.relPath}
            </span>
          </div>
          <button className="close" onClick={props.onCancel}>{I.close}</button>
        </div>

        <div className="modal-body" style={{ display: 'block', padding: 16, overflow: 'auto' }}>
          <div className="regen-form">
            {packCtx.isPack && (
              <div className="regen-pack-disclosure">
                <strong>这会重生成整个动画包。</strong>{' '}
                <span className="muted">
                  你点击应用后，<code>{packCtx.packDir}/</code> 下的 {packCtx.packFiles.length} 个文件会原子替换。
                  {packCtx.siblingActions.length > 0 && (
                    <>
                      {' '}
                      同一实体的其他动作（
                      {packCtx.siblingActions.map((a) => a.name).join(', ')})
                      不会被修改。
                    </>
                  )}
                </span>
              </div>
            )}

            {/* The two things that actually matter for most regenerates:
                what should change, and which sibling sprites to match. */}
            <label className="regen-form-row regen-form-row-stack">
              <span>希望调整什么？</span>
              <textarea
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="可选，例如：动作更凶、更大幅挥动。留空则在保留原意下生成新版本。"
                rows={3}
                autoFocus
              />
            </label>

            <label className="regen-checkbox">
              <input
                type="checkbox"
                checked={matchSiblingStyle}
                onChange={(e) => setMatchSiblings(e.target.checked)}
              />
              <span>
                {packCtx.isPack
                  ? '匹配该实体其他动作的风格'
                  : '匹配同目录兄弟精灵的风格'}
                {scanLoading ? (
                  <span className="muted mono" style={{ marginLeft: 6 }}>扫描中…</span>
                ) : (
                  <span className="pill" style={{ marginLeft: 6 }}>
                    找到 {referenceFiles.length} 个
                  </span>
                )}
              </span>
            </label>

            {matchSiblingStyle && referenceFiles.length > 0 && (
              <ul className="regen-siblings">
                {referenceFiles.slice(0, 6).map((s) => (
                  <li key={s} className="mono">{s}</li>
                ))}
                {referenceFiles.length > 6 && (
                  <li className="muted mono">… 另有 {referenceFiles.length - 6} 个</li>
                )}
              </ul>
            )}

            {/* Mode toggle — auto trusts the agent. Manual unlocks the
                numeric controls. Default = auto because over-constraining
                was causing the agent to squash sprites trying to fit
                forced aspects/grids. */}
            <div className="regen-mode-toggle">
              <button
                type="button"
                className={`regen-mode-btn ${mode === 'auto' ? 'active' : ''}`}
                onClick={() => setMode('auto')}
              >
                快速
                <span className="muted">由智能体决定布局</span>
              </button>
              <button
                type="button"
                className={`regen-mode-btn ${mode === 'manual' ? 'active' : ''}`}
                onClick={() => setMode('manual')}
              >
                手动
                <span className="muted">我来设置帧数/网格/FPS</span>
              </button>
            </div>

            {mode === 'manual' && (
              <div className="regen-manual-block">
                <label className="regen-form-row">
                  <span>长宽比</span>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as RegenerateOptions['aspectRatio'])}
                  >
                    {ASPECTS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="regen-form-row">
                  <span>帧数</span>
                  <div className="regen-frame-controls">
                    <input
                      type="number"
                      min={1}
                      value={frames}
                      onChange={(e) => applyFrames(Number(e.target.value))}
                      style={{ width: 64 }}
                    />
                    <span className="regen-form-divider">分布在</span>
                    <input
                      type="number"
                      min={1}
                      value={cols}
                      onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))}
                      style={{ width: 56 }}
                    />
                    <span className="regen-form-divider">×</span>
                    <input
                      type="number"
                      min={1}
                      value={rows}
                      onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                      style={{ width: 56 }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={autoSuggest}
                      title="自动建议与帧数匹配的网格"
                    >
                      自动
                    </button>
                  </div>
                </div>
                {gridMismatch && (
                  <div className="regen-form-warn">
                    {I.warn} cols × rows ({cols * rows}) 与帧数 ({frames}) 不一致。
                  </div>
                )}

                <label className="regen-form-row">
                  <span>FPS</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={fps}
                    onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 8)))}
                    style={{ width: 64 }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={props.onCancel}>取消</button>
          <button className="btn btn-sm btn-primary" onClick={submit}>
            {I.refresh} 重生成
          </button>
        </div>
      </div>
    </div>
  );
}
