import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, request, type Server } from "node:http";
import { createApp, defineEventHandler, readRawBody, toNodeListener } from "h3";
import { limitRequestBody } from "./request-body";

let server: Server;
let port: number;
beforeAll(async () => {
  const app = createApp();
  app.use(defineEventHandler(async (event) => {
    await limitRequestBody(event, 64, 500);
    return { raw: await readRawBody(event) };
  }));
  server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

function post(chunks: string[], headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe("bounded HTTP request bodies", () => {
  test("preserves exact bytes for webhook signatures and subsequent h3 reads", async () => {
    const raw = '{ "message": "café" }\n';
    const result = await post([raw], { "content-length": String(Buffer.byteLength(raw)) });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).raw).toBe(raw);
  });
  test("rejects declared oversize bodies", async () => {
    expect((await post(["a".repeat(65)], { "content-length": "65" })).status).toBe(413);
  });
  test("counts actual bytes in chunked bodies without Content-Length", async () => {
    expect((await post(["a".repeat(32), "b".repeat(33)])).status).toBe(413);
  });
  test("allows a chunked body exactly at the limit", async () => {
    const result = await post(["a".repeat(32), "b".repeat(32)]);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).raw).toHaveLength(64);
  });
});
