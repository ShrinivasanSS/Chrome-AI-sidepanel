# Test plan

This document stores the details of the test plans.

## Docker compose harness

The preferred local test environment is now the compose project in `tests/docker-compose.yml`.

Startup:

```bash
docker compose -f tests/docker-compose.yml up --build
```

Published entrypoint:

- `http://localhost:9090/`

Available apps through the gateway:

- `http://localhost:9090/vanilla/`
- `http://localhost:9090/jsp/`

Compose services:

- `gateway`: front-door nginx reverse proxy
- `vanilla`: static nginx service for `tests/vanila-html`
- `jsp`: Tomcat/JSP sample app from `tests/jsp-sidepanel-sample`

Shared sample data:

- `tests/example-inputs` is mounted read-only into the app containers

Future service pattern:

1. Add a new service to `tests/docker-compose.yml`
2. Mount `tests/example-inputs` if the service needs shared sample data
3. Add a new route in `tests/test-gateway/nginx.conf`
4. Add a new card/link in `tests/test-gateway/index.html`

## Vanilla HTML test page

The main browser test page is `tests/vanila-html/api-test-page.html`.

It now covers:

- Legacy JSON request submission
- Base64 image submission using the sample screenshots
- ZIP submission using `sample-json-screenshots.zip`
- In-page rendering of extension progress and final results through `ai-sidepanel-status` and `ai-sidepanel-response`

Supporting sample files:

- `tests/vanila-html/example-math-input.json`
- `tests/example-inputs/json/example-input.json`
- `tests/example-inputs/zip/sample-json-screenshots.zip`

## JSP sample app

Containerized JSP demo source:

- `tests/jsp-sidepanel-sample/Dockerfile`
- `tests/jsp-sidepanel-sample/webapp/index.jsp`
- `tests/jsp-sidepanel-sample/webapp/analyze-photos.jsp`
- `tests/jsp-sidepanel-sample/webapp/analyze-zip.jsp`
- `tests/jsp-sidepanel-sample/webapp/analyze-json.jsp`

Recommended human verification:

1. Reload the unpacked extension after the manifest and script changes.
2. Start the compose harness with `docker compose -f tests/docker-compose.yml up --build`.
3. Save API settings and verify the configured default model appears in the side panel.
4. Use `http://localhost:9090/vanilla/` to run the JSON, Photos, and ZIP requests.
5. Confirm results appear in both the page and the extension API/history views.
6. Open `http://localhost:9090/jsp/` and repeat the Photos and ZIP flows.
7. Confirm storage usage updates in settings and `Clean Storage` removes conversation history.

Current project state:

- The planned feature set is complete.
- Testing is ongoing.
- Any new bugs should be documented separately with reproduction steps and analysis notes.
