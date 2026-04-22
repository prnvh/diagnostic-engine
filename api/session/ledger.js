const { dispatchToHandler } = require("../../lib/vercel-dispatch");

module.exports = async function ledgerHandler(request, response) {
  return dispatchToHandler(request, response);
};
