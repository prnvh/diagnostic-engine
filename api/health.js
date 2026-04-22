const { dispatchToHandler } = require("../lib/vercel-dispatch");

module.exports = async function healthHandler(request, response) {
  return dispatchToHandler(request, response, "/api/health");
};
