import { createServer } from "node:http";
import { Readable } from "node:stream";
import worker from "../dist/server/index.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const origin = "http://localhost";

const server = createServer({ requestTimeout: 10_000, headersTimeout: 5000 }, async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
      outgoing.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid request");
      return;
    }
    const headers = new Headers(incoming.headers);
    headers.set("CF-Connecting-IP", incoming.socket.remoteAddress ?? "loopback");
    const response = await worker.fetch(new Request(origin + incoming.url, {
      method: incoming.method,
      headers,
    }), { WEATHER_CONTACT: process.env.WEATHER_CONTACT });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) outgoing.end();
    else {
      const stream = Readable.fromWeb(response.body);
      stream.on("error", () => outgoing.destroy());
      outgoing.on("close", () => stream.destroy());
      stream.pipe(outgoing);
    }
  } catch {
    if (outgoing.headersSent) outgoing.destroy();
    else outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Request could not be served");
  }
});
server.listen(port, host, () => console.log(`Skylens listening at http://${host}:${server.address().port}`));
