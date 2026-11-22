"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus2,
  Folder,
  FolderPlus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, Modal } from "./ui";

type Entry = {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  symlink: boolean;
};

type Listing = { path: string; entries: Entry[]; maxEdit: number; maxUpload: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

export function FileManager({ app, onClose }: { app: string; onClose: () => void }) {
  const [cwd, setCwd] = useState("/");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ path: string; content: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/files?app=${encodeURIComponent(app)}&path=${encodeURIComponent(dir)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not read the folder.");
        setListing(data as Listing);
        setCwd((data as Listing).path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [app],
  );

  useEffect(() => {
    void load("/");
  }, [load]);

  async function call(payload: Record<string, unknown>) {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "File operation failed.");
    return data;
  }

  async function openFile(entry: Entry) {
    setError(null);
    setSaved(false);
    try {
      const data = (await call({ op: "read", path: join(cwd, entry.name) })) as {
        path: string;
        content: string;
      };
      setEditor({ path: data.path, content: data.content });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveFile() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      await call({ op: "write", path: editor.path, content: editor.content });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createFolder() {
    const name = window.prompt("New folder name");
    if (!name) return;
    try {
      await call({ op: "mkdir", path: join(cwd, name) });
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createFile() {
    const name = window.prompt("New file name", "index.php");
    if (!name) return;
    try {
      await call({ op: "write", path: join(cwd, name), content: "" });
      await load(cwd);
      setEditor({ path: join(cwd, name), content: "" });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renameEntry(entry: Entry) {
    const name = window.prompt("New name", entry.name);
    if (!name || name === entry.name) return;
    try {
      await call({ op: "rename", path: join(cwd, entry.name), to: join(cwd, name) });
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteEntry(entry: Entry) {
    if (!window.confirm(`Delete ${entry.name}${entry.dir ? " and everything inside it" : ""}?`)) return;
    try {
      await call({ op: "remove", path: join(cwd, entry.name) });
      if (editor?.path === join(cwd, entry.name)) setEditor(null);
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function uploadFile(file: File) {
    if (file.size > (listing?.maxUpload ?? 8 * 1024 * 1024)) {
      setError("File is too large (limit 8 MB).");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
      await call({ op: "upload", path: cwd, filename: file.name, data: dataUrl.split(",")[1] ?? "" });
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const segments = cwd.split("/").filter(Boolean);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Files · ${app}`}
      description={`data/sites/${app} — edit, upload and organise the app source.`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => void load("/")}>
          <Folder size={13} /> Root
        </Button>
        {segments.map((segment, index) => {
          const target = "/" + segments.slice(0, index + 1).join("/");
          return (
            <span key={target} className="flex items-center gap-1.5">
              <ChevronRight size={12} className="text-slate-600" />
              <button
                onClick={() => void load(target)}
                className="max-w-[160px] truncate rounded px-1 text-xs text-slate-300 hover:text-white"
              >
                {segment}
              </button>
            </span>
          );
        })}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void load(cwd)}>
            <RefreshCw size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={createFile}>
            <FilePlus2 size={13} /> File
          </Button>
          <Button size="sm" variant="ghost" onClick={createFolder}>
            <FolderPlus size={13} /> Folder
          </Button>
          <Button size="sm" variant="ghost" onClick={() => uploadRef.current?.click()}>
            <Upload size={13} /> Upload
          </Button>
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = "";
            }}
          />
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="max-h-[46vh] overflow-auto rounded-xl border border-white/5 bg-ink-950/40">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-ink-950/95 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 font-medium">Modified</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {cwd !== "/" && (
              <tr className="border-t border-white/5">
                <td className="px-3 py-2" colSpan={4}>
                  <button
                    onClick={() => {
                      const parent = cwd.split("/").slice(0, -1).join("/") || "/";
                      void load(parent);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    ← ..
                  </button>
                </td>
              </tr>
            )}
            {listing?.entries.map((entry) => (
              <tr key={entry.name} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  <button
                    onClick={() => (entry.dir ? void load(join(cwd, entry.name)) : void openFile(entry))}
                    className="flex items-center gap-2 text-left text-slate-200 hover:text-white"
                  >
                    {entry.dir ? (
                      <Folder size={14} className="text-brand-400" />
                    ) : (
                      <FileIcon size={14} className="text-slate-500" />
                    )}
                    <span className="max-w-[280px] truncate">{entry.name}</span>
                    {entry.symlink && <span className="text-[10px] text-amber-300">link</span>}
                  </button>
                </td>
                <td className="px-3 py-2 text-slate-500">{entry.dir ? "—" : formatSize(entry.size)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {entry.mtime ? new Date(entry.mtime).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className="flex justify-end gap-1">
                    {!entry.dir && (
                      <a
                        href={`/api/files?app=${encodeURIComponent(app)}&path=${encodeURIComponent(
                          join(cwd, entry.name),
                        )}&download=1`}
                        className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                        title="Download"
                      >
                        <Download size={13} />
                      </a>
                    )}
                    <button
                      onClick={() => void renameEntry(entry)}
                      className="rounded px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/5 hover:text-white"
                      title="Rename"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => void deleteEntry(entry)}
                      className="rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && <p className="px-3 py-6 text-center text-xs text-slate-500">Loading…</p>}
        {!loading && listing && listing.entries.length === 0 && cwd === "/" && (
          <p className="px-3 py-6 text-center text-xs text-slate-500">
            This app folder is empty. Upload a file or create index.php.
          </p>
        )}
      </div>

      {editor && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-slate-400">{editor.path}</p>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[10px] text-amber-300">unsaved</span>}
              {saved && <span className="text-[10px] text-brand-400">saved</span>}
              <Button size="sm" variant="ghost" onClick={() => setEditor(null)}>
                Close
              </Button>
              <Button size="sm" onClick={() => void saveFile()} loading={saving}>
                <Save size={13} /> Save
              </Button>
            </div>
          </div>
          <textarea
            value={editor.content}
            onChange={(e) => {
              setEditor({ ...editor, content: e.target.value });
              setDirty(true);
            }}
            spellCheck={false}
            className="h-[46vh] w-full resize-y rounded-xl border border-white/10 bg-ink-950 p-3 font-mono text-[12px] leading-relaxed text-slate-200 outline-none focus:border-brand-500/40"
          />
        </div>
      )}
    </Modal>
  );
}
