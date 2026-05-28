import { useEffect, useMemo, useState } from 'react';
import type { Entity, EntityGroup, FileNode, SceneSummary } from '@ogf/contracts';
import { I } from './icons.js';

interface Props {
  groups: EntityGroup[];
  scenes: SceneSummary[];
  /** Catalog files that failed to parse — surfaced, never hidden. */
  errors: Array<{ catalog: string; error: string }>;
  tree: FileNode | null;
  loading: boolean;
  selectedEntityId: string | null;
  selectedFile: string | null;
  onSelectEntity: (entity: Entity) => void;
  onSelectScene: (file: string) => void;
  onSelectFile: (relPath: string, fileKind: FileNode['fileKind']) => void;
  /** localStorage scope (project path) for collapse state. */
  scopeKey?: string;
}

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);
const AUDIO_EXTS = new Set(['wav', 'mp3', 'ogg', 'm4a', 'flac']);

interface FlatFile {
  relPath: string;
  name: string;
  fileKind: FileNode['fileKind'];
}

function flatten(node: FileNode | null): FlatFile[] {
  const out: FlatFile[] = [];
  const walk = (n: FileNode) => {
    if (n.kind === 'file') {
      out.push({ relPath: n.relPath, name: n.name, fileKind: n.fileKind });
    } else {
      for (const c of n.children ?? []) walk(c);
    }
  };
  if (node) walk(node);
  return out;
}

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

const KIND_ICON: Record<string, string> = {
  player: '🎮',
  enemy: '👾',
  hero: '⭐',
  boss: '💀',
  tower: '🗼',
  pickup: '💎',
  npc: '🧑',
  projectile: '➹',
  item: '🎒',
  hazard: '⚠️',
  unknown: '◆',
};

