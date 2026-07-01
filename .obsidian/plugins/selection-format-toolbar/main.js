const { Plugin, MarkdownView } = require("obsidian");

const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fff3a3" },
  { name: "Green", value: "#bbfabb" },
  { name: "Blue", value: "#abf7f7" },
  { name: "Pink", value: "#ffb8eb" },
  { name: "Orange", value: "#ffb86c" },
  { name: "Purple", value: "#d2b3ff" },
];

class SelectionFormatToolbarPlugin extends Plugin {
  onload() {
    this.toolbar = null;

    // Show after mouse selections (drag, double-click, triple-click)
    this.registerDomEvent(document, "mouseup", (evt) => {
      if (this.toolbar && this.toolbar.contains(evt.target)) return;
      window.setTimeout(() => this.maybeShowToolbar(), 10);
    });

    // Show/hide for keyboard selections (shift+arrows, cmd+A)
    this.registerDomEvent(document, "keyup", (evt) => {
      if (evt.key === "Escape") {
        this.hideToolbar();
        return;
      }
      const selecting =
        (evt.shiftKey && evt.key.startsWith("Arrow")) ||
        (evt.key.toLowerCase() === "a" && (evt.metaKey || evt.ctrlKey));
      if (selecting) {
        this.maybeShowToolbar();
      } else if (!this.getSelectedEditor()) {
        this.hideToolbar();
      }
    });

    // Hide when clicking anywhere outside the toolbar
    this.registerDomEvent(document, "mousedown", (evt) => {
      if (this.toolbar && !this.toolbar.contains(evt.target)) {
        this.hideToolbar();
      }
    });

    // Hide on scroll so the toolbar doesn't float away from the text
    this.registerDomEvent(document, "wheel", () => this.hideToolbar(), {
      passive: true,
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.hideToolbar())
    );
  }

  onunload() {
    this.hideToolbar();
  }

  // Returns the active editor if it has a non-empty selection, else null
  getSelectedEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() === "preview") return null;
    const editor = view.editor;
    if (!editor.somethingSelected()) return null;
    if (!editor.getSelection().trim()) return null;
    return editor;
  }

  maybeShowToolbar() {
    const editor = this.getSelectedEditor();
    if (!editor) {
      this.hideToolbar();
      return;
    }
    const domSel = window.getSelection();
    if (!domSel || domSel.rangeCount === 0) return;
    const rect = domSel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    this.showToolbar(editor, rect);
  }

  showToolbar(editor, rect) {
    this.hideToolbar();

    const toolbar = document.body.createDiv({ cls: "sft-toolbar" });
    this.toolbar = toolbar;

    // Keep editor focus/selection when pressing toolbar buttons
    toolbar.addEventListener("mousedown", (evt) => evt.preventDefault());

    const addButton = (label, cls, title, onClick) => {
      const btn = toolbar.createEl("button", { cls: "sft-btn " + cls, title });
      btn.innerHTML = label;
      btn.addEventListener("click", () => {
        onClick();
        window.setTimeout(() => this.maybeShowToolbar(), 10);
      });
      return btn;
    };

    addButton("<b>B</b>", "sft-bold", "Bold", () =>
      this.toggleWrap(editor, "**")
    );
    addButton("<i>I</i>", "sft-italic", "Italic", () =>
      this.toggleWrap(editor, "*")
    );

    toolbar.createDiv({ cls: "sft-divider" });

    for (let level = 1; level <= 6; level++) {
      addButton("H" + level, "sft-heading", "Heading " + level, () =>
        this.toggleHeading(editor, level)
      );
    }

    toolbar.createDiv({ cls: "sft-divider" });

    for (const color of HIGHLIGHT_COLORS) {
      const swatch = toolbar.createEl("button", {
        cls: "sft-btn sft-swatch",
        title: "Highlight " + color.name.toLowerCase(),
      });
      swatch.style.backgroundColor = color.value;
      swatch.addEventListener("click", () => {
        this.applyHighlight(editor, color.value);
        window.setTimeout(() => this.maybeShowToolbar(), 10);
      });
    }

    const clear = toolbar.createEl("button", {
      cls: "sft-btn sft-swatch sft-swatch-clear",
      title: "Remove highlight",
    });
    clear.setText("✕");
    clear.addEventListener("click", () => {
      this.removeHighlight(editor);
      window.setTimeout(() => this.maybeShowToolbar(), 10);
    });

    // Position above the selection, or below if there's no room
    const tbRect = toolbar.getBoundingClientRect();
    let top = rect.top - tbRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - tbRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tbRect.width - 8));
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
  }

  hideToolbar() {
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }

  // Replace the selection and keep the new text selected for chaining actions
  replaceKeepSelected(editor, newText) {
    const from = editor.getCursor("from");
    editor.replaceSelection(newText);
    const lines = newText.split("\n");
    const to =
      lines.length === 1
        ? { line: from.line, ch: from.ch + newText.length }
        : {
            line: from.line + lines.length - 1,
            ch: lines[lines.length - 1].length,
          };
    editor.setSelection(from, to);
  }

  toggleWrap(editor, marker) {
    const sel = editor.getSelection();
    const isWrapped =
      sel.startsWith(marker) &&
      sel.endsWith(marker) &&
      sel.length >= marker.length * 2 &&
      // don't mistake **bold** for italic-wrapped
      !(marker === "*" && sel.startsWith("**") && sel.endsWith("**"));
    const newText = isWrapped
      ? sel.slice(marker.length, sel.length - marker.length)
      : marker + sel + marker;
    this.replaceKeepSelected(editor, newText);
  }

  toggleHeading(editor, level) {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    for (let line = from.line; line <= to.line; line++) {
      const text = editor.getLine(line);
      if (!text.trim()) continue;
      const match = text.match(/^(#{1,6})\s+/);
      const stripped = match ? text.slice(match[0].length) : text;
      const newLine =
        match && match[1].length === level
          ? stripped
          : "#".repeat(level) + " " + stripped;
      editor.setLine(line, newLine);
    }
    editor.setSelection(
      { line: from.line, ch: 0 },
      { line: to.line, ch: editor.getLine(to.line).length }
    );
  }

  stripHighlight(text) {
    const markMatch = text.match(/^<mark[^>]*>([\s\S]*)<\/mark>$/);
    if (markMatch) return markMatch[1];
    const eqMatch = text.match(/^==([\s\S]*)==$/);
    if (eqMatch) return eqMatch[1];
    return text;
  }

  applyHighlight(editor, color) {
    const inner = this.stripHighlight(editor.getSelection());
    this.replaceKeepSelected(
      editor,
      '<mark style="background: ' + color + ';">' + inner + "</mark>"
    );
  }

  removeHighlight(editor) {
    const sel = editor.getSelection();
    const inner = this.stripHighlight(sel);
    if (inner !== sel) this.replaceKeepSelected(editor, inner);
  }
}

module.exports = SelectionFormatToolbarPlugin;

/* nosourcemap */