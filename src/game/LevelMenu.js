// The level select overlay: the main menu of TSUNAMI. Arrow keys (or click)
// move across the break cards — every highlight live-previews the actual
// wave behind the panel (onPreview) — SPACE/ENTER drops in. L reopens it
// mid-run; closing with a new level selected restarts the run on that wave.
export class LevelMenu {
  constructor({ levels, onPreview, onStart, onRoll, onClose }) {
    this.levels = levels;       // array of level defs; the last may be { random: true }
    this.onPreview = onPreview;
    this.onStart = onStart;
    this.onRoll = onRoll;       // () => fresh level def for the RANDOM card
    this.onClose = onClose;
    this.index = 0;
    this.rolled = null;         // current RANDOM REEF level def
    this._previewTimer = 0;

    this.el = document.getElementById('levels');
    this.list = document.getElementById('breaks');
    this._build();

    this.list.addEventListener('click', (e) => {
      const card = e.target.closest('[data-level]');
      if (!card) return;
      const i = +card.dataset.level;
      if (i === this.index) this._start();
      else this.select(i, true);
    });

    this._onKey = (e) => {
      const k = e.code;
      if (k === 'ArrowUp' || k === 'KeyW' || k === 'ArrowLeft' || k === 'KeyA') {
        e.preventDefault();
        this.select((this.index + this.levels.length - 1) % this.levels.length, true);
      } else if (k === 'ArrowDown' || k === 'KeyS' || k === 'ArrowRight' || k === 'KeyD') {
        e.preventDefault();
        this.select((this.index + 1) % this.levels.length, true);
      } else if (k === 'Enter' || k === 'Space') {
        e.preventDefault();
        this._start();
      } else if (k === 'Escape' || k === 'KeyL') {
        e.preventDefault();
        this._start(); // closing the menu rides the highlighted wave
      }
    };
  }

  _build() {
    this.list.innerHTML = '';
    this.levels.forEach((l, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'break';
      card.dataset.level = i;
      const s = l.stats;
      card.innerHTML = `
        <span class="swatches">
          <i style="background:${l.swatches[0]}"></i>
          <i style="background:${l.swatches[1]}"></i>
          <i style="background:${l.swatches[2]}"></i>
        </span>
        <span class="bname">${l.name}</span>
        <span class="btag">${l.tag}</span>
        <span class="bstats">FACE ~${s.face} M · SET ${s.period} S · ${s.kmh} KM/H · ${s.mood}</span>
      `;
      this.list.appendChild(card);
    });
    this._mark();
  }

  // Refresh one card's text (RANDOM REEF re-rolls its stats each highlight).
  _refresh(i) {
    const l = this.levels[i];
    const card = this.list.children[i];
    if (!card) return;
    card.querySelector('.btag').textContent = l.tag;
    const s = l.stats;
    card.querySelector('.bstats').textContent =
      `FACE ~${s.face} M · SET ${s.period} S · ${s.kmh} KM/H · ${s.mood}`;
    const sw = card.querySelectorAll('.swatches i');
    l.swatches.forEach((c, j) => { sw[j].style.background = c; });
  }

  _mark() {
    [...this.list.children].forEach((c, i) => c.classList.toggle('sel', i === this.index));
    const card = this.list.children[this.index];
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  current() { return this.levels[this.index]; }

  select(i, preview) {
    this.index = i;
    const l = this.levels[i];
    if (l.random) {
      // re-roll the reef on every visit to the card
      this.levels[i] = this.onRoll();
      this._refresh(i);
    }
    this._mark();
    if (preview) {
      clearTimeout(this._previewTimer);
      this._previewTimer = setTimeout(() => this.onPreview(this.current()), 120);
    }
  }

  _start() {
    clearTimeout(this._previewTimer);
    this.onStart(this.current());
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  open() {
    this.el.classList.remove('hidden');
    window.addEventListener('keydown', this._onKey);
    this.onPreview(this.current()); // make sure the backdrop matches the card
  }

  close() {
    this.el.classList.add('hidden');
    window.removeEventListener('keydown', this._onKey);
    if (this.onClose) this.onClose();
  }

  toggle() {
    if (this.visible) this._start();
    else this.open();
  }
}
