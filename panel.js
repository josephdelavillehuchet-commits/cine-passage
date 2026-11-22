// Ciné Passage — runs on allocine.fr when the user clicks the bookmark.
// Reads the AlloCiné session token already in the page (GraphToken cookie), calls AlloCiné's own API
// from the page, and downloads Letterboxd-ready CSV files. Nothing is sent anywhere else.
// The panel's fonts and pink ticket come from the Ciné Passage site (https://josephdelavillehuchet-commits.github.io/cine-passage/assets/); if they can't load, it falls
// back to a plain pink card with Georgia. The bookmark loads this file fresh from the site on every click and
// only runs its own embedded copy when that fails (window.__cinePassageLocal is then true).
(() => {
  const API = "https://graph.allocine.fr/v1/public";
  const HOST = "https://josephdelavillehuchet-commits.github.io/cine-passage/assets/";
  const VERSION = "22/11 11:57";
  const PAGE = 50;
  const PAUSE_MS = 400;
  const MAX_BYTES = 900 * 1024; // Letterboxd import limit is 1 MB per file
  const RATINGS = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE"];
  const ID = "cine-passage-panel";

  const old = document.getElementById(ID);
  if (old) old.remove();

  // ---------- Justine's fonts (document-level, usable inside the shadow root) ----------
  try {
    [["CPPorter", "porter-sans-inline-block-webfont.woff"], ["CPTan", "TAN-Harmoni-Regular.woff"], ["CPGood", "Good-Vibrations-Solid.woff"]]
      .forEach(([name, file]) => {
        if ([...document.fonts].some((f) => f.family === name)) return;
        const f = new FontFace(name, `url(${HOST}${file})`);
        document.fonts.add(f);
        f.load().catch(() => {});
      });
  } catch (e) {}

  // ---------- panel (shadow DOM so the site's CSS can't touch it) ----------
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box}
  .t{position:relative;width:380px;max-width:calc(100vw - 24px);color:#141414;
     font:18px/1.4 CPGood,Georgia,serif;-webkit-font-smoothing:antialiased;
     border:solid transparent;border-width:40px 26px 44px;
     border-image:url(${HOST}ticket-rouge.png) 116 72 124 72 fill / 40px 26px 44px / 0 stretch round;
     background:#f4a3b3;background-clip:padding-box;
     filter:drop-shadow(0 14px 22px rgba(20,20,20,.35));padding:0 8px}
  h2{margin:0 36px 14px 0;font:bold 21px/1 CPPorter,"Arial Black",Arial,sans-serif;letter-spacing:.03em;text-transform:uppercase}
  .v{position:absolute;bottom:-34px;right:0;font-size:11px;opacity:.55}
  .x{position:absolute;top:-22px;right:-8px;border:0;background:none;color:#141414;font:26px/1 Georgia,serif;cursor:pointer;padding:4px 8px}
  label{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start;margin:10px 0;cursor:pointer}
  input[type=checkbox]{appearance:none;-webkit-appearance:none;width:20px;height:20px;margin:2px 0 0;border:2px solid #141414;background:transparent;cursor:pointer;display:grid;place-content:center}
  input[type=checkbox]:checked::after{content:"";width:10px;height:10px;background:#141414}
  input[type=text]{width:100%;margin-top:2px;padding:4px 0;border:0;border-bottom:2px solid #141414;border-radius:0;background:transparent;font:inherit;color:#141414;outline:none}
  input[type=text]::placeholder{color:rgba(20,20,20,.45)}
  .skip{margin:-4px 0 6px 34px;font-size:16px}
  .stub{margin-top:16px;padding-top:16px;background:radial-gradient(circle,#141414 2px,transparent 2.5px) left top / 11px 5px repeat-x}
  .go{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;padding:0 16px;border:0;border-radius:0;background:#1a56db;color:#fff;
      font:600 17px/1.2 CPGood,Georgia,serif;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;text-align:center}
  .go:hover{background:#1646b5}
  .go:disabled,.go:disabled:hover{background:#1a56db;cursor:default}
  .go.busy{letter-spacing:.04em;text-transform:none}
  .dots span{display:inline-block;animation:d 1.2s ease-in-out infinite}
  .dots span:nth-child(2){animation-delay:.15s}.dots span:nth-child(3){animation-delay:.3s}
  @keyframes d{0%,60%,100%{transform:none}30%{transform:translateY(-.3em)}}
  .res{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:16px 0 0;text-align:center}
  .res b{display:block;font:600 30px/1 CPTan,Georgia,serif}
  .res span{font-size:14px}
  .msg{margin:14px 0 0;font-size:17px}
  .err{color:#8f1d24}
  .again{display:flex;flex-wrap:wrap;gap:4px 14px;margin:10px 0 0;font-size:14px}
  .again button{border:0;background:none;padding:0;font:inherit;color:#141414;text-decoration:underline;cursor:pointer}
  a{color:#141414}
  :focus-visible{outline:2px solid #1a56db;outline-offset:2px}
  [hidden]{display:none!important}
</style>
<div class="t">
  <button class="x" title="Fermer" aria-label="Fermer">×</button>
  <h2>Ciné Passage</h2>
  <div class="body"></div>
  <span class="v">version ${VERSION}${window.__cinePassageLocal ? " · copie du bouton" : ""}</span>
</div>`;
  document.documentElement.appendChild(host);
  const body = root.querySelector(".body");
  root.querySelector(".x").onclick = () => host.remove();

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fail = (html) => { body.innerHTML = `<p class="msg err">${html}</p>`; };

  // ---------- checks ----------
  if (!/(^|\.)allocine\.fr$/.test(location.hostname)) {
    fail(`Ouvrez d'abord <a href="https://www.allocine.fr/" target="_blank">allocine.fr</a>, connectez-vous, puis cliquez à nouveau sur Ciné Passage.`);
    return;
  }
  const cookie = document.cookie.split("; ").find((c) => c.startsWith("GraphToken="));
  const token = cookie ? decodeURIComponent(cookie.slice("GraphToken=".length)) : "";
  let exp = 0;
  try { exp = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0; } catch (e) {}
  if (!token || exp * 1000 < Date.now()) {
    fail(`Vous n'êtes pas connecté à AlloCiné. <a href="https://mon.allocine.fr/connexion/">Connectez-vous</a>, puis cliquez à nouveau sur Ciné Passage.`);
    return;
  }

  // ---------- options ----------
  body.innerHTML = `
  <label><input type="checkbox" id="o-diary" checked><span>Mes notes dans le journal, à leur date AlloCiné</span></label>
  <label><input type="checkbox" id="o-reviews" checked><span>Mes critiques</span></label>
  <div id="o-skipbox" class="skip">sauf celles qui commencent par
    <input type="text" id="o-skip" placeholder="ex. Note perso"></div>
  <label><input type="checkbox" id="o-watch" checked><span>Mes envies de voir</span></label>
  <div class="stub">
    <button class="go">Exporter</button>
    <div class="out"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  $("#o-reviews").onchange = () => { $("#o-skipbox").hidden = !$("#o-reviews").checked; };
  const go = $(".go");
  const busy = (t) => { go.classList.add("busy"); go.innerHTML = `${esc(t)}<span class="dots"><span>.</span><span>.</span><span>.</span></span>`; };

  // ---------- API ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function gql(query, variables) {
    await sleep(PAUSE_MS);
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) throw new Error(`AlloCiné a répondu ${r.status}`);
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join(" ; "));
    return j.data.me.user.social.relatedEntities.movies;
  }
  const MOVIE = "movie { internalId title originalTitle data { productionYear } }";
  const Q_RATINGS = `query($after:String,$first:Int,$rating:ReviewRating){me{user{social{relatedEntities{
    movies(entityType:[MOVIE],first:$first,after:$after,order:[LATEST],rating:$rating){
      totalCount pageInfo{endCursor hasNextPage}
      edges{node{opinion{createdAt content{review rating(base:5)}} ${MOVIE}}}}}}}}}`;
  const Q_WATCH = `query($after:String,$first:Int){me{user{social{relatedEntities{
    movies(entityType:[MOVIE],first:$first,after:$after,action:[WANTTOSEE]){
      totalCount pageInfo{endCursor hasNextPage}
      edges{node{wantToSee{__typename} ${MOVIE}}}}}}}}}`;

  async function all(query, extra, onPage) {
    const out = [];
    let after = null;
    for (;;) {
      const m = await gql(query, { after, first: PAGE, ...extra });
      out.push(...m.edges.map((e) => e.node));
      onPage(out.length, m.totalCount);
      if (!m.pageInfo.hasNextPage) return out;
      after = m.pageInfo.endCursor;
    }
  }

  // ---------- CSV ----------
  const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const title = (m) => m.originalTitle || m.title;
  const year = (m) => (m.data && m.data.productionYear) || "";
  function files(base, header, rows) {
    const head = header.map(cell).join(",") + "\n";
    const enc = new TextEncoder();
    const parts = [];
    let cur = head;
    for (const r of rows) {
      const line = r.map(cell).join(",") + "\n";
      if (enc.encode(cur + line).length > MAX_BYTES && cur !== head) { parts.push(cur); cur = head; }
      cur += line;
    }
    parts.push(cur);
    return parts.map((text, i) => ({ name: parts.length > 1 ? `${base}-${i + 1}.csv` : `${base}.csv`, text }));
  }
  function save(f) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.text], { type: "text/csv;charset=utf-8" }));
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- run ----------
  go.onclick = async () => {
    const diary = $("#o-diary").checked;
    const withReviews = $("#o-reviews").checked;
    const skip = $("#o-skip").value.trim().toLowerCase();
    const withWatch = $("#o-watch").checked;
    go.disabled = true;
    $(".out").innerHTML = "";
    busy("Lecture de vos notes");
    try {
      const byId = new Map();
      for (const rating of RATINGS) {
        const nodes = await all(Q_RATINGS, { rating }, (n) => busy(`Lecture de vos notes : ${byId.size + n}`));
        nodes.forEach((n) => byId.set(n.movie.internalId, n));
      }
      const rated = [...byId.values()].filter((n) => n.opinion && n.opinion.content);
      let kept = 0;
      const rows = rated.map((n) => {
        const c = n.opinion.content;
        let review = withReviews ? c.review || "" : "";
        if (review && skip && review.trim().toLowerCase().startsWith(skip)) review = "";
        if (review) kept++;
        const r = [title(n.movie), year(n.movie), c.rating == null ? "" : Number(c.rating).toFixed(1), review];
        if (diary) r.splice(2, 0, (n.opinion.createdAt || "").slice(0, 10));
        return r;
      });
      const header = diary ? ["Title", "Year", "WatchedDate", "Rating", "Review"] : ["Title", "Year", "Rating", "Review"];
      const out = files("letterboxd-notes", header, rows).map((f, i, a) => ({ ...f, label: a.length > 1 ? `notes, partie ${i + 1}` : "notes" }));

      let watch = [];
      if (withWatch) {
        const nodes = await all(Q_WATCH, {}, (n, t) => busy(`Lecture de vos envies de voir : ${n} sur ${t}`));
        const seen = new Set();
        watch = nodes.filter((n) => n.wantToSee && !seen.has(n.movie.internalId) && seen.add(n.movie.internalId))
          .map((n) => [title(n.movie), year(n.movie)])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        files("letterboxd-envies-de-voir", ["Title", "Year"], watch).forEach((f) => out.push({ ...f, label: "envies de voir" }));
      }

      // One file per click: browsers (Safari especially) let only one download through per user click.
      go.classList.remove("busy");
      $(".out").innerHTML = `
        <div class="res">
          <div><b>${rows.length}</b><span>notes</span></div>
          <div><b>${kept}</b><span>critiques</span></div>
          <div><b>${withWatch ? watch.length : "–"}</b><span>envies de voir</span></div>
        </div>
        <p class="msg"></p>
        <div class="again" hidden><span>Retélécharger :</span></div>`;
      const msg = $(".msg");
      let next = 0;
      const show = () => {
        if (next < out.length) {
          go.textContent = `Télécharger mes ${out[next].label}`;
          go.disabled = false;
          msg.textContent = out.length > 1 ? `Fichier ${next + 1} sur ${out.length}. Cliquez sur le bouton bleu.` : "Cliquez sur le bouton bleu.";
        } else {
          go.textContent = "C'est fait";
          go.disabled = true;
          msg.textContent = "Vos fichiers sont dans vos Téléchargements. Revenez sur Ciné Passage pour la suite.";
          $(".again").hidden = false;
        }
      };
      go.onclick = () => { save(out[next]); next++; show(); };
      out.forEach((f) => {
        const b = document.createElement("button");
        b.textContent = f.label;
        b.onclick = () => save(f);
        $(".again").appendChild(b);
      });
      show();
    } catch (e) {
      go.classList.remove("busy");
      go.textContent = "Réessayer";
      go.disabled = false;
      $(".out").innerHTML = `<p class="msg err">Ça n'a pas marché (${esc(e.message)}). Rechargez la page AlloCiné, puis cliquez à nouveau sur Ciné Passage.</p>`;
    }
  };
})();
