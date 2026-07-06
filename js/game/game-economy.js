// --- GAME: resources, recruiting, building & tech ---
Object.assign(Game.prototype, {
    addGold(a) {
        this.gold += a;
        this.stats.gold += a;
    },

    checkCost(c) {
        return (
            this.gold >= (c.g || 0) &&
            this.iron >= (c.i || 0) &&
            this.crystal >= (c.c || 0)
        );
    },

    payCost(c) {
        this.gold -= c.g || 0;
        this.iron -= c.i || 0;
        this.crystal -= c.c || 0;
    },

    toggleAuto(type) {
        if (!this.unlocked.u.has(type)) return;
        this.autoQueue[type] = !this.autoQueue[type];
        const btn = document.getElementById(
            "btn" + type.charAt(0).toUpperCase() + type.slice(1),
        );
        if (this.autoQueue[type]) {
            btn.classList.add("auto-queued");
            this.audio.playTone(800, 0.1, "sine", 0.1);
        } else {
            btn.classList.remove("auto-queued");
            this.audio.playTone(400, 0.1, "sine", 0.1);
        }
    },

    buyUnit(t, auto = false) {
        if (this.state !== "playing" || !this.unlocked.u.has(t))
            return false;
        const d = UNIT_TYPES[t];
        if (!this.checkCost(d.cost)) {
            if (!auto) {
                this.audio.playError();
                this.notify("Insufficient Resources.");
            }
            return false;
        }
        if (this.pop + d.pop > this.maxPop) {
            if (!auto) {
                this.audio.playError();
                this.notify("Population Limit Reached.");
            }
            return false;
        }
        this.payCost(d.cost);
        this.pop += d.pop;
        const u = new Unit(150 + rand(-20, 20), t, TEAMS.PLAYER);
        u.applyUpgrades(this.upgrades);
        if (this.upgrades.forge && !UNIT_TYPES[t].ranged)
            u.dmg = Math.ceil(u.dmg * (1 + this.upgrades.forge));
        this.units.push(u);
        if (!auto) this.audio.playBuild();
        return true;
    },

    build(t) {
        if (this.state !== "playing" || !this.unlocked.b.has(t))
            return;
        const d = BUILDING_TYPES[t];
        if (!this.checkCost(d.cost)) {
            this.audio.playError();
            this.notify("Insufficient Resources.");
            return;
        }
        let bx = 380;
        while (
            this.buildings.some(
                (b) => Math.abs(b.x - bx) < b.w + 40,
            )
        )
            bx += 110;
        if (bx > 1400) {
            this.audio.playError();
            this.notify("No space near castle!");
            return;
        }
        this.payCost(d.cost);
        const b = new Building(bx, t, TEAMS.PLAYER);
        this.buildings.push(b);
        if (d.unlock)
            d.unlock.forEach((u) => this.unlocked.u.add(u));
        this.audio.playBuild();
    },

    spawnEnemy(t, x, y) {
        const e = new Unit(x, t, TEAMS.ENEMY);
        e.maxHp *= (this.diff || 1) * (this.difficultyMult || 1);
        e.dmg   *= (this.diff || 1) * (this.difficultyMult || 1);
        e.hp = e.maxHp;
        this.enemies.push(e);
    },

    buyTech(id) {
        const t = TECH_TREE.find((x) => x.id === id);
        if (!t || this.techs.has(id) || this.gold < t.cost) return;
        this.gold -= t.cost;
        this.techs.add(id);
        this.upgrades[t.type] =
            (this.upgrades[t.type] || 0) + t.val;
        if (t.applies === "magic")
            this.upgrades.magic_damage =
                (this.upgrades.magic_damage || 0) + t.val; // Fix #9

        if (t.type === "pop") this.maxPop += t.val;
        if (t.type === "mana") {
            this.spells.maxMana += t.val;
            this.spells.mana += t.val;
        }
        if (t.type === "crystal_inc")
            this.upgrades.crystal_inc =
                (this.upgrades.crystal_inc || 0) + t.val;
        this.audio.playCoin();
        this.openTechTree();
        this.updateUI();
    },
});
