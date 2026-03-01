<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyze JSON</title>
  <link rel="stylesheet" href="./assets/style.css">
</head>
<body>
  <div class="page-shell">
    <div class="hero">
      <h1>Analyze JSON</h1>
      <p class="muted">Optional page for the structured JSON sample.</p>
      <div class="nav">
        <a href="./index.jsp" class="secondary">Home</a>
        <button onclick="JspSidepanelDemo.sendJsonRequest()">Send JSON Request</button>
      </div>
    </div>

    <div class="grid">
      <div class="panel">
        <h2>Status</h2>
        <div id="json-status" class="status">Waiting for request.</div>
        <pre id="json-log"></pre>
      </div>
      <div class="panel">
        <h2>Results</h2>
        <div id="json-results" class="muted">No results yet.</div>
      </div>
    </div>
  </div>

  <script src="./assets/app.js"></script>
  <script>
    JspSidepanelDemo.createView('json');
  </script>
</body>
</html>
