const { buildConfig, loadEnvFile } = require("./config");
const { createServer, createServices } = require("../http/routes");
const { loadRegistry } = require("../core/registry/loader");
const { loadAndValidateRegistry } = require("../core/registry/validate");

async function main() {
  loadEnvFile();
  const config = buildConfig();
  loadAndValidateRegistry();
  const registry = loadRegistry();
  const services = await createServices({ registry, config });
  const server = createServer(services);

  server.listen(config.port, () => {
    console.log(`Diagnostic engine listening on http://localhost:${config.port} using ${services.store.kind} storage`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
