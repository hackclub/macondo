import { createError, getHeader, setResponseHeader, type H3Event } from "h3";

// h3 v1 otherwise buffers the entire request before parsing JSON/multipart.
// Cache the bounded raw bytes so webhook signatures and h3 parsers see the
// exact original body. Count actual bytes, including chunked requests.
export async function limitRequestBody(event: H3Event, maxBytes: number, timeoutMs = 15_000): Promise<void> {
  const req = event.node.req;
  const rejectBody = (statusCode: number) => {
    req.pause();
    setResponseHeader(event, "connection", "close");
    return createError({ statusCode, statusMessage: statusCode === 413 ? "Request body too large" : "Request body timed out" });
  };
  const length = getHeader(event, "content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw rejectBody(413);

  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) return fail(rejectBody(413));
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = (error: Error) => fail(error);
    const onAborted = () => fail(createError({ statusCode: 400, statusMessage: "Request aborted" }));
    const timer = setTimeout(() => fail(rejectBody(408)), timeoutMs);
    req.on("data", onData).once("end", onEnd).once("error", onError).once("aborted", onAborted);
    if (req.readableEnded) onEnd();
  });
  event._requestBody = new Uint8Array(body);
}
