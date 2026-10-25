// A customer's birth year (an integer, after 1920 and before this year) replaces the date of birth in the local database; the form asks for it and needs it.
//   - the database refuses anything else; an older database gets the column, keeps the years of its dates of birth that fit the rule, and loses the old column;
//   - the random tracking code of an order is gone from the database (and its index) too;
//   - the form: a mandatory "Birth year" field, nothing else changes; the list and the customer's page show the year.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const THIS_YEAR = new Date().getFullYear();

(async () => {
  // ---- the database
  const old = sandbox("op-birthyear-old-");
  old.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  const made = runScript(
    old,
    `
    await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
    const S = { tenantKey: 't1', synced: true };
    const cols = async (t) => (await p.$queryRawUnsafe('PRAGMA table_info("' + t + '")')).map((c) => c.name);
    const outcome = (fn) => fn().then(() => 'accepted', () => 'refused');
    const year = ${THIS_YEAR};
    const out = { hasColumn: (await cols('customers')).includes('year_of_birth'), noOldColumn: !(await cols('customers')).includes('date_of_birth'), noTracking: !(await cols('orders')).includes('tracking_code') };
    await p.customer.create({ data: { id: 'ok', name: 'Ok', yearOfBirth: 1985, ...S } });
    out.verdicts = {};
    for (const [label, v] of [['1920', 1920], ['1921', 1921], ['last year', year - 1], ['this year', year], ['next year', year + 1], ['zero', 0]]) {
      out.verdicts[label] = await outcome(() => p.customer.create({ data: { name: 'T ' + label, yearOfBirth: v, ...S } }));
    }
    out.verdicts.none = await outcome(() => p.customer.create({ data: { name: 'No year', ...S } }));
    out.verdicts.nulled = await outcome(() => p.$executeRawUnsafe("UPDATE customers SET year_of_birth = NULL WHERE id = 'ok'"));
    out.verdicts.update = await outcome(() => p.customer.update({ where: { id: 'ok' }, data: { yearOfBirth: 1900 } }));
    out.verdicts.text = await outcome(() => p.$executeRawUnsafe("UPDATE customers SET year_of_birth = 'abc' WHERE id = 'ok'"));
    out.kept = (await p.customer.findFirst({ where: { id: 'ok' } })).yearOfBirth;
    // what a database made by an older version looks like: dates of birth, a tracking code with its index
    await p.$executeRawUnsafe('DROP TRIGGER "customers_year_of_birth_insert"');
    await p.$executeRawUnsafe('DROP TRIGGER "customers_year_of_birth_update"');
    await p.$executeRawUnsafe('ALTER TABLE "customers" DROP COLUMN "year_of_birth"');
    await p.$executeRawUnsafe('ALTER TABLE "customers" ADD COLUMN "date_of_birth" DATETIME');
    const ms = (iso) => new Date(iso).getTime();
    await p.$executeRawUnsafe("DELETE FROM customers");
    const ins = (id, v) => p.$executeRawUnsafe("INSERT INTO customers (id, name, tenant_key, synced, date_of_birth) VALUES ('" + id + "', '" + id + "', 't1', 1, " + v + ")");
    await ins('a', ms('1985-06-15T00:00:00.000Z'));
    await ins('b', "'1972-03-02T00:00:00.000Z'");
    await ins('c', ms('1900-01-01T00:00:00.000Z'));
    await ins('d', ms((year + 1) + '-01-01T00:00:00.000Z'));
    await ins('e', 'NULL');
    await p.$executeRawUnsafe('ALTER TABLE "orders" ADD COLUMN "tracking_code" INTEGER');
    await p.$executeRawUnsafe('CREATE UNIQUE INDEX "orders_tenant_key_tracking_code_key" ON "orders" ("tenant_key", "tracking_code")');
    console.log('NEW ' + JSON.stringify(out));
  `,
  );
  const fresh = JSON.parse(/NEW (.*)/.exec(made)[1]);
  R.section("the rule");
  R.ck(fresh.hasColumn && fresh.noOldColumn && fresh.noTracking, "a new database has year_of_birth, no date_of_birth and no tracking_code", JSON.stringify(fresh));
  const v = fresh.verdicts;
  R.ck(v["1920"] === "refused" && v["1921"] === "accepted", "1920 is refused, 1921 is accepted", `${v["1920"]} ${v["1921"]}`);
  R.ck(v["last year"] === "accepted" && v["this year"] === "refused" && v["next year"] === "refused" && v.zero === "refused", "last year is accepted, this year and later are refused", JSON.stringify(v));
  R.ck(v.none === "refused" && v.nulled === "refused", "no year at all (new, or emptied) is refused");
  R.ck(v.update === "refused" && v.text === "refused" && fresh.kept === 1985, "a change to an impossible year, or to a text that is not a number, is refused and the year stays", `${v.update} ${v.text} ${fresh.kept}`);

  const upgraded = runScript(
    old,
    `
    const cols = async (t) => (await p.$queryRawUnsafe('PRAGMA table_info("' + t + '")')).map((c) => c.name);
    const years = Object.fromEntries((await p.customer.findMany()).map((c) => [c.id, c.yearOfBirth]));
    const indexes = (await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%tracking%'")).length;
    const allUnsynced = (await p.customer.findMany()).every((c) => c.synced === false);
    console.log('UP ' + JSON.stringify({ allUnsynced, years, hasYear: (await cols('customers')).includes('year_of_birth'), hasOld: (await cols('customers')).includes('date_of_birth'), hasTracking: (await cols('orders')).includes('tracking_code'), indexes }));
  `,
  );
  const up = JSON.parse(/UP (.*)/.exec(upgraded)[1]);
  R.section("an older database");
  R.ck(up.hasYear && !up.hasOld, "the next start gives it year_of_birth and removes date_of_birth", JSON.stringify(up));
  R.ck(up.years.a === 1985 && up.years.b === 1972, "the years of the dates of birth are kept (numbers and texts)", JSON.stringify(up.years));
  R.ck(up.years.c === 2006 && up.years.d === 2006 && up.years.e === 2006, "a date that does not fit the rule (1900, next year) or none gives 2006", JSON.stringify(up.years));
  R.ck(up.allUnsynced === true, "every customer that got a year is marked not synced, so it is sent again");
  R.ck(!up.hasTracking && up.indexes === 0, "the tracking code column and its index are removed from the orders");

  // ---- the form
  const box = sandbox("op-birthyear-ui-");
  box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  runScript(
    box,
    `
    await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
    await p.customer.create({ data: { id: 'c1', name: 'Amina', yearOfBirth: 1985, tenantKey: 't1', synced: true } });
    await p.customer.create({ data: { id: 'c2', name: 'Old record', yearOfBirth: 2006, tenantKey: 't1', synced: true } });
  `,
  );
  const A = await launchApp(box);
  const type = (sel, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const save = () => A.val("document.querySelector('.dialog__form button[type=submit]').click()");
  const err = () => A.val("document.querySelector('#customer-yearOfBirth-error')?.textContent ?? ''");
  const count = () => A.val("window.electronAPI.customers.list().then((r) => (r.items ?? r).length)");
  try {
    await A.until("typeof window.electronAPI?.customers?.list === 'function'", 20000);
    await A.val("(() => { location.hash = 'customers'; return 1; })()");
    await A.until("document.querySelectorAll('tr[data-customer]').length === 2");
    R.section("the list");
    R.ck((await A.val("document.querySelector('th.col-dob, thead th:nth-child(5)')?.textContent")).includes("Birth year"), "the column is called Birth year");
    R.ck((await A.val("document.querySelector('tr[data-customer=c1] .col-dob').textContent")) === "1985", "it shows the year");
    R.ck((await A.val("document.querySelector('tr[data-customer=c2] .col-dob').textContent")) === "2006", "and 2006 for the one that was given it");

    R.section("the form");
    await A.val("[...document.querySelectorAll('button')].find((b) => /Add Customer/i.test(b.textContent)).click()");
    await A.until("!!document.querySelector('#customer-yearOfBirth')");
    R.ck(await A.val("document.querySelector('#customer-yearOfBirth').required && document.querySelector('#customer-yearOfBirth').type === 'number' && !document.querySelector('#customer-dateOfBirth')"), "a number field, mandatory, and the date field is gone");
    await type("#customer-name", "Nadia");
    await save();
    await sleep(300);
    R.ck((await err()).length > 0 && (await count()) === 2, "without a year the customer is not saved and the field says why", await err());
    for (const bad of ["1920", String(THIS_YEAR), String(THIS_YEAR + 1), "85", "19.5"]) {
      await type("#customer-yearOfBirth", bad);
      await save();
      await sleep(200);
      R.ck((await err()).length > 0 && (await count()) === 2, `"${bad}" is refused`, await err());
    }
    await type("#customer-yearOfBirth", "1990");
    R.ck((await err()) === "", "typing clears the message");
    await save();
    R.ck(await A.until("!document.querySelector('dialog[open]') && document.querySelectorAll('tr[data-customer]').length === 3", 20000), "1990 is saved");
    const all = await A.val("window.electronAPI.customers.list().then((r) => (r.items ?? r).map((c) => [c.name, c.yearOfBirth]))");
    R.ck(JSON.stringify(all.find((c) => c[0] === "Nadia")) === JSON.stringify(["Nadia", 1990]) && Object.keys((await A.val("window.electronAPI.customers.list().then((r) => (r.items ?? r)[0])"))).every((k) => k !== "dateOfBirth"), "the customer is stored with the number 1990", JSON.stringify(all));

    R.section("editing");
    await A.val("document.querySelector('tr[data-customer=c2] [aria-haspopup], tr[data-customer=c2] .row-menu-button').click()");
    await A.until("!!document.querySelector('.popup button')");
    await A.val("[...document.querySelectorAll('.popup button')].find((b) => /edit/i.test(b.textContent)).click()");
    await A.until("!!document.querySelector('#customer-yearOfBirth')");
    R.ck((await A.val("document.querySelector('#customer-yearOfBirth').value")) === "2006", "the field holds the year");
    await type("#customer-yearOfBirth", "");
    await save();
    await sleep(300);
    R.ck((await err()).length > 0, "and it can't be emptied");
    await type("#customer-yearOfBirth", "1960");
    await save();
    R.ck(await A.until("!document.querySelector('dialog[open]') && document.querySelector('tr[data-customer=c2] .col-dob')?.textContent === '1960'", 20000), "a new year is saved and shown");

    R.section("the customer's page");
    await A.val("(() => { location.hash = 'customers/c1'; return 1; })()");
    await A.until("!!document.querySelector('.info__grid')");
    const info = await A.val("document.querySelector('.info__grid').textContent");
    R.ck(info.includes("Birth year") && info.includes("1985") && info.includes(String(THIS_YEAR - 1985)) && !/Date of birth/.test(info), "it shows the birth year and the age", info);
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