function Lane({
  title,
  count,
  scopeKey,
  laneId,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  scopeKey?: string;
  laneId: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const lsKey = scopeKey ? `ogf:lane:${scopeKey}:${laneId}` : null;
  const [open, setOpen] = useState<boolean>(() => {
    if (!lsKey) return defaultOpen;
    const raw = localStorage.getItem(lsKey);
    return raw === null ? defaultOpen : raw === '1';
  });
  useEffect(() => {
    if (lsKey) localStorage.setItem(lsKey, open ? '1' : '0');
  }, [open, lsKey]);

  return (
    <div className={`lane ${open ? 'open' : 'closed'}`}>
      <button className="lane-head" onClick={() => setOpen((v) => !v)}>
        <span className="lane-twirl">{I.caret}</span>
        <span className="lane-title">{title}</span>
        <span className="lane-count">{count}</span>
      </button>
      {open && <div className="lane-body">{children}</div>}
    </div>
  );
}

export function AssetLanes(props: Props) {
  const flat = useMemo(() => flatten(props.tree), [props.tree]);

  // Code lane — src/ files with a code extension.
  const codeFiles = useMemo(
    () =>
      flat
        .filter((f) => CODE_EXTS.has(ext(f.name)) && f.relPath.startsWith('src/'))
        .sort((a, b) => a.relPath.localeCompare(b.relPath)),
    [flat],
  );

  // Assets lane — images + audio that aren't entity sprites (maps, audio,
  // backgrounds, style anchor, icons). Sprites live under the entities.
  const assetFiles = useMemo(
    () =>
      flat
        .filter((f) => {
          const e = ext(f.name);
          const isImg = f.fileKind === 'image';
          const isAudio = AUDIO_EXTS.has(e);
          if (!isImg && !isAudio) return false;
          if (f.relPath.startsWith('assets/sprites/')) return false;
          return true;
        })
        .sort((a, b) => a.relPath.localeCompare(b.relPath)),
    [flat],
  );

  const entityCount = props.groups.reduce((n, g) => n + g.entities.length, 0);

  return (
    <div className="asset-lanes">
      {props.loading && (
        <div className="lanes-loading">正在发现实体…</div>
      )}

      {props.errors.length > 0 && (
        <div className="lanes-errors">
          {props.errors.map((e) => (
            <div key={e.catalog} className="lanes-error" title={e.error}>
              ⚠ {e.catalog} — 解析失败
            </div>
          ))}
        </div>
      )}

      {/* Scenes */}
      <Lane title="场景" count={props.scenes.length} scopeKey={props.scopeKey} laneId="scenes">
        {props.scenes.length === 0 && !props.loading && (
          <div className="lane-empty">
            暂无场景。场景从 <code>data/levels.json</code> 读取。
          </div>
        )}
        {props.scenes.map((s) => (
          <button
            key={s.file}
            className={`lane-row${props.selectedFile === s.file ? ' selected' : ''}`}
            onClick={() => props.onSelectScene(s.file)}
            title={s.file}
          >
            <span className="lane-row-icon">◆</span>
            <span className="lane-row-name">{s.name}</span>
          </button>
        ))}
      </Lane>

      {/* Entities */}
      <Lane title="实体" count={entityCount} scopeKey={props.scopeKey} laneId="entities">
        {props.groups.length === 0 && !props.loading && (
          <div className="lane-empty">
            未找到实体目录。添加 <code>data/enemies.json</code>（或同类文件）后会显示在这里。
          </div>
        )}
        {props.groups.map((g) => (
          <div className="ent-group" key={g.catalog}>
            <div className="ent-group-head">
              <span className="ent-group-label">{g.label}</span>
              <span className="ent-group-count">{g.entities.length}</span>
            </div>
            {g.entities.map((ent) => (
              <button
                key={`${g.catalog}#${ent.id}`}
                className={`lane-row ent-row${
                  props.selectedEntityId === ent.id ? ' selected' : ''
                }${ent.broken ? ' broken' : ''}`}
                onClick={() => props.onSelectEntity(ent)}
                title={ent.broken ? `${ent.id} — 未解析到精灵图` : ent.id}
              >
                <span className="lane-row-icon">{KIND_ICON[ent.kind] ?? '◆'}</span>
                <span className="lane-row-name">{ent.name}</span>
                {ent.broken ? (
                  <span className="lane-row-tag warn">异常</span>
                ) : (
                  <span className="lane-row-tag">{ent.sprites.length}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </Lane>

      {/* Assets */}
      <Lane title="资源" count={assetFiles.length} scopeKey={props.scopeKey} laneId="assets" defaultOpen={false}>
        {assetFiles.length === 0 && (
          <div className="lane-empty">没有独立的图片/音频资源。</div>
        )}
        {assetFiles.map((f) => (
          <button
            key={f.relPath}
            className={`lane-row${props.selectedFile === f.relPath ? ' selected' : ''}`}
            onClick={() => props.onSelectFile(f.relPath, f.fileKind)}
            title={f.relPath}
          >
            <span className="lane-row-icon">{f.fileKind === 'image' ? I.png : I.config}</span>
            <span className="lane-row-name">{f.relPath.replace(/^assets\//, '')}</span>
          </button>
        ))}
      </Lane>

      {/* Code */}
      <Lane title="代码" count={codeFiles.length} scopeKey={props.scopeKey} laneId="code" defaultOpen={false}>
        {codeFiles.length === 0 && <div className="lane-empty">src/ 下没有源码文件。</div>}
        {codeFiles.map((f) => (
          <button
            key={f.relPath}
            className={`lane-row${props.selectedFile === f.relPath ? ' selected' : ''}`}
            onClick={() => props.onSelectFile(f.relPath, f.fileKind)}
            title={f.relPath}
          >
            <span className="lane-row-icon">{I.json}</span>
            <span className="lane-row-name">{f.relPath.replace(/^src\//, '')}</span>
          </button>
        ))}
      </Lane>
    </div>
  );
}
