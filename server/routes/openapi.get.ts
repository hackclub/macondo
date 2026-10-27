export default defineEventHandler((event) => {
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Macondo Public API</title>
    <style>
      body { margin: 0; background: #f6e4cf; }
      .topbar {
        font-family: ui-sans-serif, system-ui, sans-serif;
        padding: 12px 16px;
        background: #684d3a;
        color: #f6e4cf;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
      }
      .topbar a { color: #f6e4cf; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div>Macondo Public API</div>
      <a href="/api/openapi.json">Raw OpenAPI JSON</a>
    </div>
    <redoc spec-url="/api/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
});
