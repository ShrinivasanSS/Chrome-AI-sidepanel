# Tracking feature requests and progress. 

The features given by human, will be noted by Ai to track the progress. Once the AI has updated the progress, a human would verify the results and update here. 

## Date - 01/Mar/2026

### Human Review comments 

Tested functionalities
- [x] Test Pages for Vanila and JSP 
- [x] Accepts Photos, Zip and JSON
- [x] Responses rendered in the test pages to satisfaction
- [x] Planned feature set from `Todo.md` is considered complete

Bugs found
- [ ] Extension view not refreshed automatically. It loads the responses only when closing and re-opening the side panel. 

Testing status
- Testing is ongoing
- Additional bugs will be filed separately with detailed analysis and fix notes later

### AI generated updates

#### Proposed checklist for Todo.md implementation

Reference baseline:
- Existing project pattern: `reference-extension-samples/functional-samples/cookbook.sidepanel-global`
- User-gesture/opening behavior constraint: `reference-extension-samples/functional-samples/cookbook.sidepanel-open`

Assumptions for implementation:
- "Storage in the extension's own directory" will be implemented as extension-owned local persistence, not writes into the unpacked source folder. Planned split is: conversation payload history in IndexedDB, lightweight settings/usage metadata in `chrome.storage.local`.
- Optional Todo items will stay out of the first pass unless human review asks to include them now.
- Unsupported uploaded entries inside ZIP payloads will be skipped without failing the full request, matching the Todo note.

Planned work items:
- [x] Add a normalized request ingestion layer in `ai-sidepanel` so advanced mode and API mode both accept JSON, image payloads, base64 image payloads, and ZIP payloads.
- [x] Parse ZIP uploads locally in the extension, extract supported JSON/text/image files, and convert them into OpenAI-compatible `messages` content blocks with text in `text` segments and images in `image_url` segments.
- [x] Preserve current JSON request compatibility while relaxing validation to ignore unsupported file entries instead of throwing.
- [x] Refactor AI request assembly so the side panel can submit multimodal payloads from a single shared pipeline.
- [x] Add persistent conversation/output history storage using extension-local persistence and track estimated storage usage separately.
- [x] Expand settings to support multiple configured models, a selectable default model, a storage-usage display, and a "Clean Storage" action.
- [x] Update side panel UI to surface stored history and keep API/basic/advanced flows working with the new persistence model.
- [x] Update `tests/vanila-html` to send the new payload shapes and render returned results for JSON, image, and ZIP-based requests.
- [x] Create a containerized sample JSP app under `tests` with at least `Analyze Photos` and `Analyze Zip` pages wired to the extension API, using the sample assets already present in `tests/example-inputs`.
- [x] Update `ai-sidepanel/README.md` with the new request formats, storage behavior, settings options, and test-page/JSP usage notes.
- [x] Add implementation findings and non-obvious Chrome extension constraints to `Agent-Notes.md`.

Status:
- Implementation completed by AI on 01/Mar/2026.
- Human review confirms the requested feature set is complete.
- Testing is ongoing for follow-up bug discovery.
- No test command was run by the AI, per repo instruction.

#### Compose test harness updates

- [x] Add a single compose project under `tests/` with `gateway`, `vanilla`, and `jsp` services.
- [x] Add a front-door nginx gateway with path-based routing for `/`, `/vanilla/`, and `/jsp/`.
- [x] Serve the vanilla test app through a dedicated nginx service with shared read-only mounts for `tests/example-inputs`.
- [x] Adapt the JSP container workflow so shared test assets are mounted by compose instead of duplicated per service image.
- [x] Update the vanilla page asset resolution so it works correctly when served from `http://localhost:8080/vanilla/`.
- [x] Update test documentation for the compose-based workflow.

Compose harness status:
- Implementation completed by AI on 01/Mar/2026.
- Human verification confirms the compose harness is usable for current test flows.
- Testing is ongoing and additional bug reports will be documented later.
- The AI did not run `docker compose` or any package test command, per repo instruction.

## Date - 19/Mar/2026

### AI generated updates

#### Proposed checklist for latest Todo.md implementation (Skills + Modes)

Reference baseline:
- `reference-extension-samples/functional-samples/cookbook.sidepanel-global`
- `reference-extension-samples/functional-samples/cookbook.sidepanel-open`

Assumptions/defaults:
- Hybrid skills source: repository endpoint + ZIP build endpoint.
- Default ZIP endpoint: `http://localhost/skills/latest.zip`.
- Skills refresh cadence: startup + every 15 minutes.
- User mode hides `Advanced` and `API` tabs but keeps basic chat, settings, and history.
- API/event processing remains active in background for both extension modes.

