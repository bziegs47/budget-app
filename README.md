# mimo

**mimo** — Money In, Money Out. A local-first desktop budget app (Tauri 2 + React + SQLite) for macOS.

USD amounts are stored as integer cents. The main grid shows rounded dollars and line detail shows exact cents.

**Repository:** [github.com/bziegs47/budget-app](https://github.com/bziegs47/budget-app)

## Files

mimo workspaces are saved as `.mimo` files (each file holds one or more years). Older `.budget` files are still openable for backward compatibility. By default they live in `~/Documents/Budget/` — you can change the default folder in app settings.

## Git workflow

This folder is the working copy; `origin` points at GitHub. Before starting work: `git pull --rebase`. After a meaningful change set: `git add -A`, `git commit -m "…"`, `git push`.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (for the Tauri backend)
- [Node.js](https://nodejs.org/) 18+

## Development

```bash
npm install
npm run tauri dev
```

If you see **`cargo metadata` … No such file or directory**, the shell does not have Cargo on `PATH` (common right after installing Rust or in a terminal that was opened before Rust). In that terminal run:

```bash
source "$HOME/.cargo/env"
```

Or restart the terminal / Cursor so `~/.cargo/bin` is loaded, then confirm with `which cargo`.

## Build (release)

```bash
npm run tauri build
```

## Internal data

Default scratch workspace and app metadata live under your OS app data directory, e.g. on macOS:

`~/Library/Application Support/com.bziegs.mimo/budget.sqlite3`

The app footer shows the resolved path at runtime.
