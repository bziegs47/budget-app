//! App-level configuration and library index living under `app_config_dir`.
//!
//! - `settings.json` holds user preferences: default folder, sidebar state, and
//!   the recent-files list.
//! - `library-index.json` holds a cached snapshot of every `.mimo` workspace
//!   discovered under the default folder so the Library view is instant (and
//!   so encrypted workspaces can show their last-known summary while locked).

use crate::db;
use crate::models::{AppSettings, CloudFolderProbe, LibraryEntry, RecentFile};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE: &str = "settings.json";
const LIBRARY_INDEX_FILE: &str = "library-index.json";
pub const RECENT_LIMIT: usize = 24;

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

fn library_index_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(LIBRARY_INDEX_FILE))
}

pub fn default_folder_default(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not resolve Documents dir: {e}"))?;
    Ok(docs.join("Budget"))
}

pub fn load_settings(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<AppSettings>(&raw).map_err(|e| e.to_string())
}

pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_atomic(&path, raw.as_bytes())
}

/// Returns the default folder, creating it on disk if missing. If the user has
/// never set one, falls back to `~/Documents/Budget/` and persists the choice.
pub fn ensure_default_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut settings = load_settings(app)?;
    let folder = match settings.default_folder.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let p = default_folder_default(app)?;
            settings.default_folder = Some(p.to_string_lossy().into_owned());
            save_settings(app, &settings)?;
            p
        }
    };
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

pub fn set_default_folder(app: &tauri::AppHandle, new_path: &Path) -> Result<(), String> {
    fs::create_dir_all(new_path).map_err(|e| e.to_string())?;
    let mut settings = load_settings(app)?;
    settings.default_folder = Some(new_path.to_string_lossy().into_owned());
    save_settings(app, &settings)
}

pub fn upsert_recent(
    app: &tauri::AppHandle,
    path: &Path,
    year_label: &str,
) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    let canonical = canonicalize_or_self(path);
    let path_str = canonical.to_string_lossy().into_owned();
    settings.recent_files.retain(|r| r.path != path_str);
    settings.recent_files.insert(
        0,
        RecentFile {
            path: path_str,
            year_label: year_label.to_string(),
            last_opened_at: Utc::now().to_rfc3339(),
        },
    );
    settings.recent_files.truncate(RECENT_LIMIT);
    save_settings(app, &settings)
}

/// Returns the recent-files list with any entries whose underlying file is
/// missing pruned out (and persisted back). This keeps the welcome screen
/// honest when workspaces get renamed or deleted outside the app, or via
/// the library's own rename/delete actions before the cache caught up.
pub fn list_recent(app: &tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    let mut settings = load_settings(app)?;
    if prune_missing_recents(&mut settings) {
        save_settings(app, &settings)?;
    }
    Ok(settings.recent_files)
}

/// Drops `recent_files` entries whose path no longer points at a file on
/// disk. Returns `true` if anything was removed so the caller can decide
/// whether to persist. Shared by `get_settings` and `list_recent` so the
/// welcome screen and the lower-level recents API stay in sync.
pub fn prune_missing_recents(settings: &mut AppSettings) -> bool {
    let before = settings.recent_files.len();
    settings
        .recent_files
        .retain(|r| Path::new(&r.path).is_file());
    settings.recent_files.len() != before
}

pub fn set_sidebar_collapsed(app: &tauri::AppHandle, collapsed: bool) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    settings.sidebar_collapsed = collapsed;
    save_settings(app, &settings)
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LibraryIndex {
    entries: Vec<LibraryEntry>,
}

pub fn load_library_index(app: &tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    let path = library_index_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let idx: LibraryIndex = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(idx.entries)
}

pub fn save_library_index(
    app: &tauri::AppHandle,
    entries: &[LibraryEntry],
) -> Result<(), String> {
    let path = library_index_path(app)?;
    let idx = LibraryIndex {
        entries: entries.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&idx).map_err(|e| e.to_string())?;
    write_atomic(&path, raw.as_bytes())
}

