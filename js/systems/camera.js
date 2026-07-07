import { CONFIG } from '../config.js';
import { clamp } from '../utils.js';

// --- SYSTEMS ---
export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.z = 1;
        this.tX = 0;
        // Viewport width, kept in sync by Game.resize(). Read here instead of
        // window.innerWidth so the camera has no direct window dependency.
        this.viewW = window.innerWidth;
    }
    pan(dx) {
        this.tX = clamp(
            this.tX + dx,
            0,
            CONFIG.WORLD_WIDTH - this.viewW / this.z,
        );
    }
    update(dt) {
        this.x += (this.tX - this.x) * (1 - Math.pow(0.1, dt));
    }
    toScreen(wx, wy) {
        return {
            x: (wx - this.x) * this.z,
            y: (wy - this.y) * this.z,
        };
    }
    toWorld(sx, sy) {
        return { x: sx / this.z + this.x, y: sy / this.z + this.y };
    }
}
