// The canary: a surface that does nothing (SCRUM-394).
//
// It answers /health with the commit it was built from and the time it
// started, and that is all it does. It exists so the deploy pipeline can be
// proven, and a host-script change rehearsed, without restarting anything a
// user touches. It reads no secret, opens no outbound connection and writes
// no file.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export function createCanary({ sha = "", startedAt = new Date() } = {}) {
  const body = JSON.stringify({
    status: "ok",
    surface: "canary",
    // Empty is honest: an image built without a commit says so, never a guess.
    sha: sha || null,
    startedAt: startedAt.toISOString(),
  });
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CANARY_PORT || 8080);
  const server = createCanary({ sha: process.env.CANARY_SHA });
  server.listen(port, () => console.log(`canary listening on ${port}`));
  // PID 1 gets no default signal handling, so stop when asked.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
