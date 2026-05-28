import { useEffect, useRef, useState } from 'react';
import { fetchFileContent } from '../lib/api.js';

/** Live progress card for `.ogf/spec.md`'s Phase plan section.
 *
 *  Re-fetches the file (cheap, < 5 KB typical) whenever the agent might
 *  have edited it: every active run refreshes via the `streaming` prop, and
 *  the conversation-id reset re-fetches a baseline. Parses every line that
 *  looks like `- [ ] Phase X: ...` or `- [x] Phase X: ...` and renders a
 *  compact checklist. Hidden when the file doesn't exist OR has no phases. */

interface Phase {
  done: boolean;
  text: string;
}

interface Props {
  projectPath: string | null;
  /** Re-render trigger — bump when a new turn starts so we re-baseline. */
  conversationId: string | null;
  /** True while the latest turn is still streaming — drives the poll loop. */
  streaming: boolean;
}

const PHASE_RE = /^- \[([ x])\] (.+)$/i;

function parsePhases(content: string): { title: string | null; phases: Phase[] } {
  const lines = content.split(/\r?\n/);
  // Find the '## 7. Phase plan' heading (or any '## ... phase' heading).
  let inPhases = false;
  const phases: Phase[] = [];
  let title: string | null = null;
  for (const line of lines) {
    const titleMatch = /^#\s+(.+)$/.exec(line);
    if (titleMatch && !title) title = titleMatch[1].trim();
    if (/^##\s+\d*\.?\s*phase/i.test(line)) {
      inPhases = true;
      continue;
    }
    if (inPhases && /^##\s/.test(line)) {
      // Hit the next ## section — stop collecting.
      break;
    }
    if (!inPhases) continue;
    const m = PHASE_RE.exec(line.trim());
    if (m) {
      phases.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
    }
  }
  return { title, phases };
}

const LS_COLLAPSED = 'ogf:specProgressCollapsed';

export function SpecProgressCard(props: Props) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const lastFetchRef = useRef(0);
  // Collapse state — when true, only the head row + bar shows, full
  // phase list is hidden. Persists across reload (per-user preference,
  // not per-project, since most users will have the same preference).
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(LS_COLLAPSED) === '1',
  );
  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, collapsed ? '1' : '0');
  }, [collapsed]);

  // Single fetch helper. Shared by the conversation reset effect + streaming poll.
  async function refresh() {
    if (!props.projectPath) return;
    lastFetchRef.current = Date.now();
    try {
      const r = await fetchFileContent(props.projectPath, '.ogf/spec.md');
      if (!r.content) {
        setExists(false);
        setPhases([]);
        return;
      }
      const parsed = parsePhases(r.content);
      setExists(true);
      setTitle(parsed.title);
      setPhases(parsed.phases);
    } catch {
      // 404 / read error → spec doesn't exist, hide the card.
      setExists(false);
      setPhases([]);
    }
  }

  // Re-baseline on conversation / project change.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectPath, props.conversationId]);

  // While streaming, poll every 2.5s. Cheap (single small file fetch). Stops
  // immediately when the turn finishes — the final state is already shown.
  useEffect(() => {
    if (!props.streaming) return;
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.streaming, props.projectPath, props.conversationId]);

  if (!exists || phases.length === 0) return null;

  const done = phases.filter((p) => p.done).length;
  const pct = Math.round((done / phases.length) * 100);

  // Once every phase is done, the card has nothing useful left to say —
  // it's just visual debt pinned at the bottom of the chat. Hide it.
  // The next streaming run that adds new phases will re-show automatically
  // (state already polls / refetches on conversation change).
  if (done === phases.length) return null;

  // While streaming, the FIRST not-yet-done phase is the "active" one — flag
  // it visually so the user can see what's currently being worked on.
  const activeIdx = props.streaming
    ? phases.findIndex((p) => !p.done)
    : -1;

  // For 14-phase specs, the full list eats most of the chat viewport.
  // When collapsed, show one-line summary of the active phase only.
  const activePhase = activeIdx >= 0 ? phases[activeIdx] : null;

  return (
    <div className={`spec-progress ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="spec-progress-head spec-progress-head-clickable"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开阶段列表' : '收起阶段列表'}
      >
        <span className="spec-progress-chev" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="spec-progress-title">{title ?? '规格进度'}</span>
        <span className="spec-progress-stat">
          {done} / {phases.length} ({pct}%)
        </span>
      </button>
      <div className="spec-progress-bar">
        <div
          className="spec-progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      {collapsed && activePhase && (
        <div className="spec-progress-active-line" title={activePhase.text}>
          <span className="spec-progress-icon">⏳</span>
          <span className="spec-progress-text">{activePhase.text}</span>
        </div>
      )}
      {!collapsed && (
        <ol className="spec-progress-phases">
          {phases.map((p, i) => (
            <li
              key={i}
              className={`spec-progress-phase ${p.done ? 'done' : ''} ${i === activeIdx ? 'active' : ''}`}
            >
              <span className="spec-progress-icon">
                {p.done ? '✓' : i === activeIdx ? '⏳' : '○'}
              </span>
              <span className="spec-progress-text">{p.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
