<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyze ZIP</title>
  <link rel="stylesheet" href="./assets/style.css">
</head>
<body>
  <div class="page-shell">
    <div class="hero">
      <h1>Analyze ZIP</h1>
      <p class="muted">Uses `tests/example-inputs/zip/sample-json-screenshots.zip`, which contains both JSON and screenshot folders.</p>
      <div class="nav">
        <a href="./index.jsp" class="secondary">Home</a>
        <button onclick="JspSidepanelDemo.sendZipRequest()">Send ZIP Request</button>
      </div>
    </div>

    <div class="grid">
      <div class="panel">
        <h2>Status</h2>
        <div id="zip-status" class="status">Waiting for request.</div>
        <pre id="zip-log"></pre>
      </div>
      <div class="panel">
        <h2>Results</h2>
        <div id="zip-results" class="muted">No results yet.</div>
      </div>
    </div>
  </div>

  <script src="./assets/app.js"></script>
  <script>
    JspSidepanelDemo.createView('zip');
  </script>
</body>
</html>
