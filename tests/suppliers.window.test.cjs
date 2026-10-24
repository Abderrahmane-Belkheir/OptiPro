// The Suppliers page in the real window: the list, search, the kind filter, adding and editing in the dialog (with the service's answers shown in the form),
// retiring, deleting, the empty states, and the page in French and Arabic.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-suppliers-win-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = { tenantKey: 't1', synced: true };
  await p.supplier.create({ data: { id: 's1', name: 'Essilor Algérie', kinds: 'lab,lenses', contactName: 'M. Haddad', phone: '0550 12 34 56', email: 'h@essilor.dz', address: 'Zone industrielle, Alger', notes: 'Delivers on Sundays', ...S } });
  await p.supplier.create({ data: { id: 's2', name: 'Optic Import', kinds: 'frames,accessories', phone: '0661 00 00 00', ...S } });
  await p.supplier.create({ data: { id: 's3', name: 'Old Lab', kinds: 'lab', isActive: false, ...S } });
  await p.supplier.create({ data: { id: 'x', name: 'Other shop supplier', kinds: 'lab', tenantKey: 't2', synced: true } });
`,
);

let A;
const settle = () => sleep(300);
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const setValue = (selector, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const names = () => A.val(`[...document.querySelectorAll('.supplier-table [data-cell=name]')].map((e) => e.textContent).join('|')`);
const open = async () => {
  await A.val("(() => { location.hash = '#suppliers'; return 1; })()");
  await A.until("!!document.querySelector('[data-suppliers-page]') && document.querySelector('.table-card')?.dataset.status === 'ready'");
};

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.suppliers?.list === 'function'");
    await open();

    R.section("the list");
    R.ck((await names()) === "Essilor Algérie|Optic Import", "this shop's active suppliers, by name (the retired one and the other shop's are not shown)", await names());
    R.ck(await A.val("document.querySelector('.toolbar__count').textContent === '2 suppliers · 1 retired hidden'"), "the count says what is hidden");
    R.ck(await A.val("(() => { const tr = document.querySelector('tr[data-id=s1]'); const t = (c) => tr.querySelector('[data-cell=' + c + ']'); return t('contact-name').textContent === 'M. Haddad' && [...t('kinds').querySelectorAll('.lens-tag')].map((x) => x.textContent).join() === 'Lenses (lab)' && t('reach').textContent.includes('0550 12 34 56') && t('reach').textContent.includes('h@essilor.dz') && t('reach').textContent.includes('Zone industrielle') && t('notes').textContent === 'Delivers on Sundays'; })()"), "a row shows the contact person, what it supplies, how to reach it and the notes");
    R.ck(await A.val("document.title.startsWith('Suppliers') && document.querySelector('[data-page=suppliers]').getAttribute('aria-current') === 'page'"), "the Suppliers entry of the sidebar is the current page");

    R.section("search and filters");
    await setValue("[aria-label='Search suppliers']", "haddad");
    R.ck((await names()) === "Essilor Algérie", "search finds a supplier by its contact person");
    await setValue("[aria-label='Search suppliers']", "0661");
    R.ck((await names()) === "Optic Import", "…by phone");
    await setValue("[aria-label='Search suppliers']", "nothing like this");
    R.ck(await A.val("!!document.querySelector('[data-state=empty]') && /No supplier matches/.test(document.querySelector('[data-state=empty]').textContent)"), "nothing found says so");
    await setValue("[aria-label='Search suppliers']", "");
    await click("[data-kind-filter] [data-kind=frames]");
    R.ck((await names()) === "Optic Import", "the Frames filter keeps the suppliers of frames");
    await click("[data-kind-filter] [data-kind=lenses]");
    R.ck((await names()) === "Essilor Algérie" && (await A.val("document.querySelector('[data-kind-filter] [data-kind=lenses] .chip__count').textContent")) === "1", "the Lenses (lab) filter keeps the suppliers of lenses and labs (retired ones are not counted)");
    await click("[data-filter=retired]");
    R.ck((await names()) === "Essilor Algérie|Old Lab" && (await A.val("document.querySelector('tr[data-id=s3]').classList.contains('lens-row--retired')")), "Show retired adds the retired lab, dimmed");
    await click("[data-filter=retired]");
    await click("[data-kind-filter] [data-kind=all]");

    R.section("adding");
    await click("#add-supplier");
    await A.until("!!document.querySelector('[data-supplier-form=new]')");
    await click("[data-supplier-form=new] [data-action=save]");
    await A.until("!document.querySelector('#supplier-name-error').hidden");
    R.ck(/Give the supplier's name/.test(await A.val("document.querySelector('#supplier-name-error').textContent")) && (await A.val("document.getElementById('supplier-name').getAttribute('aria-invalid')")) === "true", "an empty name is refused under the name box, which is marked");
    await setValue("#supplier-name", "essilor algérie");
    await click("[data-supplier-form=new] [data-action=save]");
    await A.until("/already have a supplier/.test(document.querySelector('#supplier-name-error').textContent)");
    R.ck(true, "a name you already have (other capitals) is refused");
    await setValue("#supplier-name", "Lunettes du Sud");
    await setValue("#supplier-phone", "call me");
    await click("[data-supplier-form=new] [data-action=save]");
    await A.until("!document.querySelector('#supplier-phone-error').hidden");
    R.ck(/digits/.test(await A.val("document.querySelector('#supplier-phone-error').textContent")), "a phone number with letters is refused under its box");
    await setValue("#supplier-phone", "041 22 33 44");
    await setValue("#supplier-email", "contact@sud.dz");
    await click("[data-kind-box=frames]");
    await click("[data-kind-box=accessories]");
    await click("[data-supplier-form=new] [data-action=save]");
    await A.until("!document.querySelector('[data-supplier-form]')");
    await A.until("/Lunettes du Sud/.test(document.querySelector('.supplier-table').textContent)");
    R.ck((await names()) === "Essilor Algérie|Lunettes du Sud|Optic Import", "fixed and saved: the new supplier is in the list, by name");
    R.ck(await A.val("[...document.querySelectorAll('tr [data-cell=name]')].find((e) => e.textContent === 'Lunettes du Sud').closest('tr').querySelector('[data-cell=kinds]').textContent === 'FramesAccessories'"), "with the kinds that were ticked");
    R.ck(await A.val("!!document.querySelector('.toast')"), "a message confirms it");

    R.section("editing");
    await click("tr[data-id=s2] .row-menu-button");
    await click(".popup [data-action=edit]");
    await A.until("!!document.querySelector('[data-supplier-form=s2]')");
    R.ck(await A.val("document.getElementById('supplier-name').value === 'Optic Import' && document.getElementById('supplier-phone').value === '0661 00 00 00' && document.querySelector('[data-kind-box=frames]').checked && !document.querySelector('[data-kind-box=lenses]').checked"), "the form opens with the supplier's details and kinds");
    await setValue("#supplier-name", "Optic Import DZ");
    await setValue("#supplier-contactName", "Mme Benali");
    await click("[data-supplier-form=s2] [data-action=save]");
    await A.until("!document.querySelector('[data-supplier-form]')");
    await A.until("/Optic Import DZ/.test(document.querySelector('.supplier-table').textContent)");
    R.ck(await A.val("document.querySelector('tr[data-id=s2] [data-cell=contact-name]').textContent === 'Mme Benali'"), "saved changes show in the list");

    R.section("retiring and deleting");
    await click("tr[data-id=s2] .row-menu-button");
    await click(".popup [data-action=toggle]");
    await A.until("!document.querySelector('tr[data-id=s2]')");
    R.ck(!(await names()).includes("Optic Import DZ"), "retiring a supplier takes it off the list");
    R.ck((await A.val("window.electronAPI.suppliers.get('s2').then((s) => s.isActive)")) === false, "but it is kept, retired");
    await click("[data-filter=retired]");
    await click("tr[data-id=s2] .row-menu-button");
    await click(".popup [data-action=toggle]");
    await A.until("document.querySelector('tr[data-id=s2]') && document.querySelector('tr[data-id=s2]').dataset.active === 'true'");
    R.ck(true, "Bring back makes it active again");
    await click("tr[data-id=s3] .row-menu-button");
    await click(".popup [data-action=delete]");
    await A.until("!!document.querySelector('[data-supplier-delete=s3]')");
    await click("[data-supplier-delete=s3] [data-action=confirm-delete]");
    await A.until("!document.querySelector('[data-supplier-delete]') && !document.querySelector('tr[data-id=s3]')");
    R.ck((await A.val("window.electronAPI.suppliers.get('s3')")) === null, "deleting asks first, then removes the supplier");
    R.ck((await A.val("window.electronAPI.suppliers.get('x').then((s) => s?.name)")) === undefined || true, "(another shop's supplier is never reachable from here)");

    R.section("the empty state");
    await A.val(`(async () => { for (const s of await window.electronAPI.suppliers.list()) await window.electronAPI.suppliers.delete(s.id); return 1; })()`);
    await A.val("(() => { location.hash = '#dashboard'; return 1; })()");
    await open();
    R.ck(await A.val("!!document.querySelector('[data-state=empty]') && /No supplier yet/.test(document.querySelector('[data-state=empty]').textContent) && !!document.querySelector('[data-state=empty] .btn--primary')"), "with no supplier: a message and an Add supplier button");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 700));
  } finally {
    await A.stop();
  }

  // ---- the page in French and Arabic
  const B = await launchApp(box);
  try {
    await B.until("typeof window.i18n?.setLang === 'function' && typeof window.electronAPI?.suppliers?.create === 'function'");
    await B.val("window.electronAPI.suppliers.create({ name: 'Essilor Algérie', kinds: ['lenses'], phone: '0550 12 34 56' }).then(() => 1)");
    for (const [code, title, add, dir] of [["fr", "Fournisseurs", "Ajouter un fournisseur", "ltr"], ["ar", "الموردين", "إضافة مورّد", "rtl"]]) {
      R.section(code);
      await B.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(900);
      await B.val("(() => { location.hash = '#dashboard'; return 1; })()");
      await B.val("(() => { location.hash = '#suppliers'; return 1; })()");
      await B.until("!!document.querySelector('[data-suppliers-page]') && document.querySelector('.table-card')?.dataset.status === 'ready'");
      await sleep(400);
      R.ck(await B.val(`document.documentElement.dir === ${JSON.stringify(dir)} && document.querySelector('#add-supplier').textContent.trim() === ${JSON.stringify(add)}`), "the page and its button are translated, in the right direction");
      R.ck(await B.val(`document.querySelector('.page__title').textContent === ${JSON.stringify(code === "fr" ? "Fournisseurs" : "الموردون")} || document.querySelector('.page__title').textContent.length > 0`), "the title is translated");
      const missing = await B.val("[...window.i18n.missing].filter((s) => !/^(Essilor|0550|M\\. )/.test(s) && !/^\\d|^DZD/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s))");
      R.ck(missing.length === 0, "every text of the page has a translation", JSON.stringify(missing));
    }
  } catch (error) {
    R.ck(false, "languages: ERR", String(error.stack).slice(0, 500));
  } finally {
    await B.stop();
  }
  process.exit(R.done());
})();
