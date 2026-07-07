import { CONFIG } from '../config.js';
import { el } from '../ui/dom.js';
import { btnId, costStr, formatTime } from '../utils.js';
import { defOf, describeMatchups, waveHint } from '../systems/combat.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { TECH_TREE } from '../data/tech.js';
import { UNIT_TYPES } from '../data/units.js';

// --- GAME: panels, notifications, HUD & minimap (installed by install-mixins.js) ---
export const uiMethods = /** @type {ThisType<any>} */ ({
    openTechTree() {
        if (this.state !== "playing") return;
        this.setSpeed(0);
        const c = el("techTreeContent");
        c.innerHTML = "";
        TECH_TREE.forEach((t) => {
            const o = this.techs.has(t.id);
            c.innerHTML += `<div class="tech-item ${o ? "owned" : ""}">
    <div style="font-weight:800;color:${o ? "var(--success)" : "var(--gold)"};font-size:15px;">${t.name} ${o ? "✓" : ""}</div>
    <div style="font-size:13px;color:var(--text-dim);flex-grow:1;">${t.desc}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span style="color:var(--gold);font-weight:800; font-size:14px;">${t.cost}g</span>
        <button class="tech-btn" ${o || this.gold < t.cost ? "disabled" : ""} onclick="game.buyTech('${t.id}')">${o ? "Researched" : "Research"}</button>
    </div></div>`;
        });
        el("techTree").classList.remove("hidden");
    },

    closeTechTree() {
        el("techTree").classList.add("hidden");
        this.setSpeed(1);
    },

    openAchievements() {
        if (this.achievements) this.achievements.render();
        el('achievementsOverlay').classList.remove('hidden');
    },

    openWarCouncil() {
        if (this.meta) this.meta.renderCouncil();
        el('warCouncilOverlay').classList.remove('hidden');
    },

    // Bottom action bar: toggle the Units / Buildings groups. Buttons stay in
    // the DOM (only the wrapper is display:none) so the per-frame updateUI()
    // and getElementById calls keep working on the hidden group.
    setActionTab(tab) {
        this.actionTab = tab;
        const units = tab === 'units';
        el('unitButtons').classList.toggle('is-hidden', !units);
        el('buildingButtons').classList.toggle('is-hidden', units);
        el('tabUnits').classList.toggle('active', units);
        el('tabBuildings').classList.toggle('active', !units);
    },

    openSettings() {
        el("settingsOverlay").classList.remove("hidden");
    },

    closeSettings() {
        this.audio.vols.sound =
            el("volSound").value / 100;
        this.audio.vols.music =
            el("volMusic").value / 100;
        this.audio.updateVols();
        el("settingsOverlay").classList.add("hidden");
        this.saveGame();
    },

    showHelp() {
        el("helpOverlay").classList.remove("hidden");
    },

    notify(m) {
        const a = el("notificationArea");
        if (a.children.length > 4) a.removeChild(a.firstChild); // Fix #13
        const d = document.createElement("div");
        d.className = "notification";
        d.innerText = m;
        a.appendChild(d);
        setTimeout(() => {
            if (d.parentNode) d.remove();
        }, 4000);
    },

    updateSelUI() {
        const e = el("selectedInfo");
        if (!this.sel) {
            e.innerText =
                "Click a unit or building to view details.";
            return;
        }
        const s = this.sel,
            d = defOf(s);
        const mu = describeMatchups(d);
        e.innerHTML = `<strong style="color:var(--gold);font-size:15px; letter-spacing:1px; text-transform:uppercase;">${d ? d.name : "Unknown"}</strong><br>HP: ${Math.floor(s.hp)}/${s.maxHp}<br>${s.dmg ? "Damage: " + Math.round(s.dmg) + "<br>" : ""}${s.armor ? "Armor: " + s.armor + "<br>" : ""}${mu ? `<span style="font-size:12px;">${mu}</span>` : ""}`;
    },

    updateUI() {
        this.updateBossBar(); // sync boss health bar while an encounter is live
        el("goldDisplay").innerText = Math.floor(this.gold);
        // Income per second display
        const incomeMult2 = 1 + (this.upgrades.income || 0);
        const lvlMult2 = this.levelIncomeMult || 1;
        let incomePerSec = 0;
        this.buildings.forEach(b => {
            if (b.active && !b.building && b.income && b.income.g)
                incomePerSec += b.income.g * incomeMult2 * lvlMult2;
        });
        const irEl = el("incomeRate");
        if (irEl) irEl.innerText = incomePerSec > 0 ? `+${incomePerSec.toFixed(0)}/s` : "";
        el("ironDisplay").innerText =
            Math.floor(this.iron);
        el("crystalDisplay").innerText =
            Math.floor(this.crystal);
        el("popDisplay").innerText =
            this.pop + "/" + this.maxPop;
        el("levelDisplay").innerText =
            this.mode === "campaign" ? this.level + 1 : "∞";

        const c = this.buildings.find((b) => b.type === "castle");
        if (c) {
            el(
                "castleHealthFill",
            ).style.width =
                (Math.max(0, c.hp) / c.maxHp) * 100 + "%";
            el("castleHealthText").innerText =
                Math.floor(Math.max(0, c.hp)) + " / " + c.maxHp;
        }

        if (this.waveM) {
            if (this.mode === "endless") {
                const w = this.waveM;
                const nxt = Math.max(
                    0,
                    Math.floor((w.int - w.t) / 60),
                );
                el("waveTimer").innerText =
                    "Next Wave: " + nxt + "s";
                const isBossW = w.wave > 0 && w.wave % 5 === 0;
                const wnEl = el("waveNumber");
                wnEl.innerText =
                    "Endless - Wave " +
                    w.wave +
                    (isBossW ? " [BOSS WAVE]" : "");
                if (isBossW) wnEl.classList.add("boss-wave");
                else wnEl.classList.remove("boss-wave");
            } else {
                const w = this.waveM;
                const nxt =
                    w.cw < w.tw
                        ? Math.max(
                              0,
                              Math.floor(
                                  (w.wvs[w.cw].time * 60 - w.t) /
                                      60,
                              ),
                          )
                        : 0;
                el("waveTimer").innerText =
                    w.cw < w.tw
                        ? "Next Wave: " + nxt + "s"
                        : "Final Wave!";
                el("waveNumber").innerText =
                    "Wave " + w.cw + " / " + w.tw;
            }
            const cwBtn = el("btnCallWave");
            if (cwBtn)
                cwBtn.style.display = this.waveM.canCall()
                    ? "inline-block"
                    : "none";
        }

        // Wave preview + tactical counter hint
        const prevEl = el("wavePreview");
        if (prevEl && this.waveM) {
            let groups = null;
            if (this.mode === "campaign") {
                const wm = this.waveM;
                if (wm.cw < wm.tw && wm.wvs[wm.cw])
                    groups = wm.wvs[wm.cw].enemies;
            } else {
                groups = this.waveM.composition(this.waveM.wave + 1);
            }
            if (groups) {
                const str = groups
                    .filter((gr) => gr.c > 0)
                    .map((gr) => {
                        const d2 = ENEMY_TYPES[gr.t];
                        return `${d2 ? d2.name : gr.t} ×${gr.c}`;
                    })
                    .join(" · ");
                prevEl.innerHTML = `⚠ <span style="color:#fca5a5;">${str}</span><br><span style="color:#7dd3fc;font-size:11px;">${waveHint(groups)}</span>`;
            } else prevEl.innerHTML = "";
        } else if (prevEl) prevEl.innerHTML = "";
        el("statKills").innerText = this.stats.kills;
        el("statGold").innerText = Math.floor(
            this.stats.gold,
        );
        el("statLosses").innerText =
            this.stats.loss;
        el("statTime").innerText = formatTime(
            (Date.now() - this.stats.start) / 1000,
        );

        // Which building unlocks each unit (for the lock label)
        const unlockedBy = {};
        for (const [bt, bd] of Object.entries(BUILDING_TYPES))
            if (bd.unlock)
                bd.unlock.forEach((u) => (unlockedBy[u] = bd.name));

        // Recruit buttons — one per unit type (ids derived from the data table).
        for (const t of Object.keys(UNIT_TYPES)) {
            const b = el(btnId(t)),
                d = UNIT_TYPES[t];
            if (!b) continue;
            const locked = !this.unlocked.u.has(t);
            const cost = this.unitCost(t);
            b.disabled =
                locked ||
                !this.checkCost(cost) ||
                this.pop + d.pop > this.maxPop;
            const cs = b.querySelector(".cost");
            if (cs)
                cs.innerText = locked
                    ? `🔒 ${unlockedBy[t] || "?"}`
                    : costStr(cost);
        }
        // Build buttons — castle has no button, so getElementById skips it.
        for (const t of Object.keys(BUILDING_TYPES)) {
            const b = el(btnId(t));
            if (!b) continue;
            const cost = this.buildCost(t);
            b.disabled =
                !this.checkCost(cost) || !this.unlocked.b.has(t);
            if (t === "mine") {
                const cs = b.querySelector(".cost");
                if (cs) cs.innerText = costStr(cost);
            }
        }

        const td = el("activeUpgrades");
        if (this.techs.size === 0)
            td.innerHTML =
                '<div class="stat-row"><span>No upgrades purchased</span></div>';
        else {
            td.innerHTML = "";
            this.techs.forEach((id) => {
                const t = TECH_TREE.find((x) => x.id === id);
                if (t)
                    td.innerHTML += `<div class="stat-row"><span>${t.name}</span><span style="color:var(--success)">Active</span></div>`;
            });
        }
    },

    drawMinimap() {
        const mc = el("minimap"),
            cx = mc.getContext("2d");
        const mw = mc.width,
            mh = mc.height;
        cx.clearRect(0, 0, mw, mh);

        const sX = mw / CONFIG.WORLD_WIDTH;

        this.buildings.forEach((b) => {
            if (!b.active) return;
            cx.fillStyle =
                b.type === "castle" ? "#fbbf24" : "#3b82f6";
            cx.fillRect(b.x * sX - 2, mh - 12, 4, 10);
        });
        this.units.forEach((u) => {
            if (u.active) {
                cx.fillStyle = "#34d399";
                cx.fillRect(u.x * sX, mh - 8, 2, 4);
            }
        });
        this.enemies.forEach((e) => {
            if (!e.active) return;
            if (e.isBoss) {
                // The boss gets a larger, unmistakable marker.
                cx.fillStyle = "#a855f7";
                cx.fillRect(e.x * sX - 3, mh - 13, 6, 11);
            } else {
                cx.fillStyle = "#ef4444";
                cx.fillRect(e.x * sX, mh - 8, 2, 4);
            }
        });

        cx.strokeStyle = "rgba(255,255,255,0.6)";
        cx.lineWidth = 1;
        cx.strokeRect(
            this.camera.x * sX,
            1,
            (window.innerWidth / this.camera.z) * sX,
            mh - 2,
        );
    },
});
