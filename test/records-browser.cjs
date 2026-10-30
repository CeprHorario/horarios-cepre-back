// Test-only Node 24 runner: transpile local TS with the already-installed compiler.
const { registerHooks } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ts = require('typescript');
const root = pathToFileURL(resolve(__dirname, '..') + '/').href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [alias, directory] of [
      ['@database/', 'src/database/'],
      ['@modules/', 'src/modules/'],
    ])
      if (specifier.startsWith(alias))
        specifier = fileURLToPath(
          new URL(directory + specifier.slice(alias.length), root),
        );
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        for (const suffix of ['.ts', '/index.ts']) {
          const url = new URL(specifier + suffix, context.parentURL);
          if (url.href.startsWith(root) && existsSync(url))
            return { url: url.href, format: 'commonjs', shortCircuit: true };
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (
      !url.startsWith(root) ||
      !url.endsWith('.ts') ||
      url.includes('/node_modules/')
    )
      return nextLoad(url, context);
    return {
      format: 'commonjs',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      }).outputText,
    };
  },
});

async function main() {
  const {
    createRecordsBrowserHarness,
  } = require('./helpers/records-browser-harness.ts');
  const harness = await createRecordsBrowserHarness();
  try {
    await harness.app.listen(3000, '0.0.0.0');
  } catch (error) {
    await harness.close();
    throw error;
  }
  const stop = () => {
    void harness.close().catch(fail);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.info(
    'Harness listo (solo publicación Docker 127.0.0.1:3000):',
    JSON.stringify(harness.manifest),
  );
}
function fail(error) {
  console.error('Harness:', error instanceof Error ? error.message : 'error');
  process.exitCode = 1;
}
void main().catch(fail);
