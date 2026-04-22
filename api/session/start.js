const { dispatchToHandler } = require("../../lib/vercel-dispatch");

module.exports = async function startSessionHandler(request, response) {
  return dispatchToHandler(request, response, "/api/session/start");
};
