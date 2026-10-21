// Copy and paste: the application menu has the Edit commands (so the shortcuts work) and the right-click menu offers Cut / Copy / Paste / Select all.
const path = require("node:path");
const { recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const { editMenuTemplate, contextMenuTemplate } = require(path.join(ROOT, "dist", "editMenu.js"));
const roles = (items) => items.filter((i) => i.role).map((i) => i.role);
const all = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };

R.section("application menu");
const edit = editMenuTemplate().find((m) => m.label === "Edit");
R.ck(["undo", "redo", "cut", "copy", "paste", "selectAll"].every((r) => roles(edit.submenu).includes(r)), "the Edit menu has undo, redo, cut, copy, paste and select all (these make Ctrl+Z/Y/X/C/V/A work)");
R.ck(roles(editMenuTemplate().find((m) => m.label === "View").submenu).includes("toggleDevTools"), "and the View menu keeps reload and the developer tools");

R.section("right-click menu");
const field = contextMenuTemplate({ isEditable: true, selectionText: "", editFlags: all });
R.ck(["cut", "copy", "paste", "selectAll"].every((r) => roles(field).includes(r)), "in a field: Cut, Copy, Paste and Select all");
R.ck(field.find((i) => i.role === "paste").enabled === true && contextMenuTemplate({ isEditable: true, selectionText: "", editFlags: { ...all, canPaste: false } }).find((i) => i.role === "paste").enabled === false, "Paste is enabled only when there is something to paste");
const selected = contextMenuTemplate({ isEditable: false, selectionText: "some text", editFlags: all });
R.ck(roles(selected).join() === "copy", "on selected text that is not in a field: Copy only");
R.ck(contextMenuTemplate({ isEditable: false, selectionText: "  ", editFlags: all }).length === 0, "anywhere else: no menu");
process.exit(R.done());
