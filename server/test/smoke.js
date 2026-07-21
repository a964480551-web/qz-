const assert = require("node:assert/strict");

for (const key of ["JWT_SECRET", "ADMIN_INIT_ACCOUNT", "ADMIN_INIT_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`测试缺少环境变量：${key}`);
}

const { app, initDb } = require("../src/index");

async function main() {
  await initDb();
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/staff-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: process.env.ADMIN_INIT_ACCOUNT,
        password: process.env.ADMIN_INIT_PASSWORD
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.account, process.env.ADMIN_INIT_ACCOUNT);
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.length > 20);
    console.log("服务端冒烟测试通过。");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
