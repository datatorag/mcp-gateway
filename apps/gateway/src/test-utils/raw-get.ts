import { request } from "node:http";

/**
 * A GET whose path goes on the wire exactly as written. `fetch` tidies a
 * request target before sending it (dot segments, some escapes), which is
 * the very thing a test of an odd spelling needs not to happen.
 */
export function rawGet(base: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    const req = request({ hostname, port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