/// Probe a single `.mimo` file and return its index entry. Opens the SQLite
/// database read-only briefly to read the workspace meta and per-line totals.
pub fn read_library_entry(path: &Path) -> Result<LibraryEntry, String> {
    let canonical = canonicalize_or_self(path);
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    let last_modified = metadata
        .modified()
        .map_err(|e| e.to_string())
        .ok()
        .and_then(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339().into())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let size_bytes = metadata.len();

    let conn = db::open_at_path(&canonical).map_err(|e| e.to_string())?;
    let (year_label, display_name, file_uuid, last_edited_at): (
        String,
        Option<String>,
        String,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT year_label, display_name, file_uuid, updated_at FROM workspace_meta WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let income_actual: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let expense_net_actual: i64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(t.amount_cents), 0)
            FROM transactions t
            JOIN expense_lines el ON el.id = t.expense_line_id
            WHERE el.is_neutral_transfer = 0
            "#,
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let month_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM budget_months", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    // "Tracked" = months that have at least one income entry or one
    // non-neutral expense transaction. Neutral transfers (credit-card
    // payments, internal moves) don't count as activity because they
    // don't represent real spending.
    let tracked_month_count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(*) FROM budget_months bm
            WHERE EXISTS (
                SELECT 1 FROM income_entries ie
                JOIN income_lines il ON il.id = ie.income_line_id
                WHERE il.month_id = bm.id
            )
               OR EXISTS (
                SELECT 1 FROM transactions t
                JOIN expense_lines el ON el.id = t.expense_line_id
                JOIN expense_buckets eb ON eb.id = el.bucket_id
                WHERE eb.month_id = bm.id
                  AND el.is_neutral_transfer = 0
            )
            "#,
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Multi-year files are now the norm, so the tile needs to know
    // every year in the budget — not just the legacy single
    // `year_label`. We sort descending so the most recent year leads.
    let mut year_labels_stmt = conn
        .prepare("SELECT year_label FROM years ORDER BY sort_order DESC, year_label DESC")
        .map_err(|e| e.to_string())?;
    let year_labels: Vec<String> = year_labels_stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(year_labels_stmt);
    let year_count = year_labels.len() as i64;

    Ok(LibraryEntry {
        path: canonical.to_string_lossy().into_owned(),
        year_label,
        display_name,
        file_uuid,
        last_modified,
        size_bytes,
        income_actual_cents: income_actual,
        expense_net_actual_cents: expense_net_actual,
        net_actual_cents: income_actual - expense_net_actual,
        month_count,
        tracked_month_count,
        year_labels,
        year_count,
        encrypted: false,
        provider: detect_provider(&canonical),
        is_conflict_copy: is_conflict_copy_path(&canonical),
        last_edited_at,
    })
}

/// Heuristic for cloud-sync conflict copies. Each provider names them
/// differently so we match on the patterns we've seen in the wild rather
/// than try to be exhaustive: false positives are far worse than misses
/// because they shame normal filenames.
pub fn is_conflict_copy_path(path: &Path) -> bool {
    let name = match path.file_stem().and_then(|s| s.to_str()) {
        Some(n) => n.to_lowercase(),
        None => return false,
    };
    if name.contains("(conflicted copy") {
        return true; // Dropbox + iCloud
    }
    if name.contains("-conflict-") || name.contains(" conflict ") {
        return true; // OneDrive
    }
    if name.contains("'s conflicted copy") {
        return true; // Box
    }
    false
}

