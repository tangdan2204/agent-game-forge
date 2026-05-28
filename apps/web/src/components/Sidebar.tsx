import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentInfo,
  Entity,
  EntityGroup,
  FileNode,
  Project,
  SceneSummary,
} from '@ogf/contracts';
import { I } from './icons.js';
import { FileTree } from './FileTree.js';
import { AssetLanes } from './AssetLanes.js';

const LS_SIDEBAR_VIEW = 'ogf:sidebarView';
type SidebarView = 'grouped' | 'files';

export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'regular' | 'comfy';
export type SidebarTab = 'assets' | 'scenes' | 'play';

interface Props {
  agent: AgentInfo | null;
  agentLoading: boolean;
  project: Project | null;
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onOpenProject: () => void;
  /** Remove project from OGF's list (doesn't touch disk). */
  onDeleteProject?: (p: Project) => void;
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onCycleDensity: () => void;
  /** Project file tree — fills the bulk of the sidebar. */
  tree: FileNode | null;
  selectedFile?: { relPath: string; fileKind?: FileNode['fileKind'] } | null;
  onSelectFile: (relPath: string, fileKind: FileNode['fileKind']) => void;
  onNewFile?: () => void;
  onRefreshTree?: () => void;
  recentlyChanged?: Set<string>;
  usedAssets?: Set<string>;
  mainScene?: string | null;
  sceneFiles?: Set<string>;
  /** Asset-centric view — derived entity groups + scenes. */
  entityGroups: EntityGroup[];
  scenes: SceneSummary[];
  entityErrors: Array<{ catalog: string; error: string }>;
  entitiesLoading: boolean;
  selectedEntityId: string | null;
  onSelectEntity: (entity: Entity) => void;
  onSelectScene: (file: string) => void;
}

export function Sidebar(props: Props) {
  const agentState = props.agent?.available
    ? 'ok'
    : props.agentLoading
      ? 'off'
      : 'error';
  const stateLabel =
    agentState === 'ok'
      ? 'Codex 就绪'
      : agentState === 'error'
        ? 'Codex 离线'
        : '检测中…';

  // Project-scoped search. State is local to this Sidebar — empty when there
  // is no project, reset when switching projects (re-render of <Sidebar> for
  // a different project clears the input naturally because we tie the key
  // through React tree, but we also reset on project path change to be safe).
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSearch('');
  }, [props.project?.path]);

  // View mode — the grouped asset-centric view vs the raw file tree.
  // Persisted globally (not per-project): it's a workflow preference.
  const [view, setView] = useState<SidebarView>(
    () => (localStorage.getItem(LS_SIDEBAR_VIEW) as SidebarView) ?? 'grouped',
  );
  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR_VIEW, view);
  }, [view]);
  // Cmd/Ctrl+K → focus search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onSearchKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearch('');
      (e.currentTarget as HTMLInputElement).blur();
    }
  }, []);

  return (
    <aside className="side">
      {/* Brand head — pixel mascot + "Agent Game Forge" wordmark */}
      <div className="side-head">
        <div className="brand">
          <img
            className="mark"
            src="/ogf-logo-64.png"
            srcSet="/ogf-logo-32.png 1x, /ogf-logo-64.png 2x, /ogf-logo-128.png 4x"
            alt=""
            width={22}
            height={22}
          />
          <span className="brand-title" aria-label="Agent Game Forge">
            <span className="brand-agent">Agent</span>
            <span className="brand-game">Game</span>
            <span className="brand-forge">Forge</span>
          </span>
        </div>
      </div>

      {/* Project switcher up top — compact button that drops the recent-projects
          list. Workspace tab nav lives in the editor topbar (not here) so the
          sidebar stays focused on its primary job: the file tree. */}
      <div className="side-top">
        <ProjectSwitcher
          project={props.project}
          projects={props.projects}
          onSelect={props.onSelectProject}
          onOpen={props.onOpenProject}
          onDelete={props.onDeleteProject}
        />
        <button
          type="button"
          className="icon-btn side-top-open"
          onClick={props.onOpenProject}
          title="打开项目文件夹…"
          aria-label="打开项目文件夹"
        >
          {I.plus}
        </button>
      </div>

      {/* View toggle — grouped asset-centric view vs the raw file tree.
          The user picked "toggle between two views" over a Files lane:
          each view stays uncluttered. */}
      {props.project && (
        <div className="side-view-toggle" role="tablist" aria-label="侧栏视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'grouped'}
            className={`side-view-btn ${view === 'grouped' ? 'active' : ''}`}
            onClick={() => setView('grouped')}
            title="按实体和场景分组"
          >
            分组
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'files'}
            className={`side-view-btn ${view === 'files' ? 'active' : ''}`}
            onClick={() => setView('files')}
            title="原始文件树"
          >
            文件
          </button>
        </div>
      )}

      {/* Project search — files view only (the grouped view has its own
          structure). ⌘K / Ctrl+K jumps focus here. */}
      {props.project && view === 'files' && (
        <div className="side-search">
          <span className="side-search-icon" aria-hidden>{I.search ?? '⌕'}</span>
          <input
            ref={searchInputRef}
            type="text"
            className="side-search-input"
            placeholder="搜索文件…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {search && (
            <button
              type="button"
              className="side-search-clear"
              onClick={() => {
                setSearch('');
                searchInputRef.current?.focus();
              }}
              title="清空 (Esc)"
              aria-label="清空搜索"
            >
              ×
            </button>
          )}
          {!search && <span className="side-search-kbd">⌘K</span>}
        </div>
      )}

      {/* Body — grouped lanes OR the raw file tree, per the toggle. */}
      {props.project && view === 'grouped' && (
        <div className="side-files">
          <AssetLanes
            groups={props.entityGroups}
            scenes={props.scenes}
            errors={props.entityErrors}
            tree={props.tree}
            loading={props.entitiesLoading}
            selectedEntityId={props.selectedEntityId}
            selectedFile={props.selectedFile?.relPath ?? null}
            onSelectEntity={props.onSelectEntity}
            onSelectScene={props.onSelectScene}
            onSelectFile={props.onSelectFile}
            scopeKey={props.project.path}
          />
        </div>
      )}
      {props.project && view === 'files' && (
        <div className="side-files">
          <FileTree
            tree={props.tree}
            selected={props.selectedFile?.relPath ?? null}
            onSelect={props.onSelectFile}
            onNewFile={props.onNewFile}
            onRefresh={props.onRefreshTree}
            recentlyChanged={props.recentlyChanged}
            usedAssets={props.usedAssets}
            mainScene={props.mainScene}
            sceneFiles={props.sceneFiles}
            filter="all"
            engine={props.project.engine}
            scopeKey={props.project.path}
            searchQuery={search}
          />
        </div>
      )}

      {/* Foot: agent status + theme + density toggles */}
      <div className="side-foot">
        <button
          className="agent-pill"
          data-state={agentState}
          title={props.agent?.path ?? 'Codex 代理状态'}
        >
          <span className="dot" />
          <span className="lbl">{stateLabel}</span>
          {props.agent?.version && (
            <span className="ver">
              {props.agent.version.replace(/^codex-cli\s*/, 'v')}
            </span>
          )}
        </button>
        <span className="grow" />
        <button
          className="icon-btn"
          title={props.theme === 'dark' ? '切换到浅色' : '切换到深色'}
          onClick={props.onToggleTheme}
        >
          {props.theme === 'dark' ? I.sun : I.moon}
        </button>
        <button
          className="icon-btn"
          title={`密度 · ${props.density}（点击切换）`}
          onClick={props.onCycleDensity}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          {props.density.slice(0, 1).toUpperCase()}
        </button>
      </div>
    </aside>
  );
}

