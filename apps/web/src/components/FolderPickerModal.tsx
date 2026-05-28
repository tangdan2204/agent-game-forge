import { useEffect, useState } from 'react';
import { fsList, type FsListResult } from '../lib/api.js';
import { I } from './icons.js';

interface Props {
  /** Initial path to open at. If empty/undefined uses Windows root or homedir on Mac/Linux. */
  initialPath?: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
  /** Optional: when supplied, a 'Create new project' button starts a flow that
   *  scaffolds a folder under the current directory and opens it. */
  onCreateProject?: (opts: { parentPath: string; name: string; engine: 'godot' | 'web' }) => void;
}

const LS_LAST_BROWSE = 'ogf:lastBrowsePath';

export function FolderPickerModal(props: Props) {
  const [path, setPath] = useState<string>(
    () => props.initialPath ?? localStorage.getItem(LS_LAST_BROWSE) ?? '',
  );
  const [data, setData] = useState<FsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // Default engine = 'web' since the JS-first pivot. Godot still works
  // (existing projects auto-detected) but new projects start as web games
  // by default — that's where OGF's agent + editor coupling is best.
  const [newEngine, setNewEngine] = useState<'godot' | 'web'>('web');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fsList(path)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (r.cwd) localStorage.setItem(LS_LAST_BROWSE, r.cwd);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  function navigate(p: string) {
    setManualEntry(false);
    setPath(p);
  }

  function chooseCurrent() {
    if (data?.cwd) props.onSelect(data.cwd);
  }

  function submitManual() {
    const t = manualPath.trim();
    if (t) props.onSelect(t);
  }

  return (
    <div className="modal-scrim" onClick={props.onCancel}>
      <div
        className="modal"
        style={{ height: 'min(620px, 90vh)', width: 'min(720px, 100%)', display: 'grid', gridTemplateRows: '48px auto 1fr 56px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.folder}</span>
          <span className="title">打开项目文件夹</span>
          <span className="sub">点击进入目录 · 项目目录会高亮显示</span>
          <button className="close" onClick={props.onCancel}>{I.close}</button>
        </div>

        <div className="picker-bar">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate('')}
            title="磁盘列表 / 主目录"
          >
            {navigator.platform.toLowerCase().includes('win') ? '🖥' : '🏠'}
          </button>
          {data?.parent !== null && data?.parent !== undefined && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(data.parent ?? '')}
              title="返回上一级"
            >
              ↑
            </button>
          )}
          <div className="picker-crumbs">
            {data?.parts.length === 0 && <span className="muted mono" style={{ fontSize: 11 }}>磁盘</span>}
            {data?.parts.map((p, i) => (
              <span key={p.path}>
                <button
                  className="picker-crumb"
                  onClick={() => navigate(p.path)}
                >
                  {p.name}
                </button>
                {i < (data.parts.length - 1) && <span className="picker-crumb-sep">/</span>}
              </span>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setManualEntry((v) => !v);
              setManualPath(data?.cwd ?? '');
            }}
            title="手动输入路径"
          >
            ⌨
          </button>
        </div>

        {manualEntry && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8 }}>
            <input
              autoFocus
              placeholder="D:\path\to\project"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitManual();
                if (e.key === 'Escape') setManualEntry(false);
              }}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--line)',
                background: 'var(--bg-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={submitManual} disabled={!manualPath.trim()}>
              打开
            </button>
          </div>
        )}

        <div className="picker-list">
          {error && <div className="msg-sys err" style={{ margin: 12 }}>{I.warn} {error}</div>}
          {!error && !data && <div style={{ padding: 16, color: 'var(--ink-3)' }}>加载中…</div>}
          {data && data.entries.length === 0 && (
            <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 12 }}>（空目录）</div>
          )}
          {data?.entries.map((e) => (
            <div
              key={e.path}
              className={`picker-row${e.engine ? ' is-project' : ''}`}
              onClick={() => navigate(e.path)}
              onDoubleClick={() => props.onSelect(e.path)}
              title={e.path}
            >
              <span className="picker-row-icon">{I.folder}</span>
              <span className="picker-row-name">{e.name}</span>
              {e.engine && (
                <span className={`pill engine ${e.engine}`} style={{ fontSize: 10, padding: '1px 8px' }}>
                  <span className="dot" /> {e.engine}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span className="info">
            {data?.cwd ? (
              <>
                <span style={{ color: 'var(--ink-2)' }}>当前目录：</span>
                <code style={{ color: 'var(--ink-1)' }}>{data.cwd}</code>
                {data.isProject && (
                  <span className={`pill engine ${data.engine}`} style={{ marginLeft: 8, fontSize: 10, padding: '1px 8px' }}>
                    <span className="dot" /> {data.engine}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--ink-3)' }}>请选择磁盘</span>
            )}
          </span>
          <span className="grow" />
          {props.onCreateProject && data?.cwd && (
            <button
              className="btn btn-sm"
              onClick={() => setCreating(true)}
              title="在当前目录创建新项目"
            >
              + 新建项目
            </button>
          )}
          <button className="btn btn-sm" onClick={props.onCancel}>取消</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={chooseCurrent}
            disabled={!data?.cwd}
            title={data?.isProject ? '打开该项目文件夹' : '打开此文件夹（将按未知引擎处理）'}
          >
            打开此文件夹
          </button>
        </div>
      </div>

      {creating && data?.cwd && props.onCreateProject && (
        <div className="modal-scrim" style={{ zIndex: 30 }} onClick={() => setCreating(false)}>
          <div
            className="modal"
            style={{ height: 'auto', width: 'min(440px, 90vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <span className="title">创建新项目</span>
              <button className="close" onClick={() => setCreating(false)}>{I.close}</button>
            </div>
            <div style={{ padding: 18, display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <label className="muted" style={{ fontSize: 11 }}>父目录</label>
                <code className="mono" style={{ fontSize: 11, color: 'var(--ink-1)' }}>
                  {data.cwd}
                </code>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <label className="muted" style={{ fontSize: 11 }}>项目名称</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="my-game"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--ink-0)',
                  }}
                />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label className="muted" style={{ fontSize: 11 }}>引擎</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <EngineRadio
                    value="web"
                    label="Web（Canvas 2D）"
                    sub="原生 JS + JSON 关卡"
                    checked={newEngine === 'web'}
                    onSelect={() => setNewEngine('web')}
                  />
                  <EngineRadio
                    value="godot"
                    label="Godot 4"
                    sub="即将支持"
                    checked={false}
                    onSelect={() => undefined}
                    disabled
                  />
                  <EngineRadio
                    value="unity"
                    label="Unity"
                    sub="即将支持"
                    checked={false}
                    onSelect={() => undefined}
                    disabled
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="grow" />
              <button className="btn btn-sm" onClick={() => setCreating(false)}>取消</button>
              <button
                className="btn btn-sm btn-primary"
                disabled={!newName.trim()}
                onClick={() => {
                  if (!newName.trim() || !data.cwd) return;
                  props.onCreateProject?.({
                    parentPath: data.cwd,
                    name: newName.trim(),
                    engine: newEngine,
                  });
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EngineRadio({
  value,
  label,
  sub,
  checked,
  onSelect,
  disabled,
}: {
  value: string;
  label: string;
  sub: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  void value;
  return (
    <button
      type="button"
      className={`engine-radio${checked ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="engine-radio-label">{label}</span>
      <span className="engine-radio-sub">{sub}</span>
    </button>
  );
}
