class WaveManager {
    constructor(g, lvl) {
        this.g = g;
        this.wvs = JSON.parse(JSON.stringify(LEVELS[lvl].waves));
        this.cw = 0;
        this.t = 0;
        this.tw = this.wvs.length;
    }
    update(dt) {
        if (this.cw >= this.tw) return;
        this.t += dt;
        if (this.t >= this.wvs[this.cw].time * 60) {
            this.spawn(this.wvs[this.cw]);
            this.cw++;
            this.t = 0;
            this.g.audio.playTone(400, 0.5, "sine", 0.1);
            this.g.audio.playTone(600, 0.5, "sine", 0.1, 0.2);
            this.g.notify(`Wave ${this.cw} incoming!`);
            if (this.cw >= this.tw)
                setTimeout(
                    () =>
                        this.g.notify("Final wave! Hold the line!"),
                    2000,
                );
        }
    }
    spawn(w) {
        w.enemies.forEach((gr) => {
            for (let i = 0; i < gr.c; i++) {
                setTimeout(
                    () => {
                        if (this.g.state === "playing")
                            this.g.spawnEnemy(
                                gr.t,
                                CONFIG.WORLD_WIDTH - rand(100, 400),
                                CONFIG.GROUND_Y,
                            );
                    },
                    i * 700 + rand(0, 200),
                );
            }
        });
    }
    isComplete() {
        return this.cw >= this.tw && this.g.enemies.length === 0;
    }
}

class EndlessWave {
    constructor(g) {
        this.g = g;
        this.wave = 0;
        this.t = 0;
        this.int = 600;
        this.cw = 0;
        this.tw = Infinity;
    }
    update(dt) {
        this.t += dt;
        if (this.t >= this.int) {
            this.t = 0;
            this.wave++;
            this.cw++;
            this.g.diff = 1 + this.wave * 0.18;
            this.spawn();
            const isBoss = this.wave % 5 === 0;
            if (isBoss) {
                this.g.audio.playTone(220, 1, "sawtooth", 0.15);
                this.g.audio.playTone(
                    110,
                    1.2,
                    "sawtooth",
                    0.12,
                    0.2,
                );
                this.g.notify(
                    `[BOSS WAVE ${this.wave}] A mighty force approaches!`,
                );
                this.g.shake = 15;
            } else {
                this.g.audio.playTone(400, 0.5, "sine", 0.1);
                this.g.notify(
                    `Endless Wave ${this.wave} — Difficulty x${(1 + this.wave * 0.18).toFixed(1)}`,
                );
            }
            this.int = Math.max(240, 700 - this.wave * 12);
        }
    }
    spawn() {
        const types = [
            "rabble",
            "marauder",
            "berserker",
            "shieldman",
            "archer",
            "shaman",
            "ogre",
            "necromancer",
        ];
        const c = Math.floor(6 + this.wave * 3);
        const maxT = Math.min(
            types.length - 1,
            Math.floor(this.wave / 2),
        ); // Fix #10
        for (let i = 0; i < c; i++) {
            setTimeout(() => {
                if (this.g.state === "playing") {
                    const enemyType =
                        types[randInt(0, maxT)] || types[0];
                    this.g.spawnEnemy(
                        enemyType,
                        CONFIG.WORLD_WIDTH - rand(50, 300),
                        CONFIG.GROUND_Y,
                    );
                }
            }, i * 500);
        }
        if (this.wave % 5 === 0)
            setTimeout(
                () => {
                    if (this.g.state === "playing")
                        this.g.spawnEnemy(
                            "dragon",
                            CONFIG.WORLD_WIDTH - 150,
                            CONFIG.GROUND_Y,
                        );
                },
                c * 500 + 1000,
            );
    }
    isComplete() {
        return false;
    }
}