/// Maps a path to a known cloud-storage provider by prefix-matching the
/// well-known macOS mount points. Pure path heuristic - no API calls or
/// filesystem probes beyond what the caller already needed.
pub fn detect_provider(path: &Path) -> Option<String> {
    let s = path.to_string_lossy();
    let lower = s.to_lowercase();
    if lower.contains("/library/mobile documents/com~apple~clouddocs") {
        return Some("iCloud Drive".into());
    }
    if lower.contains("/library/cloudstorage/googledrive") {
        return Some("Google Drive".into());
    }
    if lower.contains("/library/cloudstorage/dropbox") {
        return Some("Dropbox".into());
    }
    if lower.contains("/library/cloudstorage/onedrive") {
        return Some("OneDrive".into());
    }
    if lower.contains("/library/cloudstorage/box") {
        return Some("Box".into());
    }
    None
}

/// Probes the filesystem for the well-known cloud-storage roots and
/// returns the candidate Budget folders within them. Folders that don't
/// exist are still returned (with `exists = false`) so the UI can show
/// "iCloud Drive isn't set up yet" without making the user wonder why a
/// provider they expected is missing - except for `CloudStorage` siblings
/// which are listed only when present (one entry per installed account).
pub fn probe_cloud_folders(app: &tauri::AppHandle) -> Result<Vec<CloudFolderProbe>, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut out: Vec<CloudFolderProbe> = Vec::new();
    let current_default = load_settings(app)
        .ok()
        .and_then(|s| s.default_folder)
        .map(|p| canonicalize_or_self(Path::new(&p)));

    let push = |out: &mut Vec<CloudFolderProbe>, provider: &str, candidate: PathBuf| {
        let exists = candidate.is_dir();
        let canonical = canonicalize_or_self(&candidate);
        let is_default = current_default
            .as_ref()
            .map(|d| d == &canonical)
            .unwrap_or(false);
        let workspace_count = if exists {
            count_workspaces_shallow(&candidate)
        } else {
            0
        };
        out.push(CloudFolderProbe {
            provider: provider.to_string(),
            path: candidate.to_string_lossy().into_owned(),
            exists,
            is_default,
            workspace_count,
        });
    };

    if let Some(h) = home.as_ref() {
        push(
            &mut out,
            "iCloud Drive",
            h.join("Library/Mobile Documents/com~apple~CloudDocs/Budget"),
        );

        let cloud = h.join("Library/CloudStorage");
        if let Ok(read) = fs::read_dir(&cloud) {
            for dirent in read.flatten() {
                let name = dirent.file_name().to_string_lossy().to_string();
                let provider = if name.starts_with("GoogleDrive-") {
                    Some("Google Drive")
                } else if name.starts_with("Dropbox") {
                    Some("Dropbox")
                } else if name.starts_with("OneDrive-") || name == "OneDrive" {
                    Some("OneDrive")
                } else if name.starts_with("Box-") || name == "Box" {
                    Some("Box")
                } else {
                    None
                };
                if let Some(p) = provider {
                    let root = dirent.path();
                    let candidates = if p == "Google Drive" {
                        vec![root.join("My Drive/Budget"), root.join("Budget")]
                    } else {
                        vec![root.join("Budget")]
                    };
                    for c in candidates {
                        push(&mut out, p, c);
                    }
                }
            }
        }
    }

    Ok(out)
}

fn count_workspaces_shallow(folder: &Path) -> i64 {
    let mut n: i64 = 0;
    if let Ok(read) = fs::read_dir(folder) {
        for dirent in read.flatten() {
            let p = dirent.path();
            if p.is_file() && matches_workspace_extension(&p) {
                n += 1;
            }
        }
    }
    n
}

