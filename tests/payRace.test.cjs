// Money taken twice at the same moment (a double click, two windows, a slow answer): an order is never paid more than it costs, and a payment is never lost.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-payrace-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = JSON.parse(
  runScript(
    box,
    `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-1', customerId: 'c1', status: 'ready', subtotalCents: 1000000, totalCents: 1000000, ...S } });
  await p.order.create({ data: { id: 'o2', number: 'CMD-2', customerId: 'c1', status: 'ready', subtotalCents: 1000000, totalCents: 1000000, ...S } });
  const L = require(ROOT + '/dist/local/index.js');
  const D = L.localOrderDetailsService;
  const out = {};
  // the same payment of 10 000 (all that is left) asked twice at once
  const same = await Promise.allSettled([D.pay('o1', { amountCents: 1000000 }), D.pay('o1', { amountCents: 1000000 })]);
  out.same = { ok: same.filter((r) => r.status === 'fulfilled').length, paid: (await p.payment.aggregate({ where: { orderId: 'o1' }, _sum: { amountCents: true } }))._sum.amountCents, rows: await p.payment.count({ where: { orderId: 'o1' } }) };
  // two different payments that together are too much: 6 000 and 6 000 on 10 000
  const two = await Promise.allSettled([D.pay('o2', { amountCents: 600000 }), D.pay('o2', { amountCents: 600000 })]);
  out.two = { ok: two.filter((r) => r.status === 'fulfilled').length, paid: (await p.payment.aggregate({ where: { orderId: 'o2' }, _sum: { amountCents: true } }))._sum.amountCents };
  console.log('RESULT ' + JSON.stringify(out));
`,
  ).split("\n").find((l) => l.startsWith("RESULT "))?.slice(7) ?? "{}",
);

R.section("two payments at once");
R.ck(out.same.paid <= 1000000 && out.same.ok === 1 && out.same.rows === 1, "the same last payment asked twice at once: taken once, the second is refused", JSON.stringify(out.same));
R.ck(out.two.paid <= 1000000 && out.two.ok === 1, "6 000 and 6 000 on 10 000 at once: the order is not paid more than it costs", JSON.stringify(out.two));
process.exit(R.done());
