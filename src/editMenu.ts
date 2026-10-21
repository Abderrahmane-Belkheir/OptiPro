import type { MenuItemConstructorOptions } from "electron";

/**
 * Copy and paste. Electron shows no context menu of its own, and the keyboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Ctrl+Z) only work through a
 * menu that has these commands. So the app has an application menu with an Edit menu (hidden: the windows hide their menu bar) and every window shows a
 * small menu when a field or a selection is right-clicked. These two functions only build the descriptions; src/main.ts turns them into menus.
 */

/** The application menu: Edit (so the shortcuts work in every window) and View (reload and the developer tools, as in Electron's default menu). */
export function editMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }] },
  ];
}

/** What the context-menu event tells (the parts of Electron's ContextMenuParams used here). */
export interface ContextParams {
  isEditable: boolean;
  selectionText: string;
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

/** The right-click menu: Cut / Copy / Paste / Select all in a field, Copy on selected text, nothing anywhere else. */
export function contextMenuTemplate(params: ContextParams): MenuItemConstructorOptions[] {
  const flags = params.editFlags;
  if (params.isEditable) {
    return [
      { role: "undo", enabled: flags.canUndo },
      { role: "redo", enabled: flags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut },
      { role: "copy", enabled: flags.canCopy },
      { role: "paste", enabled: flags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: flags.canSelectAll },
    ];
  }
  if (params.selectionText.trim() !== "") return [{ role: "copy", enabled: flags.canCopy }];
  return [];
}
