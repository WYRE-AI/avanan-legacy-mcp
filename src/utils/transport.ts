/**
 * Minimal HTTPS transport.
 *
 * Exists because the SmartAPI takes list filters such as scrollId in a JSON
 * body on GET requests (see Check Point's reference client.py), and the WHATWG
 * fetch API refuses to send a body with GET.
 */

import { request } from "node:https";

export interface HttpRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export function httpRequest(opts: HttpRequestOptions): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const headers = { ...opts.headers };
  if (opts.body !== undefined) headers["content-length"] = String(Buffer.byteLength(opts.body));

  return new Promise((resolve, reject) => {
    const req = request(opts.url, { method: opts.method, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("timeout", () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
