<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Sidepanel JSP Demo</title>
  <link rel="stylesheet" href="./assets/style.css">
</head>
<body>
  <div class="page-shell">
    <div class="hero">
      <h1>AI Sidepanel JSP Demo</h1>
      <p class="muted">This sample container app exercises the extension’s external-page API with repository sample files.</p>
      <div class="nav">
        <a href="./analyze-photos.jsp">Analyze Photos</a>
        <a href="./analyze-zip.jsp">Analyze ZIP</a>
        <a href="./analyze-json.jsp" class="secondary">Analyze JSON</a>
      </div>
    </div>

    <div class="panel">
      <h2>Included pages</h2>
      <ul>
        <li><strong>Analyze Photos</strong> sends the screenshot samples as base64 images.</li>
        <li><strong>Analyze ZIP</strong> sends the ZIP sample containing JSON and screenshots.</li>
        <li><strong>Analyze JSON</strong> sends the structured math JSON sample.</li>
      </ul>
    </div>
  </div>
</body>
</html>
