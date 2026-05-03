import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * All known menu event names emitted by the Tauri backend.
 */
export type MenuEvent =
  | "menu:next-month"
  | "menu:prev-month"
  | "menu:open-file"
  | "menu:new-year"
  | "menu:save-as"
  | "menu:toggle-autosave"
  | "menu:reorganize"
  | "menu:show-default-folder"
  | "menu:export-csv"
  | "menu:export-json"
  | "menu:export-csv-redacted"
  | "menu:export-json-redacted"
  | "menu:toggle-sidebar"
  | "menu:show-overview"
  | "menu:show-reports"
  | "menu:show-library"
  | "menu:duplicate-year"
  | "menu:rename-year"
  | "menu:delete-year"
  | "menu:open-preferences"
  | "menu:set-password"
  | "menu:change-password"
  | "menu:remove-password";

/**
 * Type-safe wrapper around `listen` for menu events.
 *
 * Returns an unlisten function, just like the underlying Tauri API.
 */
export function listenMenu(
  event: MenuEvent,
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(event, handler);
}
