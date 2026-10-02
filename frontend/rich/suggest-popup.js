// The popup a `@tiptap/suggestion` plugin draws: a list under the caret, arrows and Enter to
// pick, Escape to close. Plain DOM rather than React on purpose — the plugin appends it to
// the body, outside React's tree, and a rendered list that outlives a re-render is exactly
// the leak a portal invites. Ported from OpsGraph's rich/suggest-popup.ts.

/** A 16px glyph from its inner markup, with the one stroke style. */
export function popupGlyph(markup) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

function keyHint(keys, label) {
  const hint = document.createElement('span');
  hint.className = 'sc-suggest-hint';
  for (const key of keys) {
    const kbd = document.createElement('span');
    kbd.className = 'sc-suggest-kbd';
    kbd.textContent = key;
    hint.append(kbd);
  }
  hint.append(document.createTextNode(label));
  return hint;
}

// The suggestion plugin's `render`: one popup per suggestion, drawn from its items.
// options: { testid, empty, footer? }
// items:   { id, label, detail, group?, icon?, description? }
export function suggestionPopup(options) {
  return function render() {
    let root = null;
    let unmount = null;
    let current = null;
    let selected = 0;

    const draw = () => {
      if (root === null || current === null) return;
      root.replaceChildren();
      const { items } = current;
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sc-suggest-empty';
        empty.textContent = options.empty;
        root.append(empty);
        return;
      }
      let group;
      items.forEach((item, index) => {
        if (item.group !== undefined && item.group !== group) {
          group = item.group;
          const head = document.createElement('div');
          head.className = 'sc-suggest-group';
          const label = document.createElement('span');
          label.textContent = group;
          const count = document.createElement('span');
          count.className = 'sc-suggest-count';
          const n = items.filter(candidate => candidate.group === group).length;
          count.textContent = `${n} ${n === 1 ? 'result' : 'results'}`;
          head.append(label, count);
          root.append(head);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sc-suggest-item';
        button.dataset.testid = `${options.testid}-option-${item.id}`;
        if (index === selected) button.dataset.selected = 'true';
        if (item.icon !== undefined) {
          const glyph = document.createElement('span');
          glyph.className = 'sc-suggest-icon';
          glyph.append(popupGlyph(item.icon));
          button.append(glyph);
        }
        const name = document.createElement('span');
        name.className = 'sc-suggest-name';
        name.textContent = item.label;
        const detail = document.createElement('span');
        detail.className = 'sc-suggest-detail';
        detail.textContent = item.detail;
        if (item.description !== undefined) {
          button.dataset.twoLine = 'true';
          const text = document.createElement('span');
          text.className = 'sc-suggest-text';
          const description = document.createElement('span');
          description.className = 'sc-suggest-desc';
          description.textContent = item.description;
          text.append(name, description);
          button.append(text);
        } else {
          button.append(name, detail);
        }
        // `mousedown` rather than `click`: a click would first blur the editor, which closes
        // the suggestion before the pick lands.
        button.addEventListener('mousedown', event => {
          event.preventDefault();
          current?.command(item);
        });
        root.append(button);
      });
      if (options.footer === true) {
        const foot = document.createElement('div');
        foot.className = 'sc-suggest-foot';
        foot.append(
          keyHint(['↑', '↓'], 'move'),
          keyHint(['↵'], 'insert'),
          keyHint(['esc'], 'close'),
        );
        root.append(foot);
      }
    };

    return {
      onStart(props) {
        current = props;
        selected = 0;
        root = document.createElement('div');
        // `glassPop` is the app's popover bed (styles.css) — translucent, blurred, edged, and
        // already correct in both themes. The suggestion list only adds its own metrics.
        root.className = 'sc-suggest glassPop';
        root.setAttribute('role', 'listbox');
        root.dataset.testid = options.testid;
        draw();
        if (typeof props.mount === 'function') {
          unmount = props.mount(root);
        } else {
          const rect = props.clientRect?.();
          root.style.position = 'fixed';
          root.style.left = `${rect?.left ?? 0}px`;
          root.style.top = `${(rect?.bottom ?? 0) + 4}px`;
          document.body.append(root);
          unmount = () => root?.remove();
        }
      },
      onUpdate(props) {
        current = props;
        selected = Math.min(selected, Math.max(0, props.items.length - 1));
        draw();
      },
      onKeyDown({ event }) {
        if (current === null) return false;
        const count = Math.max(1, current.items.length);
        if (event.key === 'ArrowDown') {
          selected = (selected + 1) % count;
          draw();
          return true;
        }
        if (event.key === 'ArrowUp') {
          selected = (selected - 1 + count) % count;
          draw();
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = current.items[selected];
          if (item === undefined) return false;
          current.command(item);
          return true;
        }
        if (event.key === 'Escape') {
          unmount?.();
          unmount = null;
          return true;
        }
        return false;
      },
      onExit() {
        unmount?.();
        unmount = null;
        root = null;
        current = null;
      },
    };
  };
}
