# Budget

Local-first desktop budget app (Tauri 2 + React + SQLite). USD amounts are stored as integer cents; the main grid uses rounded dollars and line detail shows exact cents.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (for the Tauri backend)
- [Node.js](https://nodejs.org/) 18+

## Development

```bash
npm install
npm run tauri dev
```

## Build (release)

```bash
npm run tauri build
```

## Data

The SQLite database lives under your OS app data directory, e.g. on macOS:

`~/Library/Application Support/com.bziegs.budget-app/budget.sqlite3`

The app footer shows the resolved path at runtime.
