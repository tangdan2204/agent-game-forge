import { useEffect, useState } from 'react';
import type {
  AgentId,
  AgentInfo,
  GenImageSummary,
  ImageGenProviderPref,
  Preferences,
  SecretKey,
  SecretStatus,
} from '@ogf/contracts';
import {
  fetchAgents,
  fetchGenImageSummary,
  fetchPreferences,
  fetchSecrets,
  setPreferences,
  setSecret,
} from '../lib/api.js';
import { I } from './icons.js';

/** localStorage key for the user's preferred agent CLI. Read on app boot;
 *  written when the user picks a different CLI in Settings. */
export const LS_PREFERRED_AGENT = 'ogf:preferred-agent';

interface SecretRowSpec {
  key: SecretKey;
  label: string;
  hint: string;
  placeholder: string;
}

const ROWS: SecretRowSpec[] = [
  {
    key: 'openai_api_key',
    label: 'OpenAI',
    hint: 'gpt-image-1 / gpt-image-2',
    placeholder: 'sk-…',
  },
  {
    key: 'gemini_api_key',
    label: 'Gemini',
    hint: 'Gemini 2.5 Flash Image（Nano Banana）',
    placeholder: 'AIza…',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic',
    hint: '预留给未来 Claude Code 智能体（当前无图像生成 API）。',
    placeholder: 'sk-ant-…',
  },
];

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 32,
  padding: '0 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--ink-0)',
  background: 'var(--bg-0)',
  border: '1px solid var(--line-strong)',
  borderRadius: 6,
  outline: 'none',
};

const inputDisabledStyle: React.CSSProperties = {
  ...inputStyle,
  color: 'var(--ink-3)',
  background: 'var(--bg-2)',
  cursor: 'not-allowed',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--bg-1)',
  padding: '12px 14px',
  display: 'grid',
  gap: 10,
};

const badgeBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.3,
  padding: '2px 7px',
  borderRadius: 999,
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase' as const,
};

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<SecretStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SecretKey, string>>>({});
  const [revealing, setRevealing] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [saving, setSaving] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [usage, setUsage] = useState<GenImageSummary | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [preferredAgent, setPreferredAgent] = useState<AgentId>(() => {
    const v = localStorage.getItem(LS_PREFERRED_AGENT);
    return v === 'claude-code' ? 'claude-code' : 'codex';
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSecrets(),
      fetchAgents(),
      fetchGenImageSummary(),
      fetchPreferences(),
    ])
      .then(([secretsResp, agentsResp, usageResp, prefsResp]) => {
        if (cancelled) return;
        setStatuses(secretsResp.secrets);
        setAgents(agentsResp.agents);
        setUsage(usageResp);
        setPrefs(prefsResp);
      })
      .catch(() => {
        if (!cancelled) {
          setStatuses([]);
          setAgents([]);
          setUsage(null);
          setPrefs(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function pickAgent(id: AgentId) {
    setPreferredAgent(id);
    localStorage.setItem(LS_PREFERRED_AGENT, id);
    // Notify other components (App.tsx) so they switch immediately.
    window.dispatchEvent(new CustomEvent('ogf:preferred-agent-changed', { detail: id }));
  }

  async function savePrefs(patch: Partial<Preferences['image_gen']>) {
    if (!prefs) return;
    const next: Preferences = {
      image_gen: { ...prefs.image_gen, ...patch },
    };
    setPrefs(next); // optimistic
    setSavingPrefs(true);
    try {
      const r = await setPreferences(next);
      setPrefs(r);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('setPreferences failed', err);
      // Roll back to server's view on failure by refetching.
      void fetchPreferences()
        .then(setPrefs)
        .catch(() => {});
    } finally {
      setSavingPrefs(false);
    }
  }

  // Known model options per provider. List can lag actual API releases —
  // advanced users can edit ~/.ogf/preferences.json directly if they need
  // a model that's not in this dropdown.
  const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image · GA' },
    { id: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image · 预览版' },
  ];
  const OPENAI_MODELS = [
    { id: 'gpt-image-1', label: 'gpt-image-1 · GA' },
    { id: 'gpt-image-1-mini', label: 'gpt-image-1-mini · 更便宜更快' },
    { id: 'gpt-image-2', label: 'gpt-image-2 · 更新（若可用）' },
  ];

  async function save(key: SecretKey, value: string | null) {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const r = await setSecret(key, value);
      setStatuses(r.secrets);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('setSecret failed', err);
      alert('保存失败，请查看控制台。');
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        style={{ height: 'auto', width: 'min(640px, 100%)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="title">设置</span>
          <button className="close" onClick={onClose}>
            {I.close}
          </button>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 20, overflowY: 'auto' }}>
          {/* Agent CLI picker */}
          <section style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>
              智能体 CLI
            </h3>
            <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
              <strong>新会话默认使用</strong>此处选择的 CLI。已有会话会保持创建它的 CLI；
              当你切回旧会话时，活动 CLI 会自动切回原值（若想在另一 CLI 下重新开始，请新建会话）。
              Codex 使用内置图像生成功能；Claude Code 会通过 daemon 的{' '}
              <code>/api/gen-image</code> 并使用下方 API Key。模型列表包含 AIGW 顶级模型 ID，
              仅在本地 Codex/Claude CLI 已配置 AIGW 兼容网关或代理时使用。
            </p>
          </section>
          <div style={{ display: 'grid', gap: 8 }}>
            {(['codex', 'claude-code'] as const).map((id) => {
              const info = agents?.find((a) => a.id === id);
              const isPreferred = preferredAgent === id;
              const available = info?.available ?? false;
              const cliName = id === 'codex' ? 'Codex CLI' : 'Claude Code';
              return (
                <label
                  key={id}
                  style={{
                    ...cardStyle,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.55,
                    borderColor: isPreferred ? 'var(--accent)' : 'var(--line)',
                    background: isPreferred ? 'var(--accent-soft)' : 'var(--bg-1)',
                    gap: 4,
                  }}
                  onClick={() => {
                    if (available) pickAgent(id);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="radio"
                      name="agent-cli"
                      checked={isPreferred}
                      onChange={() => available && pickAgent(id)}
                      disabled={!available}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>
                      {cliName}
                    </span>
                    {info?.version && (
                      <span
                        className="muted"
                        style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      >
                        {info.version}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        ...badgeBase,
                        background: available
                          ? 'rgba(110, 231, 142, 0.18)'
                          : 'var(--bg-2)',
                        color: available ? 'var(--green, #6ee78e)' : 'var(--ink-3)',
                      }}
                    >
                      {available ? '已安装' : '未找到'}
                    </span>
                  </div>
                  {!available && (
                    <p
                      className="muted"
                      style={{ margin: 0, marginLeft: 26, fontSize: 11, lineHeight: 1.4 }}
                    >
                      使用 <code>npm i -g {id === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}</code>{' '}
                      安装后重载 OGF。
                    </p>
                  )}
                </label>
              );
            })}
          </div>

          <section style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink-0)',
              }}
            >
              图像生成 API Key
            </h3>
            <p
              className="muted"
              style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}
            >
              用于没有内置图像生成能力的智能体。Codex CLI 用户仍使用
              Codex 的 <code>image_gen</code>。
            </p>
          </section>

          <div style={{ display: 'grid', gap: 12 }}>
            {ROWS.map((row) => {
              const status = statuses?.find((s) => s.key === row.key);
              const draft = drafts[row.key];
              const isEditing = draft !== undefined;
              const isSaving = saving[row.key];
              const reveal = revealing[row.key];
              const fieldDisabled = !!status?.fromEnv || isSaving;
              return (
                <div key={row.key} style={cardStyle}>
                  {/* Header: label + status badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--ink-0)',
                      }}
                    >
                      {row.label}
                    </span>
                    <span
                      className="muted"
                      style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    >
                      {row.hint}
                    </span>
                    <span style={{ flex: 1 }} />
                    {status?.fromEnv ? (
                      <span
                        style={{
                          ...badgeBase,
                        background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                        }}
                        title={`被环境变量 ${status.envVarName} 覆盖，取消该变量后才可使用此界面`}
                      >
                        环境变量
                      </span>
                    ) : status?.set ? (
                      <span
                        style={{
                          ...badgeBase,
                          background: 'rgba(110, 231, 142, 0.18)',
                          color: 'var(--green, #6ee78e)',
                        }}
                      >
                        已保存
                      </span>
                    ) : (
                      <span
                        style={{
                          ...badgeBase,
                          background: 'var(--bg-2)',
                          color: 'var(--ink-3)',
                        }}
                      >
                        未设置
                      </span>
                    )}
                  </div>

                  {/* Input + buttons */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type={reveal ? 'text' : 'password'}
                      placeholder={
                        status?.fromEnv
                          ? `（来自 ${status.envVarName}）`
                          : status?.set
                            ? status.masked
                            : row.placeholder
                      }
                      value={draft ?? ''}
                      disabled={fieldDisabled}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft && !isSaving) {
                          void save(row.key, draft);
                        }
                      }}
                      style={fieldDisabled ? inputDisabledStyle : inputStyle}
                    />
                    {isEditing && draft!.length > 0 && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          setRevealing((r) => ({ ...r, [row.key]: !reveal }))
                        }
                        title={reveal ? '隐藏' : '显示'}
                        disabled={isSaving}
                      >
                        {reveal ? '隐藏' : '显示'}
                      </button>
                    )}
                    {isEditing ? (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => void save(row.key, draft ?? '')}
                          disabled={isSaving || !draft}
                        >
                          {isSaving ? '保存中…' : '保存'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() =>
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[row.key];
                              return next;
                            })
                          }
                          disabled={isSaving}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      status?.set &&
                      !status.fromEnv && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => void save(row.key, null)}
                          disabled={isSaving}
                          title="移除该 Key"
                        >
                          清空
                        </button>
                      )
                    )}
                  </div>

                  {/* Env hint when shadowed */}
                  {status?.fromEnv && (
                    <p
                      className="muted"
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.4,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      当前受 <code>{status.envVarName}</code> 覆盖。取消该环境变量后才会使用这里保存的值。
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Image-gen defaults (provider + model). When the agent calls
             /api/gen-image without an explicit provider/model, the daemon
             uses these. Per-call overrides via the script still work. */}
          {prefs && (
            <section
              style={{
                display: 'grid',
                gap: 10,
                borderTop: '1px solid var(--line)',
                paddingTop: 14,
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  图像生成默认设置
                </h3>
                <p
                  className="muted"
                  style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5 }}
                >
                  当智能体请求里未指定 provider/model 时，daemon 将使用这里的默认值。
                </p>
              </div>

              {/* Provider radio */}
              <div style={cardStyle}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  提供商
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {(['auto', 'gemini', 'openai'] as const).map((p) => {
                    const checked = prefs.image_gen.provider === p;
                    const label =
                      p === 'auto'
                        ? '自动'
                        : p === 'gemini'
                          ? 'Gemini'
                          : 'OpenAI';
                    const hint =
                      p === 'auto'
                        ? '自动选择可用 Key（优先 Gemini）'
                        : p === 'gemini'
                          ? '原生多模态，成本更低'
                          : '模型选择更广';
                    return (
                      <label
                        key={p}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          cursor: savingPrefs ? 'wait' : 'pointer',
                          color: checked ? 'var(--accent)' : 'var(--ink-1)',
                        }}
                      >
                        <input
                          type="radio"
                          name="image-gen-provider"
                          checked={checked}
                          disabled={savingPrefs}
                          onChange={() => void savePrefs({ provider: p })}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
                        <span
                          className="muted"
                          style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                        >
                          {hint}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Per-provider model dropdown */}
              <div style={cardStyle}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  默认模型
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        minWidth: 70,
                        fontSize: 12,
                        color: 'var(--ink-1)',
                      }}
                    >
                      Gemini
                    </span>
                    <select
                      value={prefs.image_gen.geminiModel}
                      disabled={savingPrefs}
                      onChange={(e) => void savePrefs({ geminiModel: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                    >
                      {GEMINI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {!GEMINI_MODELS.find((m) => m.id === prefs.image_gen.geminiModel) && (
                        <option value={prefs.image_gen.geminiModel}>
                          {prefs.image_gen.geminiModel} · （自定义）
                        </option>
                      )}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        minWidth: 70,
                        fontSize: 12,
                        color: 'var(--ink-1)',
                      }}
                    >
                      OpenAI
                    </span>
                    <select
                      value={prefs.image_gen.openaiModel}
                      disabled={savingPrefs}
                      onChange={(e) => void savePrefs({ openaiModel: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                    >
                      {OPENAI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {!OPENAI_MODELS.find((m) => m.id === prefs.image_gen.openaiModel) && (
                        <option value={prefs.image_gen.openaiModel}>
                          {prefs.image_gen.openaiModel} · （自定义）
                        </option>
                      )}
                    </select>
                  </div>
                </div>
                <p
                  className="muted"
                  style={{ margin: 0, fontSize: 10, lineHeight: 1.5 }}
                >
                  列表里没有想要的模型？可直接编辑 <code>~/.ogf/preferences.json</code>。
                </p>
              </div>
            </section>
          )}

          {/* Usage / cost (last 24 h) */}
          {usage && usage.totalCount > 0 && (
            <section
              style={{
                display: 'grid',
                gap: 8,
                borderTop: '1px solid var(--line)',
                paddingTop: 14,
              }}
            >
              <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink-0)',
              }}
            >
                图像生成用量 · 最近 24 小时
              </h3>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink-1)',
                  display: 'grid',
                  gap: 4,
                }}
              >
                {usage.byProvider.map((row) => (
                  <div
                    key={row.provider}
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <span style={{ minWidth: 60, color: 'var(--ink-0)' }}>
                      {row.provider}
                    </span>
                    <span style={{ minWidth: 60 }}>{row.count} 次调用</span>
                    {row.errorCount > 0 && (
                      <span style={{ color: 'var(--red, #ff6e6e)' }}>
                        （失败 {row.errorCount} 次）
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ color: 'var(--ink-0)' }}>
                      ~${row.estCostUsd.toFixed(3)}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    paddingTop: 4,
                    marginTop: 4,
                    borderTop: '1px dashed var(--line)',
                    color: 'var(--ink-0)',
                    fontWeight: 600,
                  }}
                >
                  <span>总计</span>
                  <span style={{ flex: 1 }} />
                  <span>~${usage.totalEstCostUsd.toFixed(3)}</span>
                </div>
              </div>
              <p
                className="muted"
                style={{ margin: 0, fontSize: 10, lineHeight: 1.5 }}
              >
                成本为估算值（单图标价 × 调用次数），实际账单请以服务商后台为准。
              </p>
            </section>
          )}

          <p
            className="muted"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.6,
              borderTop: '1px solid var(--line)',
              paddingTop: 14,
            }}
          >
            存储位置：<code>~/.ogf/secrets.json</code>（权限 600）。运行时环境变量
            （<code>OPENAI_API_KEY</code>、<code>GEMINI_API_KEY</code>、
            <code>ANTHROPIC_API_KEY</code>）会覆盖该文件值。
          </p>
        </div>
      </div>
    </div>
  );
}
