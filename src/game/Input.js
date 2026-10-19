// Keyboard input with edge-detection for presses.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  KeyC: 'cam', KeyV: 'cam',
  KeyM: 'settings', Escape: 'settings',
  KeyL: 'levels',
};

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();

    target.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(action)) this.pressed.add(action);
      this.down.add(action);
    });
    target.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) this.down.delete(action);
    });
    target.addEventListener('blur', () => { this.down.clear(); });
  }

  get axisX() { return (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0); }
  get axisY() { return (this.down.has('down') ? 1 : 0) - (this.down.has('up') ? 1 : 0); }
  wasPressed(action) { return this.pressed.has(action); }
  consume(action) { this.pressed.delete(action); }
  endFrame() { this.pressed.clear(); }
}
