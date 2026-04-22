const { dispatchToHandler } = require("../../lib/vercel-dispatch");

module.exports = async function getSessionHandler(request, response) {
  return dispatchToHandler(request, response);
};