/// Copies every `.mimo` workspace (and a one-level `autosaves/` sibling)
/// from `source` into `dest` without deleting anything. Returns the count
/// of files actually copied so the UI can show a confirmation. We never
/// overwrite existing destinations - the user can resolve duplicates by
/// hand, since the alternative risks losing a divergent edit.
pub fn migrate_default_folder(source: &Path, dest: &Path) -> Result<i64, String> {
    if !source.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut copied: i64 = 0;
    let canonical_source = canonicalize_or_self(source);
    let canonical_dest = canonicalize_or_self(dest);
    if canonical_source == canonical_dest {
        return Ok(0);
    }
    if let Ok(read) = fs::read_dir(source) {
        for dirent in read.flatten() {
            let p = dirent.path();
            if !p.is_file() || !matches_workspace_extension(&p) {
                continue;
            }
            let name = match p.file_name() {
                Some(n) => n,
                None => continue,
            };
            let target = dest.join(name);
            if target.exists() {
                continue;
            }
            fs::copy(&p, &target).map_err(|e| e.to_string())?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// Walks the default folder for `.mimo` files and rebuilds the cached library.
/// Subdirectories are scanned shallowly (one level) so users can group years.
///
/// Encrypted files (which can't be probed without the password) are kept
/// in the index using their last-known cached metadata, with `encrypted`
/// flipped to `true` so the UI can show the lock badge and skip the
/// totals row. If we've never seen the file unlocked, a stub entry is
/// emitted with the filename so it still shows up in the library.
pub fn scan_library(app: &tauri::AppHandle) -> Result<Vec<LibraryEntry>, String> {
    let folder = ensure_default_folder(app)?;
    let cached = load_library_index(app).unwrap_or_default();
    let mut entries: Vec<LibraryEntry> = Vec::new();
    let mut visit = |path: PathBuf| {
        if !matches_workspace_extension(&path) {
            return;
        }
        if db::is_encrypted_at_path(&path) {
            entries.push(encrypted_entry(&path, &cached));
            return;
        }
        if let Ok(e) = read_library_entry(&path) {
            entries.push(e);
        }
    };
    if let Ok(read) = fs::read_dir(&folder) {
        for dirent in read.flatten() {
            let p = dirent.path();
            if p.is_file() {
                visit(p);
            } else if p.is_dir() {
                if p.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .as_deref()
                    == Some("autosaves")
                {
                    continue;
                }
                if let Ok(read2) = fs::read_dir(&p) {
                    for sub in read2.flatten() {
                        let sp = sub.path();
                        if sp.is_file() {
                            visit(sp);
                        }
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    save_library_index(app, &entries)?;
    Ok(entries)
}

fn encrypted_entry(path: &Path, cached: &[LibraryEntry]) -> LibraryEntry {
    let canonical = canonicalize_or_self(path);
    let metadata = fs::metadata(&canonical).ok();
    let last_modified = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let provider = detect_provider(&canonical);
    let is_conflict_copy = is_conflict_copy_path(&canonical);
    let prior = cached
        .iter()
        .find(|e| same_path(&e.path, &canonical.to_string_lossy()));
    if let Some(p) = prior {
        let mut next = p.clone();
        next.last_modified = last_modified;
        next.size_bytes = size_bytes;
        next.encrypted = true;
        next.provider = provider;
        next.is_conflict_copy = is_conflict_copy;
        return next;
    }
    let stub_label = canonical
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Locked budget")
        .to_string();
    LibraryEntry {
        path: canonical.to_string_lossy().into_owned(),
        year_label: stub_label,
        display_name: None,
        file_uuid: String::new(),
        last_modified,
        size_bytes,
        income_actual_cents: 0,
        expense_net_actual_cents: 0,
        net_actual_cents: 0,
        month_count: 0,
        tracked_month_count: 0,
        year_labels: Vec::new(),
        year_count: 0,
        encrypted: true,
        provider,
        is_conflict_copy,
        last_edited_at: None,
    }
}

/// Updates (or inserts) a single library entry by re-probing the file. Cheaper
/// than a full scan; called after Save / Save As / Open.
pub fn refresh_library_entry(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !matches_workspace_extension(path) {
        return Ok(());
    }
    let entry = read_library_entry(path)?;
    let mut entries = load_library_index(app)?;
    entries.retain(|e| !same_path(&e.path, &entry.path));
    entries.insert(0, entry);
    entries.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    save_library_index(app, &entries)
}

pub fn forget_library_entry(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let target = path.to_string_lossy().into_owned();
    let mut entries = load_library_index(app)?;
    entries.retain(|e| !same_path(&e.path, &target));
    save_library_index(app, &entries)
}

/// Renames a workspace file on disk and updates the cached library index
/// + recent-files list to point at the new path. The new basename is
/// sanitised (no path separators, no leading dot, max 120 chars). The
/// extension is always normalised to `.mimo` since that is the only
/// supported workspace format. Returns the canonical new path on
/// success. Errors out if the destination already exists - we never
/// overwrite blindly because a sibling file with the same name almost
/// always means the user has data in both.
pub fn rename_library_file(
    app: &tauri::AppHandle,
    old_path: &Path,
    new_basename: &str,
) -> Result<PathBuf, String> {
    if !old_path.is_file() {
        return Err(format!(
            "File not found: {}",
            old_path.to_string_lossy()
        ));
    }
    let cleaned = sanitize_basename(new_basename)?;
    let parent = old_path
        .parent()
        .ok_or_else(|| "File has no parent directory.".to_string())?;
    let mut new_path = parent.join(&cleaned);
    new_path.set_extension("mimo");

    let canonical_old = canonicalize_or_self(old_path);
    let canonical_new_target = canonicalize_or_self(&new_path);
    if canonical_old == canonical_new_target {
        return Ok(canonical_old);
    }
    if new_path.exists() {
        return Err(format!(
            "A file already exists at '{}'. Pick a different name.",
            new_path.display()
        ));
    }
    fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;

    let canonical_new = canonicalize_or_self(&new_path);
    let _ = update_recent_path(app, &canonical_old, &canonical_new);
    let _ = forget_library_entry(app, &canonical_old);
    let _ = refresh_library_entry(app, &canonical_new);
    Ok(canonical_new)
}

/// Permanently deletes a workspace file from disk and prunes it from
/// the library index and recent-files list. Caller is responsible for
/// confirming with the user before invoking - this function does not
/// move to the trash because the project doesn't ship a trash crate
/// dependency yet.
pub fn delete_library_file(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    let canonical = canonicalize_or_self(path);
    let _ = remove_recent_path(app, &canonical);
    forget_library_entry(app, &canonical)
}

fn sanitize_basename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Name cannot contain slashes.".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Name cannot start with a dot.".to_string());
    }
    if trimmed.len() > 120 {
        return Err("Name is too long (max 120 characters).".to_string());
    }
    // Strip an extension the user may have typed in - we re-append the
    // original below so the file type stays consistent.
    let stem = match Path::new(trimmed)
        .file_stem()
        .and_then(|s| s.to_str())
    {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return Err("Name is not valid.".to_string()),
    };
    Ok(stem)
}

fn update_recent_path(
    app: &tauri::AppHandle,
    old_path: &Path,
    new_path: &Path,
) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    let old_str = old_path.to_string_lossy().into_owned();
    let new_str = new_path.to_string_lossy().into_owned();
    let mut changed = false;
    for r in settings.recent_files.iter_mut() {
        if same_path(&r.path, &old_str) {
            r.path = new_str.clone();
            changed = true;
        }
    }
    if changed {
        save_settings(app, &settings)?;
    }
    Ok(())
}

fn remove_recent_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let mut settings = load_settings(app)?;
    let target = path.to_string_lossy().into_owned();
    let before = settings.recent_files.len();
    settings.recent_files.retain(|r| !same_path(&r.path, &target));
    if settings.recent_files.len() != before {
        save_settings(app, &settings)?;
    }
    Ok(())
}

fn matches_workspace_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("mimo"))
        .unwrap_or(false)
}

fn same_path(a: &str, b: &str) -> bool {
    let pa = canonicalize_or_self(Path::new(a));
    let pb = canonicalize_or_self(Path::new(b));
    pa == pb
}

pub fn canonicalize_or_self(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}
