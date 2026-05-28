import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { EngineKind, FileNode } from '@ogf/contracts';
import { I } from './icons.js';

export type TreeFilter = 'assets' | 'code' | 'all';

interface Props {
  tree: FileNode | null;
  selected: string | null;
  onSelect: (relPath: string, fileKind: FileNode['fileKind']) => void;
  onNewFile?: () => void;
  onRefresh?: () => void;
  recentlyChanged?: Set<string>;
  /** Set of relative paths that are referenced from somewhere in the project. */
  usedAssets?: Set<string>;
  /** Project's main scene (run/main_scene from project.godot). Marked with a 'main' badge. */
  mainScene?: string | null;
  /** Web only: file paths that data/levels.json lists. Get a 'scene' badge.
   *  Godot scenes are inferred from the .tscn extension and don't need this. */
  sceneFiles?: Set<string>;
  filter?: TreeFilter;
  engine?: EngineKind;
  /** Stable identifier (project path) — used to scope localStorage of folder-open state. */
  scopeKey?: string;
  /** Case-insensitive substring filter on file relPath. Empty/undefined = no
   *  search. When set, dirs auto-expand to reveal matching descendants. */
  searchQuery?: string;
}

const CODE_EXT_BY_ENGINE: Record<EngineKind, Set<string>> = {
  godot: new Set(['gd', 'gdshader', 'gdshaderinc']),
  unity: new Set(['cs', 'shader', 'compute', 'cginc']),
  web: new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte']),
  unknown: new Set(['gd', 'cs', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go']),
};

export function FileTree(props: Props) {
  const filter = props.filter ?? 'all';
  const engine = props.engine ?? 'unknown';
  const lsKey = props.scopeKey ? `ogf:openFolders:${props.scopeKey}` : null;
  const usedOnlyKey = props.scopeKey ? `ogf:usedOnly:${props.scopeKey}` : null;

  // Default to hiding unused so the tree stays focused on what the project
  // actually references. User can toggle off to see everything.
  const [usedOnly, setUsedOnly] = useState<boolean>(() => {
    if (!usedOnlyKey) return true;
    const raw = localStorage.getItem(usedOnlyKey);
    return raw === null ? true : raw === '1';
  });
  useEffect(() => {
    if (!usedOnlyKey) return;
    localStorage.setItem(usedOnlyKey, usedOnly ? '1' : '0');
  }, [usedOnly, usedOnlyKey]);
  // Reset when scope changes
  useEffect(() => {
    if (!usedOnlyKey) {
      setUsedOnly(true);
      return;
    }
    const raw = localStorage.getItem(usedOnlyKey);
    setUsedOnly(raw === null ? true : raw === '1');
  }, [usedOnlyKey]);

  const usedOnlyAvailable = !!props.usedAssets;
  const effectiveUsedOnly = usedOnly && usedOnlyAvailable;

  const search = (props.searchQuery ?? '').trim().toLowerCase();
  const isSearching = search.length > 0;

  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    if (!lsKey) return new Set();
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });

  // Reset open state when scope (project) changes
  useEffect(() => {
    if (!lsKey) {
      setOpenFolders(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(lsKey);
      setOpenFolders(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setOpenFolders(new Set());
    }
  }, [lsKey]);

  // Persist on change
  useEffect(() => {
    if (!lsKey) return;
    try {
      localStorage.setItem(lsKey, JSON.stringify([...openFolders]));
    } catch {
      /* ignore */
    }
  }, [openFolders, lsKey]);

  // Auto-open ancestors of selected file (so jumping to a usage opens the path)
  useEffect(() => {
    if (!props.selected) return;
    setOpenFolders((prev) => {
      const next = new Set(prev);
      const parts = props.selected!.split('/').filter(Boolean);
      let cur = '';
      let added = false;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        if (!next.has(cur)) {
          next.add(cur);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [props.selected]);

  const toggleFolder = (rel: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  const fileCount = useMemo(
    () => (props.tree ? countVisible(props.tree, filter, engine, effectiveUsedOnly, props.usedAssets, search) : 0),
    [props.tree, filter, engine, effectiveUsedOnly, props.usedAssets, search],
  );

  // While searching, expand every ancestor of a matching file so all matches
  // are visible without manual clicking. We compose this with the user's
  // openFolders rather than mutate it, so clearing the query restores the
  // user's prior expansion state.
  const searchOpenFolders = useMemo(() => {
    if (!isSearching || !props.tree) return null;
    const opened = new Set<string>();
    function walk(n: FileNode, ancestors: string[]) {
      if (n.kind === 'file') {
        if (!isVisible(n, filter, engine, effectiveUsedOnly, props.usedAssets, search)) return;
        for (const a of ancestors) opened.add(a);
      } else {
        const next = n.relPath ? [...ancestors, n.relPath] : ancestors;
        for (const c of n.children ?? []) walk(c, next);
      }
    }
    walk(props.tree, []);
    return opened;
  }, [isSearching, search, props.tree, filter, engine, effectiveUsedOnly, props.usedAssets]);

  const effectiveOpenFolders = searchOpenFolders ?? openFolders;

  return (
    <div className="tree-pane">
      <div className="tree-head">
        <span>项目</span>
        <span style={{ flex: 1 }} />
        {usedOnlyAvailable && (
          <button
            className={`icon-btn${effectiveUsedOnly ? ' active' : ''}`}
            onClick={() => setUsedOnly((v) => !v)}
            aria-pressed={effectiveUsedOnly}
            title={effectiveUsedOnly ? '当前仅显示已使用资源 · 点击显示全部' : '仅显示已使用资源'}
          >
            {effectiveUsedOnly ? I.check : I.view}
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => setOpenFolders(new Set())}
          title="全部折叠"
        >
          ⇲
        </button>
        {props.onNewFile && (
          <button className="icon-btn" onClick={props.onNewFile} title="新建文件">
            {I.plus}
          </button>
        )}
        {props.onRefresh && (
          <button className="icon-btn" onClick={props.onRefresh} title="刷新">
            {I.refresh}
          </button>
        )}
      </div>
      <div className="tree" role="tree">
        {!props.tree && <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 11 }}>加载中…</div>}
        {props.tree && (
          <Node
            node={props.tree}
            depth={0}
            selected={props.selected}
            onSelect={props.onSelect}
            recentlyChanged={props.recentlyChanged}
            usedAssets={props.usedAssets}
            mainScene={props.mainScene}
            sceneFiles={props.sceneFiles}
            filter={filter}
            engine={engine}
            openFolders={effectiveOpenFolders}
            toggleFolder={toggleFolder}
            usedOnly={effectiveUsedOnly}
            search={search}
            isRoot
          />
        )}
        {props.tree && isSearching && fileCount === 0 && (
          <div style={{ padding: '12px 14px', color: 'var(--ink-3)', fontSize: 11 }}>
            未匹配到文件“{props.searchQuery}”。
          </div>
        )}
      </div>
      <div className="tree-foot">
        <span>{fileCount} 个文件{effectiveUsedOnly ? '（仅已使用）' : ''}</span>
        <span style={{ flex: 1 }} />
        {props.usedAssets && !effectiveUsedOnly && (
          <span style={{ color: 'var(--ink-3)' }}>· 已使用 {props.usedAssets.size}</span>
        )}
      </div>
    </div>
  );
}

function Node(props: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onSelect: (rel: string, fileKind: FileNode['fileKind']) => void;
  recentlyChanged?: Set<string>;
  usedAssets?: Set<string>;
  mainScene?: string | null;
  sceneFiles?: Set<string>;
  filter: TreeFilter;
  engine: EngineKind;
  openFolders: Set<string>;
  toggleFolder: (rel: string) => void;
  usedOnly: boolean;
  search: string;
  isRoot?: boolean;
}) {
  const { node, depth, isRoot, filter, engine, openFolders, toggleFolder, usedOnly, search } = props;
  const open = isRoot ? true : openFolders.has(node.relPath);

  if (node.kind === 'dir') {
    const visibleChildren = (node.children ?? []).filter((c) => isVisible(c, filter, engine, usedOnly, props.usedAssets, search));
    if (!isRoot && visibleChildren.length === 0) return null;
    return (
      <>
        {!isRoot && (
          <div
            className={`tree-row ${open ? '' : 'collapsed'}`}
            style={{ ['--depth' as never]: depth } as React.CSSProperties}
            onClick={() => toggleFolder(node.relPath)}
            role="treeitem"
          >
            <span className="twirl">{I.caret}</span>
            <span className="ficon">{open ? I.folderOpen : I.folder}</span>
            <span className="name">{node.name}</span>
          </div>
        )}
        {(open || isRoot) && visibleChildren.map((c) => (
          <Node
            key={c.relPath || c.name}
            node={c}
            depth={isRoot ? 0 : depth + 1}
            selected={props.selected}
            onSelect={props.onSelect}
            recentlyChanged={props.recentlyChanged}
            usedAssets={props.usedAssets}
            mainScene={props.mainScene}
            sceneFiles={props.sceneFiles}
            filter={filter}
            engine={engine}
            openFolders={openFolders}
            toggleFolder={toggleFolder}
            usedOnly={usedOnly}
            search={search}
          />
        ))}
      </>
    );
  }

  if (!isVisible(node, filter, engine, usedOnly, props.usedAssets, search)) return null;

  const isSelected = props.selected === node.relPath;
  const isChanged = props.recentlyChanged?.has(node.relPath);
  const isAsset = node.fileKind === 'image' || /\.(tscn|tres|prefab|unity|json)$/i.test(node.name);
  const isUsed = props.usedAssets ? props.usedAssets.has(node.relPath) : true;
  const showUnused = isAsset && !!props.usedAssets && !isUsed;
  const isMain = !!props.mainScene && props.mainScene === node.relPath;
  // 'scene' badge: godot scenes are .tscn; web scenes are whatever
  // data/levels.json lists. Other JSONs (catalogs, manifests) get nothing —
  // the absence of the badge tells the user 'this won't open in the canvas'.
  const isSceneFile =
    node.kind === 'file' &&
    ((engine === 'godot' && /\.tscn$/i.test(node.name)) ||
      (engine === 'web' && (props.sceneFiles?.has(node.relPath) ?? false)));
  // For data/*.json that are NOT levels in a web project: tag as 'data' so
  // the user can tell at a glance it's a catalog/manifest, not gameplay-
  // editable in the Scenes tab.
  const isDataFile =
    !isSceneFile &&
    engine === 'web' &&
    node.kind === 'file' &&
    /\.json$/i.test(node.name) &&
    node.relPath.replace(/\\/g, '/').startsWith('data/');

  return (
    <div
      className={`tree-row ${isSelected ? 'selected' : ''}${showUnused ? ' unused' : ''}${isMain ? ' main-scene' : ''}`}
      style={{ ['--depth' as never]: depth } as React.CSSProperties}
      onClick={() => props.onSelect(node.relPath, node.fileKind)}
      role="treeitem"
      title={
        node.relPath +
        (isMain ? '（主场景，会在 Play 中运行）' : '') +
        (showUnused ? '（当前未被任何地方引用）' : '')
      }
    >
      <span className="twirl"></span>
      <span className="ficon">{fileIcon(node)}</span>
      <span className="name">{node.name}</span>
      {isMain && <span className="main-badge" title="主场景">主场景</span>}
      {isSceneFile && !isMain && (
        <span className="scene-badge" title="场景：在场景标签中以可拖拽画布打开">场景</span>
      )}
      {isDataFile && (
        <span className="data-badge" title="数据文件（目录/清单），在资源标签以代码方式打开">数据</span>
      )}
      {showUnused && <span className="unused-badge" title="未引用">未引用</span>}
      {isUsed && isAsset && props.usedAssets && !isMain && (
        <span className="used-dot" title="项目中已引用" />
      )}
      {isChanged && <span className="stale-dot" title="刚刚重新生成" />}
    </div>
  );
}

function isCodeFile(node: FileNode, engine: EngineKind): boolean {
  if (node.kind !== 'file') return false;
  const ext = (node.name.split('.').pop() ?? '').toLowerCase();
  return CODE_EXT_BY_ENGINE[engine].has(ext);
}

function isVisible(
  node: FileNode,
  filter: TreeFilter,
  engine: EngineKind,
  usedOnly: boolean,
  usedAssets: Set<string> | undefined,
  search: string,
): boolean {
  if (node.kind === 'dir') {
    return (node.children ?? []).some((c) => isVisible(c, filter, engine, usedOnly, usedAssets, search));
  }
  // Search is a substring filter on the file's project-relative path. Both
  // path and name match because relPath includes name.
  if (search && !node.relPath.toLowerCase().includes(search)) return false;
  // Used-only hides assets that aren't referenced. Code files are always shown
  // (we don't track their usage; hiding them based on .gd grep would be wrong).
  if (usedOnly && usedAssets) {
    const code = isCodeFile(node, engine);
    if (!code && !usedAssets.has(node.relPath)) return false;
  }
  return true;
}

function countVisible(
  node: FileNode,
  filter: TreeFilter,
  engine: EngineKind,
  usedOnly: boolean,
  usedAssets: Set<string> | undefined,
  search: string,
): number {
  if (node.kind === 'file') return isVisible(node, filter, engine, usedOnly, usedAssets, search) ? 1 : 0;
  let n = 0;
  for (const c of node.children ?? []) n += countVisible(c, filter, engine, usedOnly, usedAssets, search);
  return n;
}

function fileIcon(n: FileNode): ReactElement {
  if (n.fileKind === 'image') {
    const lower = n.name.toLowerCase();
    if (lower.endsWith('.gif')) return I.gif;
    if (/(idle|walk|attack|run|cast|sheet|sprite)/i.test(n.name)) return I.sheet;
    return I.png;
  }
  const ext = n.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'tscn' || ext === 'tres') return I.tscn;
  if (ext === 'gd') return I.gd;
  if (ext === 'json') return I.json;
  if (ext === 'godot' || ext === 'cfg' || ext === 'ini' || ext === 'toml') return I.config;
  return I.config;
}
