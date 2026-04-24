import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default async function webHandler(request, response) {
  try {
    const { dispatchToHandler } = require("../diagnostic_engine/runtime/vercel-dispatch.js");
    const requestUrl = new URL(request.url, "http://localhost");
    const requestedPath = requestUrl.searchParams.get("path") || "/";
    return await dispatchToHandler(request, response, requestedPath);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify(
        {
          error: error.message || "web handler startup failed"
        },
        null,
        2
      )
    );
  }
}
