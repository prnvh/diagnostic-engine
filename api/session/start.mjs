import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dispatchToHandler } = require("../../lib/vercel-dispatch.js");

export default async function startSessionHandler(request, response) {
  return dispatchToHandler(request, response, "/api/session/start");
}
