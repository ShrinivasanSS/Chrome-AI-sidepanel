# AI generated notes 
Use this section for reducing repeated searches.

## March 1 2026

- `chrome.sidePanel.open()` is still constrained by user-gesture rules, so API requests triggered from regular pages should not rely on opening the panel programmatically. Processing was moved into the service worker and the side panel now acts as a viewer for the current API session and stored history.
- For "storage in the extension's own directory", the workable MV3 interpretation is extension-owned browser storage:
  - `IndexedDB` for conversation history
  - `chrome.storage.local` for settings, current API session, and storage metrics
- ZIP support was implemented without adding a bundler. A lightweight local ZIP reader is enough for the sample archive because it only needs central-directory parsing plus support for:
  - `store` compression (`method 0`)
  - `deflate` compression (`method 8`) via `DecompressionStream('deflate-raw')`
- Unsupported ZIP entries are ignored and surfaced as warnings instead of hard failures, matching the Todo requirement.
- The repo previously referenced `tests/vanila-html/example-math-input.json` from the IDE context, but that file did not exist. A local copy was added to the `vanila-html` folder to keep the sample area self-contained.
- The compose test harness uses a single nginx gateway with path-prefix stripping:
  - `/vanilla/` -> static nginx service
  - `/jsp/` -> Tomcat/JSP service
- The vanilla page needed URL resolution based on `window.location.href`; parent-relative asset paths were brittle once the page moved behind `/vanilla/`.
- Shared test assets are mounted read-only from `tests/example-inputs` into the compose services so future test apps can reuse the same sample files without rebuilding images.
- Docker bind mounts should not overlap on nested paths. Mounting `tests/vanila-html` to `/usr/share/nginx/html` and then trying to mount `tests/example-inputs` inside `/usr/share/nginx/html/example-inputs` causes container startup failure. The working pattern is:
  - mount app content at `/usr/share/nginx/html`
  - mount shared assets at a separate path such as `/opt/example-inputs`
  - expose the asset URL path with nginx `alias`
- Current compose entrypoint in the repo is `http://localhost:9090/`, not `8080`.
- As of the latest human review, the planned feature set is complete. Testing remains active and follow-up bugs will be documented separately instead of being mixed into the completed implementation notes.
