import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AppSettings, CloudFolderProbe, WorkspaceMeta } from "../../types";
import { useModalFocusTrap } from "./useModalFocusTrap";
import "./PreferencesModal.css";

type PreferenceSectionId = "general";

const PREFERENCE_SECTIONS: ReadonlyArray<{
  id: PreferenceSectionId;
  label: string;
  description: string;
}> = [
  {
    id: "general",
    label: "General",
    description: "Budget defaults that apply to every file you open.",
  },
];

export function PreferencesModal({
  open,
  settings,
  workspaceMeta,
  workspaceFileBasename,
  isDefaultWorkspace,
  onClose,
  onSaved,
  onWorkspaceMetaSaved,
  onError,
}: {
  open: boolean;
  settings: AppSettings | null;
  workspaceMeta: WorkspaceMeta | null;
  workspaceFileBasename: string;
  isDefaultWorkspace: boolean;
  onClose: () => void;
  onSaved: () => void;
  onWorkspaceMetaSaved: () => void;
  onError: (message: string) => void;
}) {
  const [activeSection, setActiveSection] =
    useState<PreferenceSectionId>("general");
  const [folderDraft, setFolderDraft] = useState<string>("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState<string>("");
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [cloudProbes, setCloudProbes] = useState<CloudFolderProbe[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [adoptBusy, setAdoptBusy] = useState<string | null>(null);

  const refreshCloudProbes = useCallback(async () => {
    setCloudBusy(true);
    try {
      const probes = await invoke<CloudFolderProbe[]>("detect_cloud_folders");
      setCloudProbes(probes);
    } catch (e) {
      onError(String(e));
    } finally {
      setCloudBusy(false);
    }
  }, [onError]);

  useEffect(() => {
    if (open) {
      setFolderDraft(settings?.defaultFolder ?? "");
      setDisplayNameDraft(workspaceMeta?.displayName ?? "");
      setActiveSection("general");
      setShowDiagnostics(false);
      void refreshCloudProbes();
    }
  }, [open, settings?.defaultFolder, workspaceMeta?.displayName, refreshCloudProbes]);

  const trapRef = useModalFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const currentFolder = settings?.defaultFolder ?? "";
  const trimmed = folderDraft.trim();
  const folderDirty = trimmed !== currentFolder.trim();

  const persistFolder = async (next: string) => {
    setSavingFolder(true);
    try {
      await invoke("set_default_folder", { newPath: next });
      onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSavingFolder(false);
    }
  };

  const onBrowse = async () => {
    setPickingFolder(true);
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: trimmed || currentFolder || undefined,
      });
      const next = typeof picked === "string" ? picked : null;
      if (!next) return;
      setFolderDraft(next);
      await persistFolder(next);
    } catch (e) {
      onError(String(e));
    } finally {
      setPickingFolder(false);
    }
  };

  const onApplyFolder = async () => {
    if (!folderDirty || !trimmed) return;
    await persistFolder(trimmed);
  };

  const onAdoptCloud = async (probe: CloudFolderProbe, migrate: boolean) => {
    setAdoptBusy(probe.path);
    try {
      const [copied, dest] = await invoke<[number, string]>(
        "adopt_default_folder",
        { newPath: probe.path, migrate },
      );
      setFolderDraft(dest);
      onSaved();
      await refreshCloudProbes();
      if (migrate && copied > 0) {
        onError(
          `Copied ${copied} budget${copied === 1 ? "" : "s"} into ${probe.provider}.`,
        );
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setAdoptBusy(null);
    }
  };

  const currentDisplayName = workspaceMeta?.displayName ?? "";
  const trimmedDisplayName = displayNameDraft.trim();
  const displayNameDirty = trimmedDisplayName !== currentDisplayName.trim();

  const onApplyDisplayName = async () => {
    if (!displayNameDirty) return;
    setSavingDisplayName(true);
    try {
      const next = trimmedDisplayName.length > 0 ? trimmedDisplayName : null;
      await invoke("set_workspace_display_name", { displayName: next });
      onWorkspaceMetaSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSavingDisplayName(false);
    }
  };

  const onClearDisplayName = async () => {
    setSavingDisplayName(true);
    try {
      await invoke("set_workspace_display_name", { displayName: null });
      setDisplayNameDraft("");
      onWorkspaceMetaSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSavingDisplayName(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal-card preferences-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preferences-header">
          <h2 id="preferences-title" className="modal-title">
            Preferences
          </h2>
          <button
            type="button"
            className="btn ghost preferences-close"
            onClick={onClose}
            aria-label="Close preferences"
          >
            ✕
          </button>
        </div>
        <div className="preferences-body">
          <nav className="preferences-nav" aria-label="Preference sections">
            <ul>
              {PREFERENCE_SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`preferences-nav-item${
                      activeSection === section.id ? " is-active" : ""
                    }`}
                    onClick={() => setActiveSection(section.id)}
                  >
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section className="preferences-panel" aria-live="polite">
            {activeSection === "general" && (
              <>
                <header className="preferences-panel-head">
                  <h3>General</h3>
                  <p className="muted">
                    {
                      PREFERENCE_SECTIONS.find((s) => s.id === "general")!
                        .description
                    }
                  </p>
                </header>
                <div className="preferences-field">
                  <label className="preferences-label" htmlFor="prefs-default-folder">
                    Default folder
                  </label>
                  <p className="muted preferences-help">
                    Where mimo saves new files and looks for your library.
                  </p>
                  <div className="preferences-folder-row">
                    <input
                      id="prefs-default-folder"
                      className="input preferences-folder-input"
                      value={folderDraft}
                      onChange={(e) => setFolderDraft(e.target.value)}
                      placeholder="~/Documents/Budget"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void onBrowse()}
                      disabled={pickingFolder || savingFolder}
                    >
                      {pickingFolder ? "Choosing…" : "Browse…"}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => void onApplyFolder()}
                      disabled={!folderDirty || !trimmed || savingFolder}
                    >
                      {savingFolder ? "Saving…" : "Apply"}
                    </button>
                  </div>
                  {currentFolder && !folderDirty && (
                    <p className="muted preferences-status">
                      Current: <code>{currentFolder}</code>
                    </p>
                  )}
                </div>

                <div className="preferences-field">
                  <label className="preferences-label" htmlFor="prefs-display-name">
                    Budget name
                  </label>
                  <p className="muted preferences-help">
                    A friendly label for this file. Shown in the sidebar and
                    the window title. Leave blank to use the file name (
                    <code>{workspaceFileBasename}</code>).
                  </p>
                  <div className="preferences-folder-row">
                    <input
                      id="prefs-display-name"
                      className="input preferences-folder-input"
                      value={displayNameDraft}
                      onChange={(e) => setDisplayNameDraft(e.target.value)}
                      placeholder={workspaceFileBasename}
                      spellCheck={false}
                      disabled={isDefaultWorkspace || savingDisplayName}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void onClearDisplayName()}
                      disabled={
                        isDefaultWorkspace ||
                        savingDisplayName ||
                        currentDisplayName.length === 0
                      }
                      title="Use the file name"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => void onApplyDisplayName()}
                      disabled={
                        isDefaultWorkspace ||
                        savingDisplayName ||
                        !displayNameDirty
                      }
                    >
                      {savingDisplayName ? "Saving…" : "Apply"}
                    </button>
                  </div>
                  {isDefaultWorkspace && (
                    <p className="muted preferences-status">
                      Save this budget to a file before naming it.
                    </p>
                  )}
                </div>

                <div className="preferences-field">
                  <div className="preferences-cloud-head">
                    <label className="preferences-label">Cloud folders</label>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => void refreshCloudProbes()}
                      disabled={cloudBusy}
                    >
                      {cloudBusy ? "Scanning…" : "Rescan"}
                    </button>
                  </div>
                  <p className="muted preferences-help">
                    Detected cloud-storage folders on this Mac. Adopting one
                    points mimo at it for new and existing files. Migration
                    copies your library — originals stay put for safety.
                  </p>
                  {cloudProbes.length === 0 ? (
                    <p className="muted preferences-status">
                      {cloudBusy
                        ? "Looking…"
                        : "No cloud folders detected yet."}
                    </p>
                  ) : (
                    <ul className="preferences-cloud-list">
                      {cloudProbes.map((probe) => {
                        const busy = adoptBusy === probe.path;
                        return (
                          <li
                            key={`${probe.provider}::${probe.path}`}
                            className={`preferences-cloud-row ${
                              probe.isDefault ? "is-default" : ""
                            } ${probe.exists ? "" : "is-missing"}`}
                          >
                            <div className="preferences-cloud-info">
                              <div className="preferences-cloud-provider">
                                {probe.provider}
                                {probe.isDefault && (
                                  <span className="preferences-cloud-tag">
                                    current default
                                  </span>
                                )}
                                {!probe.exists && (
                                  <span className="preferences-cloud-tag muted">
                                    not installed
                                  </span>
                                )}
                              </div>
                              <code className="preferences-cloud-path">
                                {probe.path}
                              </code>
                              {probe.exists && (
                                <span className="muted preferences-cloud-meta">
                                  {probe.workspaceCount} budget
                                  {probe.workspaceCount === 1 ? "" : "s"} here
                                </span>
                              )}
                            </div>
                            <div className="preferences-cloud-actions">
                              {probe.exists && !probe.isDefault && (
                                <>
                                  <button
                                    type="button"
                                    className="btn secondary"
                                    onClick={() =>
                                      void onAdoptCloud(probe, false)
                                    }
                                    disabled={busy}
                                    title="Switch the default folder without copying files"
                                  >
                                    Use as default
                                  </button>
                                  <button
                                    type="button"
                                    className="btn primary"
                                    onClick={() =>
                                      void onAdoptCloud(probe, true)
                                    }
                                    disabled={busy}
                                    title="Switch and copy existing files (originals preserved)"
                                  >
                                    {busy ? "Migrating…" : "Migrate here"}
                                  </button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="preferences-field preferences-diagnostics">
                  <button
                    type="button"
                    className="btn-link preferences-diagnostics-toggle"
                    onClick={() => setShowDiagnostics((v) => !v)}
                    aria-expanded={showDiagnostics}
                  >
                    {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                  </button>
                  {showDiagnostics && (
                    <dl className="preferences-diagnostics-list">
                      <dt>Budget ID</dt>
                      <dd>
                        <code>{workspaceMeta?.fileUuid || "—"}</code>
                      </dd>
                      <dt>Schema version</dt>
                      <dd>
                        <code>
                          {workspaceMeta?.schemaVersion ?? "—"}
                        </code>
                      </dd>
                      <dt>Created</dt>
                      <dd>
                        <code>{workspaceMeta?.createdAt || "—"}</code>
                      </dd>
                      <dt>Last updated</dt>
                      <dd>
                        <code>{workspaceMeta?.updatedAt || "—"}</code>
                      </dd>
                    </dl>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        <div className="modal-actions preferences-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
