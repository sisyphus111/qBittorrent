# Ice WebUI

This Vue 3 and TypeScript application is the built-in WebUI for this local
qBittorrent build. It uses the existing authenticated Web API directly. CMake
builds its assets and embeds the same application entry point for both the
login screen and the authenticated workspace.

## Build

Node.js 20.19+ or 22.12+ and npm must be on PATH when configuring and building
qBittorrent with `WEBUI=ON`. CMake installs the locked npm dependencies and
rebuilds the frontend when its sources change. No separate Node.js server is
needed in production; the qBittorrent system service serves the compiled UI.

For frontend-only validation, run from this directory:

```sh
npm ci
npm run check
npm run build
```

## Development

```sh
npm run dev
```

The development server binds to `127.0.0.1:5173` and proxies API calls to the
local qBittorrent WebUI on port 8080. It uses the real backend; operations in
the development UI affect that instance. Credentials are never bundled into
the application. Light/dark preference is stored in the browser and defaults
to the system color scheme on first visit.

Components cover the download workspace, torrent details and priorities,
URL/file submission, preferences, search plugins/results, RSS feeds and logs.
Legacy resources remain embedded for compatibility, but neither application
entry point loads the old frontend or its layout library.

## Storage discovery and capacity planning

Storage choices come from the authenticated `app/storageInfo` API. The backend
scans immediate directories and mounted filesystems beneath `/mnt`; mounting a
new disk there makes it available after the next refresh, without rebuilding the
frontend. Unmounted and read-only locations are displayed but cannot be selected.
The scan root and snapshot logic live in `src/webui/api/storageinfo.cpp`.

Capacity is sampled from filesystem counters, without recursively traversing
user files. A shared asynchronous cache expires after 3 seconds across clients. The frontend
polls approximately every 4 seconds (30 in the background), with short follow-up
requests while a sample is in progress. Task mutations request `force=true` to
bypass the cache; overlapping requests coalesce into a subsequent scan. The
overview and save-path picker share the same snapshot. The API returns
`refreshing` while a sample is being collected; clients retain the prior sample.
On Unix, filesystem device IDs group bind mounts and other shared-capacity paths.

The capacity bar has three segments:

- **Occupied:** physical used space plus filesystem-reserved space unavailable to
  this user. The label explicitly includes reservations when present.
- **Expected additional allocation:** selected torrent bytes minus completed
  bytes, including stopped and queued torrents. Deselected files are excluded.
- **Expected remaining:** writable available space minus expected allocation,
  clamped at zero. A separate shortfall reports overcommit without overflowing
  the bar.

Tasks without metadata and tasks currently checking or moving are reported as
uncertain and excluded until their counters settle. Cross-filesystem temporary
storage reserves the remaining data on the source and a complete selected copy
at the destination; space reclaimed by later deletion is not credited. These are
conservative estimates: preallocation, shared files, compression, unrelated disk
writes, and filesystem overhead can affect the eventual physical allocation.
Unsubmitted magnets/files are not part of the forecast.

The frontend submits the selected `storageRoot` with new torrents. The backend
checks that it is still mounted and writable before accepting the request, so a
stale selector does not silently choose an unmounted directory. Other API clients
retain the existing behavior when this optional parameter is omitted.

Capacity segment checks can be run with Node.js 24:

```sh
node --test tests/capacity.test.mjs
```

The task list uses incremental sync every second while visible, every 15 seconds
in the background, and immediately after task operations or network/visibility
recovery. Failures back off automatically. Refreshes retain row order, selection,
scroll position, and draft inputs; explicit sorting or membership changes reorder
the list. Storage panels use 300px columns (up to two per row) on desktop.
Task details refresh every 5 seconds while visible. Logs refresh every 5 seconds
(30 in the background) with error backoff; RSS reads server-side feed data every
8 seconds while visible. These views refresh on visibility/network recovery and
no longer expose manual refresh controls. RSS source fetching remains governed
by the server's RSS schedule.

Task-table column separators support pointer resizing and keyboard adjustment
(Left/Right, Shift for larger steps, Home for minimum width). Double-clicking a
separator resets all widths; Escape cancels an in-progress drag. Widths are saved
under `qbt-torrent-column-widths-v1` in browser local storage. Resizing preserves
sort order and live updates. Narrow layouts retain all columns in a horizontally
scrolling table. Alternating row backgrounds yield to hover and selection colors.
