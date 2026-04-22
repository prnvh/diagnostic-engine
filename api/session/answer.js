const { dispatchToHandler } = require("../../lib/vercel-dispatch");

module.exports = async function answerSessionHandler(request, response) {
  return dispatchToHandler(request, response, "/api/session/answer");
};
