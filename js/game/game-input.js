// --- GAME: event binding, spell selection & formations ---
Object.assign(Game.prototype, {
    bindEvents() {
        // Native hover titles on the recruit/build bars explaining each role
        const idFor = (t) =>
            "btn" + t.charAt(0).toUpperCase() + t.slice(1);
        Object.entries(UNIT_TYPES).forEach(([t, d]) => {
            const btn = document.getElementById(idFor(t));
            if (btn && d.desc) btn.title = `${d.name} — ${d.desc}`;
        });
        Object.entries(BUILDING_TYPES).forEach(([t, d]) => {
            const btn = document.getElementById(idFor(t));
            if (btn && d.desc) btn.title = `${d.name} — ${d.desc}`;
        });

        this.canvas.addEventListener("mousemove", (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            const w = this.camera.toWorld(e.clientX, e.clientY);
            const tt = document.getElementById("tooltip");
            let hov = null;

            for (const u of [...this.units, ...this.enemies])
                if (
                    Math.abs(u.x - w.x) < 35 &&
                    Math.abs(u.y - w.y) < 60
                )
                    hov = u;
            if (!hov)
                for (const b of this.buildings)
                    if (
                        Math.abs(b.x - w.x) < b.w / 2 &&
                        w.y > b.y - b.h &&
                        w.y < b.y
                    )
                        hov = b;

            if (hov) {
                tt.classList.remove("hidden");
                tt.style.left =
                    Math.min(
                        e.clientX + 20,
                        window.innerWidth - 320,
                    ) + "px"; // Fix #14
                tt.style.top = e.clientY + 20 + "px";
                const def =
                    BUILDING_TYPES[hov.type] ||
                    (hov.team === TEAMS.PLAYER
                        ? UNIT_TYPES[hov.type]
                        : ENEMY_TYPES[hov.type]);
                if (def) {
                    const mu = describeMatchups(def);
                    tt.innerHTML = `<div class="tt-name">${def.name}</div><div class="tt-desc">${def.desc || ""}</div>HP: ${Math.floor(hov.hp)}/${hov.maxHp}<br>${def.dmg ? "DMG: " + def.dmg + "<br>" : ""}${def.armor ? "Armor: " + def.armor + "<br>" : ""}${mu ? `<span style="font-size:11px;">${mu}</span>` : ""}`;
                }
            } else {
                tt.classList.add("hidden");
            }
        });

        // FIX: Hide tooltip and stop edge-scroll when mouse leaves canvas
        this.canvas.addEventListener("mouseleave", () => {
            this.mouse.x = -1000;
            this.mouse.y = -1000;
            document.getElementById("tooltip").classList.add("hidden");
        });

        this.canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || this.spells.active) return;
            const w = this.camera.toWorld(e.clientX, e.clientY);
            let c = null;
            for (const u of [...this.units, ...this.enemies])
                if (
                    Math.abs(u.x - w.x) < 35 &&
                    Math.abs(u.y - w.y) < 60
                )
                    c = u;
            if (!c)
                for (const b of this.buildings)
                    if (
                        Math.abs(b.x - w.x) < b.w / 2 &&
                        w.y > b.y - b.h &&
                        w.y < b.y
                    )
                        c = b;
            this.sel = c;
            this.updateSelUI();
        });

        // Touch Listeners (Fix #1 & #15)
        let touchStartX = null;
        this.canvas.addEventListener(
            "touchstart",
            (e) => {
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    if (!this.spells.active) {
                        const w = this.camera.toWorld(
                            e.touches[0].clientX,
                            e.touches[0].clientY,
                        );
                        let c = null;
                        for (const u of [
                            ...this.units,
                            ...this.enemies,
                        ])
                            if (
                                Math.abs(u.x - w.x) < 45 &&
                                Math.abs(u.y - w.y) < 80
                            )
                                c = u;
                        if (!c)
                            for (const b of this.buildings)
                                if (
                                    Math.abs(b.x - w.x) < b.w / 2 &&
                                    w.y > b.y - b.h &&
                                    w.y < b.y
                                )
                                    c = b;
                        this.sel = c;
                        this.updateSelUI();
                    }
                }
            },
            { passive: true },
        );
        this.canvas.addEventListener(
            "touchmove",
            (e) => {
                if (touchStartX !== null && !this.spells.active) {
                    const dx = touchStartX - e.touches[0].clientX;
                    this.camera.pan(dx * 2);
                    touchStartX = e.touches[0].clientX;
                }
            },
            { passive: true },
        );
        this.canvas.addEventListener("touchend", () => {
            touchStartX = null;
        });

        // Mobile Auto-Queue Long Press (Fix #15)
        document.querySelectorAll(".unit-btn").forEach((btn) => {
            let t;
            btn.addEventListener(
                "touchstart",
                (e) => {
                    t = setTimeout(() => {
                        const type = btn.id
                            .replace("btn", "")
                            .toLowerCase();
                        this.toggleAuto(type);
                        if (navigator.vibrate)
                            navigator.vibrate(50);
                    }, 500);
                },
                { passive: true },
            );
            btn.addEventListener("touchend", () => clearTimeout(t));
            btn.addEventListener("touchmove", () =>
                clearTimeout(t),
            );
        });

        // Keyboard
        window.addEventListener("keydown", (e) => {
            if (this.state !== "playing") return;
            const k = e.key.toLowerCase();
            const m = {
                1: "militia",
                2: "swordsman",
                3: "spearman",
                4: "archer",
                5: "crossbow",
                6: "cleric",
                7: "knight",
                8: "mage",
                9: "catapult",
                0: "paladin",
                q: "mine",
                w: "barracks",
                e: "tower",
                r: "wall",
                t: "academy",
                f: "obelisk",
                g: "archery",
                h: "forge",
            };
            if (m[k]) {
                if ("1234567890".includes(k) && UNIT_TYPES[m[k]]) this.buyUnit(m[k]);
                else if (BUILDING_TYPES[m[k]]) this.build(m[k]);
            }
            if ("0123456789".includes(k)) { if (m[k]) this.buyUnit(m[k]); }
            if (k === " " || k === "p" || k === "escape")
                this.setSpeed(this.ts === 0 ? 1 : 0);
            if (k === "y") this.openTechTree();
            if (k === "n") this.callWave();
            if (e.code === "ArrowLeft" || e.code === "KeyA")
                this.camera.pan(-40);
            if (e.code === "ArrowRight" || e.code === "KeyD")
                this.camera.pan(40);
        });

        // Minimap
        const mm = document.getElementById("minimap");
        mm.addEventListener("mousedown", (e) => {
            const rect = mm.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            this.camera.tX =
                pct * CONFIG.WORLD_WIDTH -
                window.innerWidth / this.camera.z / 2;
        });
        mm.addEventListener(
            "touchstart",
            (e) => {
                const rect = mm.getBoundingClientRect();
                const pct =
                    (e.touches[0].clientX - rect.left) / rect.width;
                this.camera.tX =
                    pct * CONFIG.WORLD_WIDTH -
                    window.innerWidth / this.camera.z / 2;
            },
            { passive: true },
        );
    },

    selectSpell(spellId) {
        this.spells.select(spellId);
    },

    setFormation(f) {
        this.formation = f;
        ['defensive','standard','aggressive'].forEach(id => {
            const b = document.getElementById('fBtn-' + id);
            if (b) b.classList.toggle('active', id === f);
        });
    },
});
