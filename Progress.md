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
