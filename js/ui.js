// HUD overlay - score, fuel, lives, messages

export class UI {
  constructor() {
    this.scoreEl = document.getElementById('score');
    this.highScoreEl = document.getElementById('high-score');
    this.livesEl = document.getElementById('lives');
    this.fuelBar = document.getElementById('fuel-bar');
    this.altitudeEl = document.getElementById('altitude');
    this.messageEl = document.getElementById('message');
    this.startScreen = document.getElementById('start-screen');
  }

  update(player) {
    this.scoreEl.textContent = `SCORE: ${player.score}`;
    this.highScoreEl.textContent = `HIGH: ${player.highScore}`;

    // Lives as ship icons
    this.livesEl.textContent = '\u25B2 '.repeat(player.lives).trim();

    // Fuel bar
    const fuelPct = Math.max(0, Math.min(100, player.fuel * 100));
    this.fuelBar.style.width = `${fuelPct}%`;
    if (fuelPct < 20) {
      this.fuelBar.style.background = '#f00';
    } else if (fuelPct < 50) {
      this.fuelBar.style.background = '#ff0';
    } else {
      this.fuelBar.style.background = '#0f0';
    }
  }

  showMessage(text, duration) {
    this.messageEl.textContent = text;
    this.messageEl.style.display = 'block';
    if (duration) {
      setTimeout(() => {
        this.messageEl.style.display = 'none';
      }, duration);
    }
  }

  hideMessage() {
    this.messageEl.style.display = 'none';
  }

  showStartScreen() {
    this.startScreen.style.display = 'flex';
  }

  hideStartScreen() {
    this.startScreen.style.display = 'none';
  }
}
