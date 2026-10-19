// Minimal DOM HUD: score, speed, trick popup, overlays.
export class Hud {
  constructor() {
    this.score = 0;
    this.elScore = document.getElementById('score');
    this.elSpeed = document.getElementById('speed');
    this.elTrick = document.getElementById('trick');
    this.elCam = document.getElementById('cam');
    this.elDist = document.getElementById('dist');
    this.elLevel = document.getElementById('level');
    this.wipeout = document.getElementById('wipeout');
    this._wipeTimer = null;
  }

  addScore(n) { this.score = Math.max(0, this.score + n); }

  update() {
    this.elScore.textContent = `SCORE ${Math.round(this.score)}`;
  }

  setSpeed(s) {
    this.elSpeed.textContent = `${Math.round(Math.abs(s) * 2.6)} km/h`;
  }

  setLevel(name) {
    this.elLevel.textContent = `WAVE ${name}`;
  }

  setDistance(m) {
    this.elDist.textContent = m < 1000
      ? `DIST ${Math.floor(m)} m`
      : `DIST ${(m / 1000).toFixed(2)} km`;
  }

  showTrick(label, points) {
    this.elTrick.textContent = `${label}  +${points}`;
    this.elTrick.classList.remove('show');
    void this.elTrick.offsetWidth; // restart CSS animation
    this.elTrick.classList.add('show');
  }

  flashWipeout(msg = 'WIPEOUT') {
    this.wipeout.textContent = msg;
    this.wipeout.classList.remove('show');
    void this.wipeout.offsetWidth;
    this.wipeout.classList.add('show');
    clearTimeout(this._wipeTimer);
    this._wipeTimer = setTimeout(() => this.wipeout.classList.remove('show'), 800);
  }

  showCam(name) {
    this.elCam.textContent = `CAMERA ${name}`;
    this.elCam.classList.remove('show');
    void this.elCam.offsetWidth; // restart CSS animation
    this.elCam.classList.add('show');
  }
}
