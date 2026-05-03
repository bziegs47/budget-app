import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { decryptWorkspace } from "../ipc";

export type MenuHandlers = {
  cycleMonth: (dir: 1 | -1) => void;
  onOpenFile: () => Promise<void>;
  onCreateBudget: () => void;
  onSaveAs: () => Promise<boolean>;
  onToggleAutoSave: () => Promise<void>;
  openReorderModal: () => void;
  onRevealFolder: () => Promise<void>;
  onExportCsv: () => Promise<void>;
  onExportJson: () => Promise<void>;
  onExportCsvRedacted: () => Promise<void>;
  onExportJsonRedacted: () => Promise<void>;
  onToggleSidebar: () => void;
  showOverview: () => Promise<void>;
  showReports: () => void;
  showLibrary: () => Promise<void>;
  openDuplicateYearModal: (yearId?: number) => Promise<void>;
  openRenameYearModal: (yearId?: number) => void;
  openDeleteYearModal: (yearId?: number) => void;
  showSaveToast: (msg: string) => void;
};

export function useMenuListeners(
  handlersRef: React.MutableRefObject<MenuHandlers | null>,
  encryptionAvailableRef: React.RefObject<boolean>,
  workspaceEncryptedRef: React.RefObject<boolean>,
  setError: (msg: string) => void,
  setPrefsOpen: (open: boolean) => void,
  setPasswordError: (err: string | null) => void,
  setPasswordModal: (kind: "set" | "change" | "unlock" | null) => void,
  setWorkspaceEncrypted: (enc: boolean) => void,
) {
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const listenSafe = (name: string, fn: () => void) =>
      listen(name, fn).then((u) => unlisteners.push(u));
    const h = () => handlersRef.current!;
    void listenSafe("menu:next-month", () => h().cycleMonth(1));
    void listenSafe("menu:prev-month", () => h().cycleMonth(-1));
    void listenSafe("menu:open-file", () => void h().onOpenFile());
    void listenSafe("menu:new-year", () => h().onCreateBudget());
    void listenSafe("menu:save-as", () => void h().onSaveAs());
    void listenSafe("menu:toggle-autosave", () => void h().onToggleAutoSave());
    void listenSafe("menu:reorganize", () => h().openReorderModal());
    void listenSafe("menu:show-default-folder", () => void h().onRevealFolder());
    void listenSafe("menu:export-csv", () => void h().onExportCsv());
    void listenSafe("menu:export-json", () => void h().onExportJson());
    void listenSafe("menu:export-csv-redacted", () => void h().onExportCsvRedacted());
    void listenSafe("menu:export-json-redacted", () => void h().onExportJsonRedacted());
    void listenSafe("menu:toggle-sidebar", () => h().onToggleSidebar());
    void listenSafe("menu:show-overview", () => void h().showOverview());
    void listenSafe("menu:show-reports", () => void h().showReports());
    void listenSafe("menu:show-library", () => void h().showLibrary());
    void listenSafe("menu:duplicate-year", () => void h().openDuplicateYearModal());
    void listenSafe("menu:rename-year", () => h().openRenameYearModal());
    void listenSafe("menu:delete-year", () => h().openDeleteYearModal());
    void listenSafe("menu:open-preferences", () => setPrefsOpen(true));
    void listenSafe("menu:set-password", () => {
      if (!encryptionAvailableRef.current) {
        setError(
          "This build of mimo doesn't include encryption support. Rebuild with --features encryption.",
        );
        return;
      }
      if (workspaceEncryptedRef.current) {
        setError(
          "This budget is already encrypted. Use Change Password to update it.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("set");
    });
    void listenSafe("menu:change-password", () => {
      if (!encryptionAvailableRef.current) {
        setError("This build of mimo doesn't include encryption support.");
        return;
      }
      if (!workspaceEncryptedRef.current) {
        setError(
          "This budget isn't encrypted yet. Use Set Password to add a password.",
        );
        return;
      }
      setPasswordError(null);
      setPasswordModal("change");
    });
    void listenSafe("menu:remove-password", () => {
      if (!encryptionAvailableRef.current || !workspaceEncryptedRef.current) {
        setError(
          encryptionAvailableRef.current
            ? "This budget isn't encrypted."
            : "This build of mimo doesn't include encryption support.",
        );
        return;
      }
      const ok = window.confirm(
        "Remove encryption from this budget? The file will be readable without a password after this.",
      );
      if (!ok) return;
      void (async () => {
        try {
          await decryptWorkspace();
          setWorkspaceEncrypted(false);
          h().showSaveToast("Encryption removed");
        } catch (e) {
          setError(String(e));
        }
      })();
    });
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);
}
