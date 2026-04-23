import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default async function answerSessionHandler(request, response) {
  try {
    const { dispatchToHandler } = require("../../lib/vercel-dispatch.js");
    return await dispatchToHandler(request, response, "/api/session/answer");
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify(
        {
          error: error.message || "session answer handler startup failed"
        },
        null,
        2
      )
    );
  }
}