function ProjectSwitcher(props: {
  project: Project | null;
  projects: Project[];
  onSelect: (p: Project) => void;
  onOpen: () => void;
  onDelete?: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) setConfirmingPath(null);
  }, [open]);

  return (
    <div ref={ref} className="proj-switcher">
      <button
        type="button"
        className="nav-item proj-trigger"
        onClick={() => setOpen((v) => !v)}
        title={props.project ? `${props.project.path}\n引擎: ${props.project.engine}` : undefined}
      >
        <svg className="ico" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7" cy="7" r="2" fill="currentColor" />
        </svg>
        <span className="proj-trigger-name">{props.project?.name ?? '未打开项目'}</span>
        {props.project && (
          <span
            className="proj-trigger-engine"
            data-engine={props.project.engine}
            aria-label={`引擎: ${props.project.engine}`}
          >
            {props.project.engine}
          </span>
        )}
        <span className="proj-trigger-caret">{I.caret}</span>
      </button>
      {open && (
        <div className="proj-dropdown">
          {props.projects.length === 0 && (
            <div className="proj-dropdown-empty">暂无最近项目</div>
          )}
          {props.projects.map((p) => {
            const confirming = confirmingPath === p.path;
            return (
              <div
                key={p.path}
                className={`proj-dropdown-item ${props.project?.path === p.path ? 'active' : ''}`}
                onClick={() => {
                  setConfirmingPath(null);
                  props.onSelect(p);
                  setOpen(false);
                }}
                title={p.path}
              >
                <div className="proj-dropdown-row">
                  <div className="proj-dropdown-text">
                    <div className="proj-dropdown-name">{p.name}</div>
                    <div className="proj-dropdown-sub">
                      {p.engine} · {p.path}
                    </div>
                  </div>
                  {props.onDelete && (
                    <button
                      type="button"
                      className={`proj-dropdown-delete ${confirming ? 'confirming' : ''}`}
                      title={
                        confirming
                          ? '再次点击确认。不会删除磁盘文件。'
                          : '从 OGF 列表移除（保留磁盘文件）'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirming) {
                          props.onDelete!(p);
                          setConfirmingPath(null);
                        } else {
                          setConfirmingPath(p.path);
                        }
                      }}
                    >
                      {confirming ? '确认移除?' : '×'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {/* 'Open folder…' moved out of the dropdown — it's now a
              dedicated icon-btn next to the switcher in .side-top, so
              the user doesn't have to open the menu just to add a new
              project. The dropdown is purely for picking among recents. */}
        </div>
      )}
    </div>
  );
}
