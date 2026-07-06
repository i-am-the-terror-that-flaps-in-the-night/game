// --- SYSTEMS ---
class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.z = 1;
        this.tX = 0;
    }
    pan(dx) {
        this.tX = clamp(
            this.tX + dx,
            0,
            CONFIG.WORLD_WIDTH - window.innerWidth / this.z,
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
