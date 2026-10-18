// Capture executable declarations, not Swagger summaries. Run before migrating.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(process.argv[2] || '../bck-v0');
const output = path.resolve(process.argv[3] || 'test/compatibility/v0-contract.json');
const files = fs.readdirSync(path.join(root, 'src/modules'), { recursive: true })
  .filter((file) => file.endsWith('.controller.ts')).sort();
const endpoints = [];
const sources = {};
function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [])
    .map((d) => d.expression).filter(ts.isCallExpression);
}
for (const file of files) {
  const relative = `src/modules/${file}`;
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  sources[relative] = crypto.createHash('sha256').update(text).digest('hex');
  for (const cls of source.statements.filter(ts.isClassDeclaration)) {
    const controller = decorators(cls).find((d) => d.expression.getText(source) === 'Controller');
    if (!controller) continue;
    const prefix = controller.arguments[0]?.text || '';
    for (const method of cls.members.filter(ts.isMethodDeclaration)) {
      const ds = decorators(method);
      const route = ds.find((d) => /^(Get|Post|Put|Patch|Delete|Head|Options|All)$/.test(d.expression.getText(source)));
      if (!route) continue;
      const verb = route.expression.getText(source).toUpperCase();
      const code = ds.find((d) => d.expression.getText(source) === 'HttpCode');
      const authorization = ds.find((d) => d.expression.getText(source) === 'Authorization');
      endpoints.push({
        method: verb,
        path: '/' + ['api', prefix, route.arguments[0]?.text || ''].filter(Boolean).join('/').replace(/\/+/g, '/'),
        controller: cls.name.text,
        handler: method.name.getText(source),
        source: relative,
        line: source.getLineAndCharacterOfPosition(method.getStart(source)).line + 1,
        status: code?.arguments[0]?.getText(source) || (verb === 'POST' ? '201' : '200'),
        public: ds.some((d) => d.expression.getText(source) === 'Unauthenticated'),
        authorization: authorization?.arguments[0]?.getText(source) || null,
        parameters: method.parameters.map((p) => p.getText(source)),
        implementation: method.body?.getText(source),
      });
    }
  }
}
fs.writeFileSync(output, JSON.stringify({ sources, endpoints }, null, 2) + '\n');
console.log(`Captured ${endpoints.length} endpoints from ${files.length} controllers: ${output}`);
