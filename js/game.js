// Main game - initialization, game loop, input handling

import * as THREE from 'three';
import { TILES_X, TILES_Z, TILE_SIZE, SEA_LEVEL, FRICTION } from './constants.js';
import { LandscapeRenderer, altToY, getAltitude } from './landscape.js';
import { Player } from './player.js';
import { ParticleSystem } from './particles.js';
import { ObjectManager, createMeshFromBlueprint } from './objects.js';
import { objectRock } from './blueprints.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

class Game {
  constructor() {
    this.ui = new UI();
    this.audio = new Audio();
    this.running = false;
    this.respawnTimer = 0;
    this.frameCount = 0;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000);
    document.body.prepend(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Fog for depth effect — black, like original's distance fade
    this.scene.fog = new THREE.FogExp2(0x000000, 0.04);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 100
    );

    // Lighting - matches original's top-left light source
    const ambient = new THREE.AmbientLight(0x666666);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(-3, 5, -2);
    this.scene.add(dirLight);

    // Sky color gradient (hemisphere light)
    const hemiLight = new THREE.HemisphereLight(0x446688, 0x334422, 0.6);
    this.scene.add(hemiLight);

    // Game systems
    this.landscape = new LandscapeRenderer(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.objects = new ObjectManager(this.scene);
    this.player = new Player(this.scene);

    // Falling rocks
    this.fallingRocks = [];

    // Input
    this.setupInput();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    // Start button
    document.getElementById('start-btn').addEventListener('click', () => {
      this.start();
    });

    // Initial render
    this.updateCamera();
    this.landscape.update(this.player.x, this.player.z);
    this.objects.update(this.player.x, this.player.z);
    this.renderer.render(this.scene, this.camera);
  }

  setupInput() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard: arrows=steer, Z=thrust, X=hover, C=fire, Space=start
    document.addEventListener('keydown', (e) => {
      // Prevent arrow keys from scrolling the page
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === ' ') {
        if (!this.running) this.start();
      }
      if (this.running) {
        this.player.handleKeyDown(e.key);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (this.running) {
        this.player.handleKeyUp(e.key);
      }
    });

