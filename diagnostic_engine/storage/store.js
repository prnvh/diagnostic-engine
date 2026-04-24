const { createFileStore } = require("./file-store");
const { createSupabaseStore } = require("./supabase-store");

async function createStore(config) {
  if (config.storeDriver === "supabase") {
    return createSupabaseStore(config);
  }

  if (config.storeDriver === "file") {
    return createFileStore(config.dataDir);
  }

  throw new Error(`Unsupported store driver: ${config.storeDriver}`);
}

module.exports = {
  createStore
};
