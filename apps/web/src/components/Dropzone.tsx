import { useImperativeHandle, useRef, useState, forwardRef } from 'react';
import type { RefImage } from '@ogf/contracts';
import { deleteRef, fileToBase64, uploadRef } from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';

interface Props {
  projectPath: string | null;
  refs: RefImage[];
  onChange: (refs: RefImage[]) => void;
  disabled?: boolean;
  /** When true, parent is hovering a drag — dropzone shows the overlay even if empty. */
  dragOverlay?: boolean;
}

export interface DropzoneHandle {
  /** Trigger the OS file picker. */
  openFilePicker: () => void;
  /** Upload a list of files (used by AgentPane's drop handler). */
  uploadFiles: (files: File[] | FileList) => Promise<void>;
}

const MAX_REFS = 10;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function fileIcon(name: string): string {
  const ext = fileExt(name);
  if (IMAGE_EXT.has(ext)) return '🖼️';
  if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return '🔊';
  if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) return '🎬';
  if (['.pdf'].includes(ext)) return '📕';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return '📦';
  if (['.json', '.toml', '.yaml', '.yml', '.xml'].includes(ext)) return '📋';
  if (['.gd', '.cs', '.py', '.js', '.ts', '.tsx', '.jsx'].includes(ext)) return '📜';
  if (['.md', '.txt'].includes(ext)) return '📝';
  if (['.glb', '.gltf', '.obj', '.fbx'].includes(ext)) return '🧊';
  return '📄';
}

function shortName(name: string, maxLen = 22): string {
  if (name.length <= maxLen) return name;
  const ext = fileExt(name);
  const head = name.slice(0, maxLen - ext.length - 1);
  return `${head}…${ext}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export const Dropzone = forwardRef<DropzoneHandle, Props>(function Dropzone(
  props,
  fwdRef,
) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { notify } = useDialog();

  async function uploadFiles(files: File[] | FileList) {
    if (!props.projectPath || props.disabled || busy) return;
    const list = Array.from(files);
    const slots = MAX_REFS - props.refs.length;
    const accepted = list.slice(0, slots);
    if (accepted.length === 0) return;

    setBusy(true);
    const newRefs: RefImage[] = [];
    try {
      for (const file of accepted) {
        const base64 = await fileToBase64(file);
        const r = await uploadRef({
          projectPath: props.projectPath,
          filename: file.name,
          base64,
        });
        newRefs.push({ relPath: r.relPath, size: r.size, mtimeMs: Date.now() });
      }
      props.onChange([...newRefs, ...props.refs]);
    } catch (err) {
      notify({
        kind: 'error',
        title: '上传失败',
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(fwdRef, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
    uploadFiles,
  }));

  async function removeRef(rel: string) {
    if (!props.projectPath) return;
    try {
      await deleteRef(props.projectPath, rel);
      props.onChange(props.refs.filter((r) => r.relPath !== rel));
    } catch (err) {
      notify({
        kind: 'error',
        title: '移除失败',
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasRefs = props.refs.length > 0;
  const canAdd = hasRefs && props.refs.length < MAX_REFS && !props.disabled && !!props.projectPath;
  // Render nothing when there's nothing to attach AND we're not dragging.
  if (!hasRefs && !props.dragOverlay) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
    );
  }

  return (
    <div className={`dropzone ${hasRefs ? 'has-refs' : ''}`}>
      {hasRefs && (
        <>
          <span className="lbl">
            {I.image}
            <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>已附加</span>
            <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>
              {props.refs.length}/{MAX_REFS}
            </span>
          </span>
          <div className="ref-thumbs">
            {props.refs.map((r) => {
              const ext = fileExt(r.relPath);
              const isImage = IMAGE_EXT.has(ext);
              return isImage ? (
                <div key={r.relPath} className="ref-thumb" title={r.relPath}>
                  <RefImageEl projectPath={props.projectPath ?? ''} relPath={r.relPath} />
                  <button
                    className="x"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRef(r.relPath);
                    }}
                    title="移除"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div key={r.relPath} className="ref-file" title={r.relPath}>
                  <span className="ref-file-ico">{fileIcon(r.relPath)}</span>
                  <span className="ref-file-name">
                    {shortName(r.relPath.split('/').pop() ?? r.relPath)}
                  </span>
                  <span className="ref-file-size">{fmtSize(r.size)}</span>
                  <button
                    className="x"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRef(r.relPath);
                    }}
                    title="移除"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {canAdd && (
              <button
                className="add-btn"
                title={busy ? '上传中…' : '添加附件'}
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {busy ? '…' : I.plus}
              </button>
            )}
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
});

function RefImageEl({ projectPath, relPath }: { projectPath: string; relPath: string }) {
  // Lazy-fetch base64 once to avoid cors / streaming pain.
  const [src, setSrc] = useState<string | null>(null);
  if (!src) {
    fetch(
      `/api/files/content?projectPath=${encodeURIComponent(projectPath)}&relPath=${encodeURIComponent(relPath)}`,
    )
      .then((res) => res.json())
      .then((j) => {
        if (j && j.base64) {
          const ext = relPath.split('.').pop()?.toLowerCase() ?? 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
          setSrc(`data:${mime};base64,${j.base64}`);
        }
      })
      .catch(() => {});
  }
  return (
    <img
      src={src ?? undefined}
      alt={relPath}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        imageRendering: 'pixelated',
      }}
    />
  );
}