Planned work items:
- [x] Add `SkillsManager` and integrate it into request lifecycle so relevant skills are injected into agent/system context.
- [x] Add repository + ZIP loaders for skills, with lenient `SKILL.md` parsing and deterministic dedupe (ZIP overrides repository on name collisions).
- [x] Persist runtime skills catalog/state (`skillsConfig`, `skillsState`) and expose status for UI.
- [x] Add periodic refresh scheduling (startup + `chrome.alarms` every 15 minutes) and preserve last-good catalog when a refresh fails.
- [x] Extend settings page to configure `extensionMode` (`developer|user`) and skills source/update options, including manual refresh action.
- [x] Gate sidepanel UI by extension mode: Developer shows `Basic/Advanced/API`; User shows only basic flow plus settings/history.
- [x] Keep external page API integration events unchanged (`ai-sidepanel-api-call`, `ai-sidepanel-response`, `ai-sidepanel-status`).
- [x] Update `ai-sidepanel/README.md` for skills support + mode behavior.
- [x] Add non-obvious implementation findings to `Agent-Notes.md`.

Status:
- Implementation completed by AI on 19/Mar/2026.
- No automated test command will be run by AI, per repo instruction.

#### Follow-up update - Repository `.skill` format

Requested change:
- Switch skills repository ingestion to directory-style `.skill` packages (`repositoryUrl/*.skill`).
- Remove separate skills ZIP source config.
- Add UI controls to enable/disable discovered skills individually, plus enable-all/disable-all.

Completed:
- [x] Refactor repository loader to discover `.skill` links from repository listing and parse each zip package for `SKILL.md`.
- [x] Remove ZIP source settings from config and UI.
- [x] Add per-skill toggles in settings (with enable-all/disable-all), persisted via `skillsConfig.disabledSkillNames`.
- [x] Apply only enabled skills during request-time skill selection.
- [x] Update `ai-sidepanel/README.md` to document `.skill` repository layout.

#### Follow-up update - Skill Runner backend

Requested change:
- Add runner backend options: Claude / Copilot CLI / Cursor.
- Add local vs remote runner mode and bypass API when runner backend is selected.
- In User mode basic flow, pass page cookies and page data via prompt contract.

Completed:
- [x] Add `runnerConfig` settings schema (`processingTarget`, `runnerType`, `runnerMode`, `remoteUrl`, `nativeHostName`, `timeoutMs`).
- [x] Extend settings UI with processing backend and runner configuration controls.
- [x] Add service worker runner execution path that bypasses API when `processingTarget=skill-runner`.
- [x] Implement remote runner HTTP invocation and local runner native-messaging invocation.
- [x] Include page cookies/page data in basic prompt context and forward to runner using `promptArg: --prompt`.
- [x] Update `README.md` with skill-runner integration flow and prerequisites.

#### Follow-up update - `skill-launcher` app

Requested change:
- Create a launcher app in `skill-launcher/` compatible with extension runner design.
- Support running as remote service and local-native host.
- Receive config, update/sync skills in backend, run runner, return output to extension.

Completed:
- [x] Add `skill-launcher/app.py` entrypoint with `--mode remote|native`.
- [x] Add shared launcher core to sync `.skill` packages from repository and execute CLI runner commands.
- [x] Add remote HTTP endpoints (`/run`, `/update-skills`, `/health`).
- [x] Add Native Messaging loop compatible with `chrome.runtime.sendNativeMessage`.
- [x] Update extension runner payload to include `skillsConfig` and selected-skill context.
- [x] Add launcher docs in `skill-launcher/README.md`.

#### Follow-up update - Local runner folders and workdir

Requested change:
- Use local runner-specific skill folders within `skill-launcher` root.
- Run CLI commands in launcher working directory.

Completed:
- [x] Sync skills into `skill-launcher/.claude/skills`, `skill-launcher/.copilot/skills`, and `skill-launcher/.cursor/skills`.
- [x] Store runner state next to each runner folder (`skills-state.json`).
- [x] Execute runner commands with `cwd=skill-launcher` root.
- [x] Update launcher docs and ignore generated local runner folders in `.gitignore`.

#### Follow-up update - Runner prompt args and prompt content

Requested change:
- Runner-specific prompt arguments (`claude --print`, `copilot --prompt`, `cursor agent -p`).
- Do not embed full skill content into runner prompt when skills are already synced.

Completed:
- [x] Update launcher command templates for Claude/Copilot/Cursor.
- [x] Update extension runner payload to send runner-appropriate `promptArg`.
- [x] Use base agent prompt for runner flow (no injected skill body), while keeping selected skill metadata in context.

#### Follow-up update - Include Active Tab Content toggle

Requested change:
- Add option in sidepanel Basic/Advanced input flow to include active tab content or not.
- Default should be disabled.

Completed:
- [x] Add `Include Active Tab Content` toggle in sidepanel UI (default OFF).
- [x] Persist toggle state in `chrome.storage.local` (`includeTabContent`).
- [x] Basic mode: when ON, capture and include active tab context; when OFF, send only typed prompt.
- [x] Advanced mode: when ON, enrich tasks with active tab content and metadata; when OFF, send JSON as-is.