    // Always attach touch event listeners — CSS controls visibility via
    // @media (pointer: coarse). The listeners are harmless on desktop.
    this.setupTouchControls();
  }

  setupTouchControls() {
    // Virtual joystick
    const joystickZone = document.getElementById('joystick-zone');
    const thumb = document.getElementById('joystick-thumb');
    const baseRect = () => document.getElementById('joystick-base').getBoundingClientRect();
    let joystickTouchId = null;

    joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (joystickTouchId !== null) return;
      const t = e.changedTouches[0];
      joystickTouchId = t.identifier;
      this.updateJoystick(t, baseRect(), thumb);
    });

    joystickZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joystickTouchId) {
          this.updateJoystick(t, baseRect(), thumb);
        }
      }
    });

    const resetJoystick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joystickTouchId) {
          joystickTouchId = null;
          thumb.style.left = '41px';
          thumb.style.top = '41px';
          // Release all steer keys
          this.player.handleKeyUp('ArrowLeft');
          this.player.handleKeyUp('ArrowRight');
          this.player.handleKeyUp('ArrowUp');
          this.player.handleKeyUp('ArrowDown');
        }
      }
    };
    joystickZone.addEventListener('touchend', resetJoystick);
    joystickZone.addEventListener('touchcancel', resetJoystick);

    // Action buttons
    const buttons = document.querySelectorAll('.touch-btn');
    buttons.forEach(btn => {
      const key = btn.dataset.key;

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        if (!this.running) { this.start(); return; }
        this.player.handleKeyDown(key);
      });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        this.player.handleKeyUp(key);
      });

      btn.addEventListener('touchcancel', (e) => {
        btn.classList.remove('active');
        this.player.handleKeyUp(key);
      });
    });
  }

  updateJoystick(touch, rect, thumb) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const maxR = rect.width / 2 - 25;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }

    thumb.style.left = (45 + dx) + 'px';
    thumb.style.top = (45 + dy) + 'px';

    // Map joystick to arrow key events
    const deadzone = 0.25;
    const nx = dx / maxR;
    const ny = dy / maxR;

    // Horizontal: left/right rotation
    if (nx < -deadzone) {
      this.player.handleKeyDown('ArrowLeft');
      this.player.handleKeyUp('ArrowRight');
    } else if (nx > deadzone) {
      this.player.handleKeyDown('ArrowRight');
      this.player.handleKeyUp('ArrowLeft');
    } else {
      this.player.handleKeyUp('ArrowLeft');
      this.player.handleKeyUp('ArrowRight');
    }

    // Vertical: up/down pitch
    if (ny < -deadzone) {
      this.player.handleKeyDown('ArrowUp');
      this.player.handleKeyUp('ArrowDown');
    } else if (ny > deadzone) {
      this.player.handleKeyDown('ArrowDown');
      this.player.handleKeyUp('ArrowUp');
    } else {
      this.player.handleKeyUp('ArrowUp');
      this.player.handleKeyUp('ArrowDown');
    }
  }

  start() {
    this.ui.hideStartScreen();
    this.audio.init();
    this.running = true;
    this.player.score = 0;
    this.player.lives = 3;
    this.player.fuel = 1.0;
    this.player.gravity = 0.0003;
    this.player.respawn();
    this.respawnTimer = 0;
    this._mouseAccX = 0;
    this._mouseAccY = 0;
    this.frameCount = 0;
    this._lastTime = performance.now();
    this._accumulator = 0;

    this.loop();
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());

    // Fixed timestep: physics runs at 60 steps/sec regardless of display refresh
    const STEP = 1000 / 60;  // ~16.67ms per physics step
    const now = performance.now();
    this._accumulator += now - this._lastTime;
    this._lastTime = now;

    // Cap accumulator to avoid spiral of death
    if (this._accumulator > 200) this._accumulator = 200;

    while (this._accumulator >= STEP) {
      this._accumulator -= STEP;
      this.fixedUpdate();
    }

    // Render at display refresh rate
    this.updateCamera();
    this.ui.update(this.player);
    this.renderer.render(this.scene, this.camera);
  }

  fixedUpdate() {
    this.frameCount++;

    // Track previous state for audio triggers
    const wasAlive = this.player.alive;
    const wasFiring = this.player.firing && this.player.fireCooldown <= 1;

    // Update player
    if (this.player.alive) {
      this.player.update(this.particles);
    } else {
      this.respawnTimer++;
      if (this.respawnTimer > 90) {
        if (this.player.lives > 0) {
          this.player.respawn();
          this.respawnTimer = 0;
          this.ui.hideMessage();
        } else {
          // Game over
          this.player.highScore = Math.max(this.player.highScore, this.player.score);
          this.ui.showMessage(`GAME OVER\n\nScore: ${this.player.score}`);
          this.running = false;
          setTimeout(() => {
            this.ui.hideMessage();
            this.ui.showStartScreen();
          }, 3000);
          return;
        }
      } else if (this.respawnTimer === 1) {
        this.ui.showMessage(
          this.player.lives > 0
            ? `Ship destroyed! Lives: ${this.player.lives}`
            : 'GAME OVER'
        );
      }
    }

    // Audio: thrust
    this.audio.setThrust(this.player.alive && this.player.thrustMode !== 'none');

    // Audio: crash
    if (wasAlive && !this.player.alive) {
      this.audio.playCrash();
    }

    // Update landscape around player
    this.landscape.update(this.player.x, this.player.z);

    // Update objects
    this.objects.update(this.player.x, this.player.z);

    // Drop falling rocks when score > 800 (probability increases with score)
    if (this.player.score > 800 && this.player.alive) {
      const chance = (this.player.score - 800) / 16384;
      if (Math.random() < chance) {
        this.spawnFallingRock();
      }
    }

    // Update falling rocks
    this.updateFallingRocks();

    // Update particles
    this.particles.update(this.player.gravity, 1);

    // Audio: laser fire (once per shot)
    if (this.player.firing && this.player.fireCooldown === 4) {
      this.audio.playLaser();
    }

    // Bullet-object collision
    const bullets = this.particles.getBullets();
    for (const bullet of bullets) {
      const scoreDelta = this.objects.checkBulletCollision(bullet.x, bullet.y, bullet.z, 0.5);
      if (scoreDelta > 0) {
        this.player.score += scoreDelta;
        bullet.life = 0;
        this.particles.spawnExplosion(bullet.x, bullet.y, bullet.z, 20);
        this.audio.playExplosion();
      }
    }

  }

  updateCamera() {
    // Camera follows player from behind and above
    const camDist = 7;
    const camHeight = 4;

    this.camera.position.set(
      this.player.x,
      Math.max(this.player.y + camHeight, camHeight - 1),
      this.player.z + camDist
    );
    this.camera.lookAt(this.player.x, this.player.y - 1, this.player.z - 4);
  }

  spawnFallingRock() {
    if (this.fallingRocks.length >= 5) return;  // max 5 rocks at once
    const mesh = createMeshFromBlueprint(objectRock);
    const rx = this.player.x + (Math.random() - 0.5) * 10;
    const rz = this.player.z - 5 + (Math.random() - 0.5) * 5;
    const ry = this.player.y + 8;  // spawn above (capped by height ceiling)
    mesh.position.set(rx, ry, rz);
    this.scene.add(mesh);
    this.fallingRocks.push({
      mesh,
      x: rx, y: ry, z: rz,
      vx: (Math.random() - 0.5) * 0.02,
      vy: 0,
      vz: (Math.random() - 0.5) * 0.02,
      spin: Math.random() * 0.1,
      life: 170,
    });
  }

  updateFallingRocks() {
    for (let i = this.fallingRocks.length - 1; i >= 0; i--) {
      const rock = this.fallingRocks[i];
      rock.life--;

      // Gravity + friction
      rock.vy -= this.player.gravity;
      rock.vx -= rock.vx * FRICTION;
      rock.vy -= rock.vy * FRICTION;
      rock.vz -= rock.vz * FRICTION;

      rock.x += rock.vx;
      rock.y += rock.vy;
      rock.z += rock.vz;

      // Bounce on ground
      const groundY = altToY(getAltitude(rock.x, rock.z));
      if (rock.y < groundY) {
        rock.y = groundY;
        rock.vy = Math.abs(rock.vy) * 0.5;
        // Explode on hard impact
        if (Math.abs(rock.vy) < 0.005) {
          this.particles.spawnExplosion(rock.x, rock.y, rock.z, 15);
          this.audio.playExplosion();
          rock.life = 0;
        }
      }

      // Spin
      rock.mesh.rotation.y += rock.spin;
      rock.mesh.rotation.x += rock.spin * 0.7;
      rock.mesh.position.set(rock.x, rock.y, rock.z);

      // Check collision with player
      if (this.player.alive) {
        const dx = rock.x - this.player.x;
        const dy = rock.y - this.player.y;
        const dz = rock.z - this.player.z;
        if (dx * dx + dy * dy + dz * dz < 1.0) {
          this.player.crash(this.particles);
          this.audio.playCrash();
          rock.life = 0;
        }
      }

      // Remove dead rocks
      if (rock.life <= 0) {
        this.scene.remove(rock.mesh);
        rock.mesh.geometry.dispose();
        this.fallingRocks.splice(i, 1);
      }
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Boot
const game = new Game();
