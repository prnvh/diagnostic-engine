import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default async function ledgerHandler(request, response) {
  try {
    const { dispatchToHandler } = require("../../diagnostic_engine/runtime/vercel-dispatch.js");
    return await dispatchToHandler(request, response);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify(
        {
          error: error.message || "session ledger handler startup failed"
        },
        null,
        2
      )
    );
  }
}
