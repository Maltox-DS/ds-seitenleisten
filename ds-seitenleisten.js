/*
 * DS – Seitenleisten & Angriffs-Alarm (by Maltox)
 * Eigentlicher Code. Wird vom Loader ds-seitenleisten.user.js immer in der
 * neuesten Version von GitHub geladen – nicht direkt in Tampermonkey installieren.
 * Stand: 1.4
 */

(function () {
    'use strict';

    // ===================== EINSTELLUNGEN =====================
    const CONFIG = {
        // Welche Leisten auf welche Seite (Titel wie in der Dorfübersicht)
        left:  ['Deine Truppen'],
        right: ['Produktion', 'Bauschleife', 'Einheiten', 'Account-Manager'],
        panelWidth: 320,   // max. Breite einer Leiste in px
        minWidth: 220,     // darunter wird die Leiste ausgeblendet (zu wenig Platz)
        gap: 24,           // Abstand zum Spielbereich
        top: 70,           // Abstand von oben in px
        alarm: true,       // Angriffs-Balken an/aus
        alarmBlinkTitle: true // Tab-Titel blinkt bei Angriffen (solange nicht weggeklickt)
    };
    // =========================================================

    if (window.__dsSeitenleisten) return;
    window.__dsSeitenleisten = true;

    const gd = window.game_data || (window.TribalWars && TribalWars.getGameData && TribalWars.getGameData());
    if (!gd) return;

    const KEY = `dsSide_${gd.world}_${gd.player.id}_${gd.village.id}`;
    const KEY_COLLAPSE = `dsSideCollapsed_${gd.world}_${gd.player.id}`;
    const KEY_DISMISS = `dsAlarmDismissed_${gd.world}_${gd.player.id}`;
    const now = () => Date.now();
    const CACHE_VERSION = 2; // erhöhen, wenn sich das Format der gespeicherten Leisten ändert

    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    };

    // ---------- Hilfen ----------
    const norm = s => (s || '').toLowerCase().replace(/[\s\-–]/g, '');
    const titleOf = w => {
        const h = w.querySelector('h4, .head');
        return h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    const fmt = s => {
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };
    // Abstand Serverzeit – lokale Uhr in ms (Timing liefert je nach Version ms oder s)
    const serverOffset = () => {
        try {
            if (!(window.Timing && Timing.getCurrentServerTime)) return 0;
            let t = +Timing.getCurrentServerTime();
            if (t && t < 1e12) t *= 1000;
            const off = t - now();
            return Math.abs(off) < 3600e3 ? off : 0; // Unsinn ignorieren
        } catch (e) { return 0; }
    };
    const TIME_RE = /^(\d+):(\d{2}):(\d{2})$/;
    const parseDur = txt => {
        const m = (txt || '').trim().match(TIME_RE);
        return m ? ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 : null;
    };
    const TIMER_SEL = '[data-endtime], .timer, .widget-command-timer, .timer_link';

    // Endzeit (lokal, ms) eines Timer-Elements bestimmen
    function endOf(el, off) {
        if (el.dataset.endtime) {
            let e = +el.dataset.endtime;
            if (e < 1e12) e *= 1000; // Sekunden -> ms
            return e - off;
        }
        const d = parseDur(el.textContent);
        return d === null ? null : now() + d;
    }

    // "heute um 02:49:42" / "morgen um ..." in absolute Zeit umwandeln (für Datumswechsel)
    function markArrivals(root) {
        root.querySelectorAll('*').forEach(el => {
            if (el.children.length && !el.querySelector('span.grey, span.small')) return;
            const m = el.textContent.trim().match(/^(heute|morgen) um (\d{1,2}):(\d{2}):(\d{2})/);
            if (!m || el.dataset.dsabs) return;
            const d = new Date();
            if (m[1] === 'morgen') d.setDate(d.getDate() + 1);
            d.setHours(+m[2], +m[3], +m[4], 0);
            el.dataset.dsabs = d.getTime();
            el.dataset.dsrest = el.textContent.trim().slice(m[0].length); // z.B. Millisekunden
        });
    }

    // Countdown-Timer im Klon vorbereiten
    function markTimers(root, name) {
        const off = serverOffset();

        if (name === 'Bauschleife') {
            // Bauaufträge laufen NACHEINANDER: nur der erste zählt, die anderen
            // zeigen ihre Dauer und starten, wenn der vorherige fertig ist.
            const rows = [...root.querySelectorAll('tr, li, .queueItem')]
                .filter(r => !r.querySelector('tr, li'));
            let prevEnd = null;
            rows.forEach(r => {
                let el = r.querySelector('[data-endtime]');
                if (!el) el = [...r.querySelectorAll('*')].find(e => !e.children.length && parseDur(e.textContent) !== null);
                if (!el) return;
                let end;
                if (prevEnd === null || el.dataset.endtime) {
                    end = endOf(el, off);
                    if (end === null) return;
                    if (prevEnd !== null) el.dataset.dsstart = prevEnd; // falls Spiel absolute Endzeiten liefert
                } else {
                    const dur = parseDur(el.textContent);
                    if (dur === null) return;
                    el.dataset.dsstart = prevEnd;
                    el.dataset.dsdur = dur;
                    end = prevEnd + dur;
                }
                el.dataset.dsend = end;
                prevEnd = end;
            });
        } else {
            // Nur echte Spiel-Timer verwenden – keine Uhrzeiten wie "02:49:42"
            root.querySelectorAll(TIMER_SEL).forEach(el => {
                if (el.querySelector(TIMER_SEL)) return;
                const end = endOf(el, off);
                if (end !== null) el.dataset.dsend = end;
            });
        }

        markArrivals(root);

        neutralize(root);
    }

    // Spiel-Timer-Merkmale entfernen: Sonst findet das Spiel (oder ein anderes Skript)
    // unsere Kopien und überschreibt die Restzeit mit falschen Werten.
    function neutralize(root) {
        root.querySelectorAll('[data-endtime], .timer, .widget-command-timer, .timer_link').forEach(el => {
            el.classList.remove('timer', 'widget-command-timer', 'timer_link');
            [...el.attributes].forEach(a => {
                if (a.name.startsWith('data-') && !a.name.startsWith('data-ds')) el.removeAttribute(a.name);
            });
        });
    }

    // ---------- Auf der Dorfübersicht: Leisten speichern ----------
    function cacheOverview() {
        const wanted = [...CONFIG.left, ...CONFIG.right];
        const out = {};
        [...document.querySelectorAll('div.widget, div.moveable')]
            .filter(w => w.querySelectorAll('h4').length === 1) // keine ganzen Spalten
            .forEach(w => {
                const t = norm(titleOf(w));
                const name = wanted.find(n => t.startsWith(norm(n)));
                if (!name || out[name]) return;
                const clone = w.cloneNode(true);
                markTimers(clone, name);
                out[name] = clone.outerHTML;
            });
        if (Object.keys(out).length) store.set(KEY, { cv: CACHE_VERSION, t: now(), w: out });
    }

    // ---------- Auf allen anderen Seiten: Leisten anzeigen ----------
    function findContent() {
        const list = ['#contentContainer', '#content_value', '.maincell']
            .map(s => document.querySelector(s)).filter(Boolean);
        return list.find(el => el.getBoundingClientRect().width < window.innerWidth - 100) || list[0];
    }

    function ago(t) {
        const min = Math.round((now() - t) / 60000);
        if (min < 1) return 'gerade eben';
        if (min < 60) return `vor ${min} min`;
        const h = Math.floor(min / 60);
        return `vor ${h} h ${min % 60} min`;
    }

    function renderPanels() {
        const content = findContent();
        if (!content) return;

        let data = store.get(KEY, null);
        if (data && data.cv !== CACHE_VERSION) data = null; // veraltete Leisten ignorieren
        const collapsed = store.get(KEY_COLLAPSE, {});

        const overviewUrl = `/game.php?village=${gd.village.id}&screen=overview` +
            (gd.player.sitter && gd.player.sitter !== '0' ? `&t=${gd.player.id}` : '');

        const makeCard = name => {
            const card = document.createElement('section');
            card.className = 'dsCard' + (collapsed[name] ? ' dsCollapsed' : '');

            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'dsCardHead';
            head.innerHTML = `<span class="dsCardTitle"></span><span class="dsChevron">▾</span>`;
            head.querySelector('.dsCardTitle').textContent = name;
            head.addEventListener('click', () => {
                card.classList.toggle('dsCollapsed');
                const c = store.get(KEY_COLLAPSE, {});
                c[name] = card.classList.contains('dsCollapsed');
                store.set(KEY_COLLAPSE, c);
            });

            const body = document.createElement('div');
            body.className = 'dsCardBody';
            body.innerHTML = data.w[name];
            neutralize(body);

            card.append(head, body);
            return card;
        };

        const makePanel = (side, names) => {
            const p = document.createElement('aside');
            p.className = 'dsSide';
            p.id = 'dsSide_' + side;

            if (data) names.forEach(n => { if (data.w[n]) p.appendChild(makeCard(n)); });

            const foot = document.createElement('div');
            foot.className = 'dsSideFoot';
            foot.innerHTML = data
                ? `<span>Stand <b class="dsAgo">${ago(data.t)}</b></span><a href="${overviewUrl}">↻ aktualisieren</a>`
                : `<span>Noch keine Daten für dieses Dorf</span><a href="${overviewUrl}">Übersicht öffnen</a>`;
            p.appendChild(foot);

            document.body.appendChild(p);
            return p;
        };

        const left = makePanel('left', CONFIG.left);
        const right = makePanel('right', CONFIG.right);

        const position = () => {
            const r = content.getBoundingClientRect();
            const lw = Math.min(CONFIG.panelWidth, r.left - CONFIG.gap * 2);
            const rw = Math.min(CONFIG.panelWidth, window.innerWidth - r.right - CONFIG.gap * 2);
            left.style.display = lw >= CONFIG.minWidth ? '' : 'none';
            right.style.display = rw >= CONFIG.minWidth ? '' : 'none';
            left.style.width = lw + 'px';
            left.style.left = (r.left - CONFIG.gap - lw) + 'px';
            right.style.width = rw + 'px';
            right.style.left = (r.right + CONFIG.gap) + 'px';
        };
        position();
        tick();
        window.addEventListener('resize', position);
        setInterval(position, 2000);

        setInterval(() => {
            if (data) document.querySelectorAll('.dsAgo').forEach(el => el.textContent = ago(data.t));
        }, 30000);
    }

    // ---------- Countdowns laufen lassen ----------
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    function tick() {
        const t = now();
        document.querySelectorAll('.dsSide [data-dsend]').forEach(el => {
            const end = +el.dataset.dsend;
            const start = el.dataset.dsstart ? +el.dataset.dsstart : null;
            const row = el.closest('tr, li, .queueItem');
            if (start !== null && t < start) {
                // wartet noch in der Bauschleife: feste Dauer anzeigen
                el.textContent = fmt(Math.round((end - start) / 1000));
                el.classList.add('dsWaiting');
                el.classList.remove('dsSoon');
                return;
            }
            el.classList.remove('dsWaiting');
            const s = Math.max(0, Math.round((end - t) / 1000));
            if (s === 0) {
                // fertig / angekommen: Zeile ausblenden
                if (row) row.classList.add('dsDone');
                el.textContent = 'fertig';
                return;
            }
            if (s > 30 * 86400) { el.textContent = '–'; return; } // unplausibel
            el.textContent = fmt(s);
            el.classList.toggle('dsSoon', s < 600);
        });
        // "heute / morgen um" nach Mitternacht korrekt halten
        const today = new Date(t), tomorrow = new Date(t + 864e5);
        document.querySelectorAll('.dsSide [data-dsabs]').forEach(el => {
            const d = new Date(+el.dataset.dsabs);
            const hms = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const day = sameDay(d, today) ? 'heute'
                : sameDay(d, tomorrow) ? 'morgen'
                : 'am ' + d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + '.';
            const txt = `${day} um ${hms}${el.dataset.dsrest || ''}`;
            if (el.textContent !== txt) el.textContent = txt;
        });
    }
    setInterval(tick, 1000);

    // ---------- Angriffs-Alarm ----------
    function incomingCount() {
        const el = document.querySelector('#incomings_amount');
        if (el) {
            const n = parseInt(el.textContent.replace(/\D/g, ''), 10);
            if (!isNaN(n)) return n;
        }
        return parseInt(gd.player.incomings, 10) || 0;
    }

    function setupAlarm() {
        const link = document.querySelector('#incomings_cell a, a[href*="mode=incomings"]');
        const href = link ? link.href
            : `/game.php?village=${gd.village.id}&screen=overview_villages&mode=incomings&type=unignored&subtype=attacks`;

        const bar = document.createElement('div');
        bar.id = 'dsAttackBar';
        bar.innerHTML = `
            <a class="dsAttackLink" href="${href}">
                <span class="dsAttackIcon">⚔</span>
                <span class="dsAttackText"></span>
                <span class="dsAttackHint">zur Übersicht →</span>
            </a>
            <button type="button" class="dsAttackClose" title="Ausblenden – kommt wieder, wenn neue Angriffe dazukommen">✕</button>`;
        document.body.appendChild(bar);

        const textEl = bar.querySelector('.dsAttackText');
        const origTitle = document.title;
        let blink = false;

        // "dismissed" = Anzahl Angriffe zum Zeitpunkt des Wegklickens
        const isHidden = n => n <= store.get(KEY_DISMISS, -1);

        bar.querySelector('.dsAttackClose').addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            store.set(KEY_DISMISS, incomingCount());
            update();
        });

        function update() {
            const n = incomingCount();
            // Werden es weniger, Schwelle mitziehen – damit jeder neue Angriff wieder auslöst
            const d = store.get(KEY_DISMISS, -1);
            if (d > n) store.set(KEY_DISMISS, n === 0 ? -1 : n);

            if (n > 0 && !isHidden(n)) {
                textEl.textContent = n === 1 ? '1 EINGEHENDER ANGRIFF' : `${n} EINGEHENDE ANGRIFFE`;
                bar.classList.add('dsShow');
                document.body.style.paddingBottom = '64px';
            } else {
                bar.classList.remove('dsShow');
                document.body.style.paddingBottom = '';
                document.title = origTitle;
            }
        }
        update();

        const target = document.querySelector('#incomings_amount');
        if (target) new MutationObserver(update).observe(target, { childList: true, characterData: true, subtree: true });
        setInterval(update, 3000);
        window.addEventListener('storage', e => { if (e.key === KEY_DISMISS) update(); }); // andere Tabs

        if (CONFIG.alarmBlinkTitle) setInterval(() => {
            const n = incomingCount();
            if (!n || isHidden(n)) return;
            blink = !blink;
            document.title = blink ? `⚔ ${n} ANGRIFF${n === 1 ? '' : 'E'}! ⚔` : origTitle;
        }, 1000);
    }

    // ---------- Styles ----------
    const css = document.createElement('style');
    css.textContent = `
        .dsSide {
            position: fixed; top: ${CONFIG.top}px; z-index: 50;
            max-height: calc(100vh - ${CONFIG.top + 80}px); overflow-y: auto;
            display: flex; flex-direction: column; gap: 10px;
            padding: 4px; scrollbar-width: thin; scrollbar-color: #8a5a2b transparent;
            font-family: Verdana, Arial, sans-serif;
        }
        .dsCard {
            background: linear-gradient(#fbf3dd, #f1e1b8);
            border: 1px solid #7d510f; border-radius: 6px; overflow: hidden;
            box-shadow: 0 3px 10px rgba(60, 30, 0, .35), inset 0 1px 0 rgba(255,255,255,.6);
        }
        .dsCardHead {
            all: unset; box-sizing: border-box; cursor: pointer; width: 100%;
            display: flex; align-items: center; justify-content: space-between;
            padding: 7px 10px;
            background: linear-gradient(#7a4a1c, #5a3210);
            border-bottom: 2px solid #c8a24a;
            color: #f8e7b5; font: bold 12px Verdana, sans-serif;
            letter-spacing: .6px; text-transform: uppercase;
            text-shadow: 0 1px 1px #000;
        }
        .dsCardHead:hover { background: linear-gradient(#8a5524, #643914); }
        .dsCardHead:focus-visible { outline: 2px solid #ffd76a; outline-offset: -2px; }
        .dsChevron { transition: transform .2s; font-size: 13px; }
        .dsCollapsed .dsChevron { transform: rotate(-90deg); }
        .dsCollapsed .dsCardBody { display: none; }
        .dsCollapsed .dsCardHead { border-bottom: 0; }

        .dsCardBody { padding: 6px 8px 8px; font-size: 12px; color: #3a2408; }
        .dsCardBody > div { width: 100% !important; float: none !important; margin: 0 !important;
                            border: 0 !important; background: transparent !important; box-shadow: none !important; }
        .dsCardBody h4, .dsCardBody .head { display: none !important; }
        .dsCardBody table { width: 100% !important; border-collapse: collapse; background: transparent !important; }
        .dsCardBody th { background: rgba(125, 81, 15, .15) !important; font-size: 11px; }
        .dsCardBody td { padding: 4px 4px !important; border-bottom: 1px solid rgba(125, 81, 15, .18);
                         background: transparent !important; }
        .dsCardBody tr:last-child td { border-bottom: 0; }
        .dsCardBody tr:hover td { background: rgba(255, 255, 255, .45) !important; }
        .dsCardBody a { color: #5a2d00; font-weight: bold; }
        .dsCardBody img { vertical-align: middle; }
        .dsCardBody [data-dsend] { font-variant-numeric: tabular-nums; font-weight: bold; color: #2f5d0f; }
        .dsCardBody [data-dsend].dsSoon { color: #b31b00; }
        .dsCardBody [data-dsend].dsWaiting { color: #7a6a50; font-weight: normal; }
        .dsCardBody .dsDone { display: none !important; }

        .dsSideFoot {
            display: flex; justify-content: space-between; align-items: center; gap: 8px;
            padding: 5px 9px; border-radius: 6px;
            background: rgba(58, 32, 8, .82); color: #e9d39a; font-size: 10.5px;
            box-shadow: 0 2px 6px rgba(0,0,0,.3);
        }
        .dsSideFoot b { color: #fff3c9; font-weight: normal; }
        .dsSideFoot a { color: #ffd76a !important; text-decoration: none; font-weight: bold; white-space: nowrap; }
        .dsSideFoot a:hover { text-decoration: underline; }

        #dsAttackBar {
            display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 99999;
            height: 64px; align-items: stretch;
            background: repeating-linear-gradient(45deg, #b00000 0 30px, #860000 30px 60px);
            border-top: 3px solid #ffcc00; box-shadow: 0 -6px 22px rgba(200, 0, 0, .65);
            animation: dsPulse 1s infinite alternate;
        }
        #dsAttackBar.dsShow { display: flex; }
        .dsAttackLink {
            flex: 1; display: flex; align-items: center; justify-content: center; gap: 18px;
            color: #fff !important; text-decoration: none !important;
            font: bold 26px Verdana, sans-serif; letter-spacing: 1.5px; text-shadow: 0 2px 4px #000;
        }
        .dsAttackIcon { font-size: 32px; }
        .dsAttackHint { font-size: 13px; font-weight: normal; letter-spacing: 0; opacity: .85;
                        border: 1px solid rgba(255,255,255,.6); padding: 4px 10px; border-radius: 4px; }
        .dsAttackLink:hover .dsAttackHint { background: rgba(255,255,255,.15); opacity: 1; }
        .dsAttackClose {
            all: unset; cursor: pointer; width: 64px; display: flex; align-items: center; justify-content: center;
            color: #fff; font: bold 24px Verdana, sans-serif;
            background: rgba(0, 0, 0, .28); border-left: 2px solid rgba(255, 204, 0, .6);
        }
        .dsAttackClose:hover { background: rgba(0, 0, 0, .5); }
        .dsAttackClose:focus-visible { outline: 3px solid #ffcc00; outline-offset: -3px; }
        @keyframes dsPulse { from { filter: brightness(1); } to { filter: brightness(1.4); } }
        @media (prefers-reduced-motion: reduce) { #dsAttackBar { animation: none; } .dsChevron { transition: none; } }
    `;
    document.head.appendChild(css);

    // ---------- Start ----------
    if (gd.screen === 'overview') cacheOverview();
    else renderPanels();
    if (CONFIG.alarm) setupAlarm();
})();
