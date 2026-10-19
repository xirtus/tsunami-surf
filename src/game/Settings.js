// The settings overlay: character selection (the roster from Characters.js),
// toggled with M. Selection applies live — the rig swaps behind the panel.
export class Settings {
  constructor({ characters, selectedId, onSelect, onClose }) {
    this.characters = characters;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.selectedId = selectedId;
    this.loading = new Set();

    this.el = document.getElementById('settings');
    this.list = document.getElementById('chars');
    this._build();
    this.el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-char]');
      if (row) {
        const id = row.dataset.char;
        if (id !== this.selectedId) {
          this.onSelect(id);
          this.setSelected(id);
        }
      }
    });

    this._onKey = (e) => {
      const k = e.code;
      if (k === 'Escape' || k === 'Enter' || k === 'Space' || k === 'KeyM') {
        e.preventDefault();
        this.close();
        return;
      }
      const i = this.characters.findIndex((c) => c.id === this.selectedId);
      let next = i;
      if (k === 'ArrowLeft' || k === 'KeyA') next = (i + this.characters.length - 1) % this.characters.length;
      else if (k === 'ArrowRight' || k === 'KeyD') next = (i + 1) % this.characters.length;
      else return;
      e.preventDefault();
      const c = this.characters[next];
      this.onSelect(c.id);
      this.setSelected(c.id);
    };
  }

  _build() {
    this.list.innerHTML = '';
    for (const c of this.characters) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'char';
      row.dataset.char = c.id;
      row.innerHTML = `
        <span class="chip" style="background:${c.color}"></span>
        <span class="cname">${c.name}</span>
        <span class="cboard">${c.board}</span>
      `;
      this.list.appendChild(row);
    }
    this.setSelected(this.selectedId);
  }

  setSelected(id) {
    this.selectedId = id;
    for (const row of this.list.children) {
      row.classList.toggle('sel', row.dataset.char === id);
    }
  }

  setLoading(id, on) {
    if (on) this.loading.add(id);
    else this.loading.delete(id);
    const row = this.list.querySelector(`[data-char="${id}"]`);
    if (row) row.classList.toggle('loading', on);
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  open() {
    this.el.classList.remove('hidden');
    window.addEventListener('keydown', this._onKey);
  }

  close() {
    this.el.classList.add('hidden');
    window.removeEventListener('keydown', this._onKey);
    if (this.onClose) this.onClose();
  }

  toggle() {
    if (this.visible) this.close();
    else this.open();
  }
}
