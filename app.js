// De weekplanning, in twee opstellingen met dezelfde code.
//
//  Op de Mac  : praat met het programmaatje op deze Mac, dat het brein leest en schrijft.
//               Hier maak je de week, haal je de agenda erbij en maak je de QR-code.
//  Op de telefoon: geen server, geen internet nodig. De week komt uit de QR-code en
//               staat daarna op het toestel. Wat je doet gaat in een wachtrij en wordt
//               met één knop doorgestuurd als één bestandje.
//
// Wat je op de telefoon doet gaat NOOIT rechtstreeks naar de Mac (die is van buiten niet
// bereikbaar, en dat is de bedoeling). Alles reist als bestandje via je cloud-map.

"use strict";

const DAGNAMEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
  "augustus", "september", "oktober", "november", "december"];
const KORT = { maandag: "ma", dinsdag: "di", woensdag: "wo", donderdag: "do", vrijdag: "vr", zaterdag: "za", zondag: "zo" };

const SOORT_LANG = { v: "vast", t: "taak", a: "afspraak", e: "extra", g: "gewerkt" };

let MODUS = "telefoon";   // wordt "mac" als het programmaatje op deze Mac antwoordt
let STAND = null;         // alles wat de Mac-kant weet
let PLAN = null;          // de weekplanning
let TODO = [];            // de To do-lijst (eigen lijst, hoort bij geen enkele week)
let DAG = null;           // welke dag staat er open ("vrij" voor "nog geen dag", "todo" voor de lijst)
let SCHERM = "week";      // telefoon: "week" (de dagtegels), "dag" (één dag open) of "todo" (de lijst)
let HELEWEEK = false;     // hele week naast elkaar (breed scherm)
let WACHTRIJ = [];        // telefoon: wat nog doorgestuurd moet worden
let BEZIG = "";           // tekst van een klus die even duurt (agenda ophalen bijv.)
// Welke regel staat open, en waarvoor: "bewerken", "dag", "annuleren" of "opnemen".
// Alles gebeurt op de regel zelf; er wordt geen apart venster geopend.
let OPEN = { id: null, modus: "" };

// ---------- kleine hulpjes ----------

const $ = (id) => document.getElementById(id);

function el(soort, klasse, tekst) {
  const e = document.createElement(soort);
  if (klasse) e.className = klasse;
  if (tekst !== undefined && tekst !== null) e.textContent = tekst;
  return e;
}

function vandaagIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dagnaamVan(isoDatum) {
  const [j, m, d] = isoDatum.split("-").map(Number);
  return DAGNAMEN[(new Date(j, m - 1, d).getDay() + 6) % 7];
}

function datumNl(isoDatum, metJaar) {
  const [j, m, d] = isoDatum.split("-").map(Number);
  return `${d} ${MAANDEN[m - 1]}${metJaar ? " " + j : ""}`;
}

function nieuwId() {
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function hoofdletter(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let meldingKlok = null;
function meld(tekst, soort) {
  const oud = document.querySelector(".melding");
  if (oud) oud.remove();
  const m = el("div", "melding" + (soort ? " " + soort : ""), tekst);
  document.body.appendChild(m);
  clearTimeout(meldingKlok);
  meldingKlok = setTimeout(() => m.remove(), 5000);
}

/** Ons eigen venstertje. De vensters van de browser zelf gebruiken we nooit. */
function paneel(titel, onderTitel, vulling, knoppen) {
  const dlg = $("paneel");
  dlg.innerHTML = "";
  const kop = el("div", "paneel-kop", titel);
  if (onderTitel) kop.appendChild(el("small", null, onderTitel));
  const body = el("div", "paneel-body");
  if (typeof vulling === "string") body.appendChild(el("p", null, vulling));
  else if (vulling) body.appendChild(vulling);
  const rij = el("div", "rij");
  for (const k of knoppen || []) {
    const b = el("button", "knop " + (k.stijl || "grijs"), k.tekst);
    b.onclick = () => { if (k.doe) k.doe(); if (k.sluit !== false) dlg.close(); };
    rij.appendChild(b);
  }
  const sluit = el("button", "knop grijs", "Sluiten");
  sluit.onclick = () => dlg.close();
  rij.appendChild(sluit);
  body.appendChild(rij);
  dlg.appendChild(kop);
  dlg.appendChild(body);
  dlg.showModal();
  return dlg;
}

// ---------- opslag op de telefoon ----------

const SLEUTEL_PLAN = "ff_week_plan";
const SLEUTEL_DELEN = "ff_week_delen";
const SLEUTEL_APPARAAT = "ff_week_apparaat";

function bewaarPlan(plan) {
  try { localStorage.setItem(SLEUTEL_PLAN, JSON.stringify(plan)); } catch { /* vol */ }
}
function bewaardPlan() {
  try { return JSON.parse(localStorage.getItem(SLEUTEL_PLAN) || "null"); } catch { return null; }
}
function apparaatNaam() {
  let naam = localStorage.getItem(SLEUTEL_APPARAAT);
  if (!naam) {
    naam = "Telefoon-" + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(SLEUTEL_APPARAAT, naam);
  }
  return naam;
}

/** De wachtrij staat in de eigen opslag van de browser, zodat een ingesproken memo
 *  (dat is groot) er ook in past en een herstart overleeft. */
function metDb() {
  return new Promise((klaar, fout) => {
    const v = indexedDB.open("ff-weekplanning", 1);
    v.onupgradeneeded = () => {
      const db = v.result;
      if (!db.objectStoreNames.contains("wachtrij")) db.createObjectStore("wachtrij", { keyPath: "id" });
      if (!db.objectStoreNames.contains("verzonden")) db.createObjectStore("verzonden", { keyPath: "id" });
    };
    v.onsuccess = () => klaar(v.result);
    v.onerror = () => fout(v.error);
  });
}

async function dbActie(winkel, modus, doe) {
  const db = await metDb();
  return new Promise((klaar, fout) => {
    const t = db.transaction(winkel, modus);
    const uitkomst = doe(t.objectStore(winkel));
    t.oncomplete = () => klaar(uitkomst && uitkomst.result !== undefined ? uitkomst.result : uitkomst);
    t.onerror = () => fout(t.error);
  });
}

async function zetInWachtrij(item) {
  item.id = item.id || nieuwId();
  item.wanneer = item.wanneer || new Date().toISOString();
  // Een volgnummer, want de volgorde doet ertoe: eerst een taak toevoegen, dán hem
  // verschuiven. Zonder nummer zou de opslag ze in willekeurige volgorde teruggeven.
  item.nr = volgendeNr();
  await dbActie("wachtrij", "readwrite", (w) => w.put(item));
  await laadWachtrij();
}

function volgendeNr() {
  const nu = Number(localStorage.getItem("ff_week_nr") || "0") + 1;
  localStorage.setItem("ff_week_nr", String(nu));
  return nu;
}

async function laadWachtrij() {
  try {
    const alles = (await dbActie("wachtrij", "readonly", (w) => w.getAll())) || [];
    WACHTRIJ = alles.sort((a, b) => (a.nr || 0) - (b.nr || 0));
  } catch { WACHTRIJ = []; }
}

async function wachtrijLeeg(items) {
  await dbActie("wachtrij", "readwrite", (w) => { for (const it of items) w.delete(it.id); });
  await dbActie("verzonden", "readwrite", (w) => {
    for (const it of items) w.put({ ...it, verzonden: new Date().toISOString() });
  });
  await laadWachtrij();
}

// ---------- de weekplanning uit een QR-code halen ----------

function base64UrlNaarBytes(tekst) {
  const plat = tekst.replace(/-/g, "+").replace(/_/g, "/");
  const opgevuld = plat + "=".repeat((4 - (plat.length % 4)) % 4);
  const ruw = atob(opgevuld);
  const bytes = new Uint8Array(ruw.length);
  for (let i = 0; i < ruw.length; i++) bytes[i] = ruw.charCodeAt(i);
  return bytes;
}

async function uitpakken(base64) {
  const bytes = base64UrlNaarBytes(base64);
  if (typeof DecompressionStream !== "function") throw new Error("oude browser");
  const stroom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const tekst = await new Response(stroom).text();
  return JSON.parse(tekst);
}

/** Zet het kleine pakketje uit de code om in een volledige weekplanning. */
function pakketNaarPlan(p) {
  const dagen = (p.d || []).map((items, i) => ({
    datum: plusDagen(p.m, i),
    items: items.map(grootItem),
  }));
  return {
    versie: 1, week: p.w, van: p.m, gemaakt: p.g || "",
    dagen, vrij: (p.f || []).map(grootItem),
    todo: (p.o || []).map(grootTodo),
  };
}

function grootItem(k) {
  return {
    id: k.i, tekst: k.t, tijd: k.u || "",
    soort: SOORT_LANG[k.s || "t"] || "extra",
    nr: k.r || "",
    wie: k.w || "", uiterlijk: k.x || "", typ: k.c || "",
    duur: k.n || 0,
    klaar: k.k ? vandaagIso() : "", telaat: !!k.l,
    gewerkt_min: k.h || 0,
    reacties: [],
  };
}

/** Eén punt van de To do-lijst uit het pakketje. Het vaste nummer is het kenmerk. */
function grootTodo(k) {
  const wie = k.w || "";
  return {
    id: "todo-" + (k.n || Math.random().toString(36).slice(2, 7)),
    nr: k.n || "", tekst: k.t, wie, uiterlijk: k.x || "", klaar: "",
    wacht_op_ander: !!(wie && !/erik/i.test(wie)),
  };
}

function plusDagen(isoDatum, n) {
  const [j, m, d] = isoDatum.split("-").map(Number);
  const dt = new Date(j, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Leest een gescande code uit het adres. Past de planning niet in één code, dan komen er
 * meer codes; we bewaren de losse delen tot ze compleet zijn.
 */
async function neemCodeOver(hash) {
  const m = (hash || "").match(/^#w=(\d+)\/(\d+),([A-Za-z0-9\-_]+)$/);
  if (!m) return false;
  const [, nr, totaal, data] = m;
  const delen = JSON.parse(localStorage.getItem(SLEUTEL_DELEN) || "{}");
  if (delen.totaal !== Number(totaal)) { delen.totaal = Number(totaal); delen.stukken = {}; }
  delen.stukken[nr] = data;
  localStorage.setItem(SLEUTEL_DELEN, JSON.stringify(delen));

  const compleet = [];
  for (let i = 1; i <= delen.totaal; i++) {
    if (!delen.stukken[i]) {
      meld(`Code ${nr} van ${totaal} is binnen. Scan ook de andere.`, "goed");
      return true;
    }
    compleet.push(delen.stukken[i]);
  }
  try {
    const plan = pakketNaarPlan(await uitpakken(compleet.join("")));
    bewaarPlan(plan);
    localStorage.removeItem(SLEUTEL_DELEN);
    PLAN = plan;
    TODO = PLAN.todo = PLAN.todo || [];
    DAG = null;
    SCHERM = "week";
    meld("De weekplanning staat op je telefoon.", "goed");
    return true;
  } catch (e) {
    meld("Deze code kon ik niet lezen (" + String(e.message || e).slice(0, 40) + ").", "fout");
    return true;
  }
}

// ---------- opstarten ----------

async function start() {
  // Eerst kijken of het programmaatje op deze Mac antwoordt.
  try {
    const p = await fetch("/api/ping", { cache: "no-store" });
    const data = await p.json();
    if (data && data.app === "weekplanning") MODUS = "mac";
  } catch { MODUS = "telefoon"; }

  if (location.hash.startsWith("#w=")) {
    await neemCodeOver(location.hash);
    history.replaceState(null, "", location.pathname);
  }

  if (MODUS === "mac") {
    await haalStand();
  } else {
    document.body.classList.add("telefoon");
    await laadWachtrij();
    PLAN = bewaardPlan();
    TODO = PLAN ? (PLAN.todo = PLAN.todo || []) : [];
    bewaarAppOpApparaat();
  }
  window.addEventListener("hashchange", async () => {
    if (location.hash.startsWith("#w=")) {
      await neemCodeOver(location.hash);
      history.replaceState(null, "", location.pathname);
      teken();
    }
  });
  teken();
}

async function haalStand(van) {
  const adres = "/api/stand" + (van ? "?van=" + van : "");
  const r = await fetch(adres, { cache: "no-store" });
  STAND = await r.json();
  PLAN = STAND.plan;
  TODO = STAND.todo || [];
}

function bewaarAppOpApparaat() {
  if (!("serviceWorker" in navigator) || location.protocol === "http:") return;
  navigator.serviceWorker.register("sw.js").catch(() => { /* geen ramp */ });
}

// ---------- tekenen ----------

function teken() {
  const weekregel = $("weekregel");
  if (!PLAN) {
    $("titel").textContent = "Weekplanning";
    weekregel.textContent = MODUS === "mac" ? "nog niets gemaakt" : "nog niets ontvangen";
    $("dagchips").innerHTML = "";
    tekenBalkknoppen();
    tekenSeintjes();
    tekenGeenPlan();
    tekenVoet();
    return;
  }
  const eind = PLAN.dagen[6] ? PLAN.dagen[6].datum : PLAN.van;
  $("titel").textContent = `Week ${PLAN.week}`;
  weekregel.textContent = `${datumNl(PLAN.van)} tot en met ${datumNl(eind, true)}`;

  if (!DAG) {
    const nu = vandaagIso();
    DAG = PLAN.dagen.some((d) => d.datum === nu) ? nu : PLAN.van;
  }

  tekenBalkknoppen();
  tekenSeintjes();
  if (MODUS === "telefoon") {
    // Op de telefoon: eerst de week als dagtegels; tik op een dag (of op de To do-tegel)
    // en je zit erin, met bovenin knopjes om meteen ergens anders heen te springen.
    if (SCHERM === "week") {
      $("dagchips").innerHTML = "";
      tekenWeektegels();
    } else {
      tekenTelefoonChips();
      if (SCHERM === "todo") tekenTodo(); else tekenDag();
    }
  } else {
    tekenDagchips();
    if (DAG === "todo") tekenTodo();
    else if (HELEWEEK) tekenWeekraster(); else tekenDag();
  }
  tekenVoet();
}

function tekenBalkknoppen() {
  const rij = $("balkknoppen");
  rij.innerHTML = "";
  const knop = (tekst, doe, stijl) => {
    const b = el("button", "knop klein " + (stijl || "rustig"), tekst);
    b.onclick = doe;
    b.disabled = !!BEZIG;
    rij.appendChild(b);
    return b;
  };
  if (MODUS === "mac") {
    if (PLAN) {
      knop("◀", () => andereWeek(-7)).title = "Week eerder";
      knop("▶", () => andereWeek(7)).title = "Week later";
      knop("Naar mijn telefoon", toonQr, "");
    }
    knop("Agenda erbij", haalAgenda);
    if (PLAN) knop("Naar mijn agenda", naarAgenda);
    knop("Bijwerken uit het brein", bouwOpnieuw);
    knop("Binnenhalen van telefoon", haalBinnen);
    if (window.innerWidth >= 900 && PLAN) {
      knop(HELEWEEK ? "Eén dag" : "Hele week", () => {
        HELEWEEK = !HELEWEEK;
        if (HELEWEEK && DAG === "todo") DAG = null; // het raster heeft de lijst als eigen kolom
        teken();
      });
    }
  } else {
    knop("Nieuwe week scannen", scanNieuweWeek);
  }
}

function tekenSeintjes() {
  const vak = $("seintjes");
  vak.innerHTML = "";
  if (BEZIG) {
    const b = el("div", "seintje bezig");
    b.appendChild(el("div", "bol"));
    b.appendChild(el("div", "rek", BEZIG));
    vak.appendChild(b);
  }
  const seintje = (tekst, knoppen, rustig) => {
    const s = el("div", "seintje" + (rustig ? " rustig" : ""));
    s.appendChild(el("div", "rek", tekst));
    for (const k of knoppen || []) {
      const b = el("button", "knop klein grijs", k.tekst);
      b.onclick = k.doe;
      s.appendChild(b);
    }
    vak.appendChild(s);
  };

  if (MODUS === "mac" && STAND) {
    if (!STAND.telefoon_adres) {
      seintje("Je telefoon weet nog niet waar deze app staat. Vul één keer het webadres in, dan kun je de code maken.",
        [{ tekst: "Webadres invullen", doe: vraagAdres }]);
    }
    if (STAND.post && STAND.post.aantal > 0) {
      seintje(`Er ${STAND.post.aantal === 1 ? "staat 1 ding" : "staan " + STAND.post.aantal + " dingen"} klaar van je telefoon.`,
        [{ tekst: "Binnenhalen", doe: haalBinnen }]);
    }
    if (STAND.post && !STAND.post.bereikbaar) {
      seintje("De map van je telefoon (op de NAS) is nu niet bereikbaar. Zodra hij er weer is, kun je binnenhalen.", [], true);
    }
    if (STAND.laatst_gescand && STAND.laatst_gescand !== STAND.stempel) {
      seintje("De planning is veranderd sinds je hem voor het laatst op je telefoon hebt gezet. Laat een nieuwe code scannen als je telefoon bij wil zijn.",
        [{ tekst: "Nieuwe code", doe: toonQr }]);
    }
    if (STAND.memos_in_inbox) {
      const n = STAND.memos_in_inbox;
      seintje(`${n} uitgetypt${n === 1 ? " memo staat" : "e memo's staan"} in je documentenmap. Typ /doc2md in Claude Code, dan gaan ze via de gewone weg het brein in.`,
        [{ tekst: "/doc2md kopiëren", doe: () => kopieer("/doc2md") }]);
    }
    if (STAND.aandacht && STAND.aandacht.length) {
      const memos = STAND.aandacht.filter((a) => a.soort === "memo").length;
      const rest = STAND.aandacht.length - memos;
      const stukken = [];
      if (memos) stukken.push(`${memos} ingesproken ${memos === 1 ? "memo" : "memo's"}`);
      if (rest) stukken.push(`${rest} ${rest === 1 ? "tekst" : "teksten"} van je telefoon`);
      seintje(`Van je telefoon meegekomen en nog niet afgehandeld: ${stukken.join(" en ")}.`,
        [{ tekst: "Bekijken", doe: toonAandacht }]);
    }
    if (STAND.plan && STAND.plan.twijfels && STAND.plan.twijfels.length) {
      const n = STAND.plan.twijfels.length;
      seintje(`${n === 1 ? "Eén punt lijkt" : n + " punten lijken"} dubbel te staan. Kijk jij even welke je wilt houden?`,
        [{ tekst: "Bekijken", doe: toonTwijfels }]);
    }
    if (STAND.plan && !STAND.plan.agenda_gelezen) {
      seintje("De afspraken uit je agenda zitten nog niet in deze week.", [{ tekst: "Agenda erbij halen", doe: haalAgenda }], true);
    }
  }

  if (MODUS === "telefoon" && PLAN) {
    const nu = vandaagIso();
    const eind = PLAN.dagen[6] ? PLAN.dagen[6].datum : PLAN.van;
    if (nu > eind) {
      seintje("Deze planning is van een week die voorbij is. Scan op de Mac de nieuwe code van deze week.",
        [{ tekst: "Scannen", doe: scanNieuweWeek }]);
    }
  }
}

function tekenDagchips() {
  const vak = $("dagchips");
  vak.innerHTML = "";
  const nu = vandaagIso();
  const maak = (sleutel, boven, onder, aantal, isNu) => {
    const b = el("button", "dagchip" + (DAG === sleutel ? " aan" : "") + (isNu ? " nu" : ""));
    b.appendChild(el("strong", null, boven));
    b.appendChild(el("small", null, onder));
    b.appendChild(el("span", "telling", aantal));
    b.onclick = () => { DAG = sleutel; HELEWEEK = false; teken(); };
    vak.appendChild(b);
  };
  for (const dag of PLAN.dagen) {
    const open = dag.items.filter((i) => !i.klaar).length;
    maak(dag.datum, hoofdletter(KORT[dagnaamVan(dag.datum)]), datumNl(dag.datum),
      open ? `${open} te doen` : "leeg", dag.datum === nu);
  }
  if ((PLAN.vrij || []).length) {
    const open = PLAN.vrij.filter((i) => !i.klaar).length;
    maak("vrij", "Nog", "geen dag", open ? `${open} te doen` : "leeg", false);
  }
  const openTodo = TODO.filter((t) => !t.klaar).length;
  maak("todo", "To do", "je lijst", openTodo ? `${openTodo} open` : "leeg", false);
}

function itemsVan(sleutel) {
  if (sleutel === "vrij") return PLAN.vrij || [];
  const dag = PLAN.dagen.find((d) => d.datum === sleutel);
  return dag ? dag.items : [];
}

// ---------- de To do-lijst ----------

/**
 * Eriks eigen lijst: dingen die nog geen week of dag hebben. Bewust simpel (zijn eigen
 * ontwerp, 29 juli 2026): geen slepen, geen plannen — twee knoppen per regel. Klaar
 * zet het punt als gedaan op de dag van vandaag; "Gaat niet gebeuren" zet het in
 * taken.md bij Klaar met "(vervallen)" erachter, zonder dag. Wat op iemand anders
 * wacht staat onderaan apart, niet tussen de eigen klusjes.
 */
function tekenTodo() {
  const vak = $("inhoud");
  vak.innerHTML = "";
  const kop = el("div", "dagkop");
  const links = el("div");
  links.appendChild(el("h2", null, "To do"));
  links.appendChild(el("div", "hint",
    "Je eigen lijst, los van de week. Vink je iets af, dan komt het als gedaan op de dag van vandaag te staan."));
  kop.appendChild(links);
  vak.appendChild(kop);

  const eigen = TODO.filter((t) => !t.wacht_op_ander);
  const wacht = TODO.filter((t) => t.wacht_op_ander);

  if (!eigen.length && !wacht.length) {
    vak.appendChild(el("div", "leeg", "Je lijst is leeg. Met de + zet je er iets op."));
  }
  if (eigen.length) {
    const lijst = el("div", "lijst");
    for (const t of eigen) lijst.appendChild(tekenTodoRegel(t));
    vak.appendChild(lijst);
  }
  if (wacht.length) {
    vak.appendChild(el("h3", "todo-tussenkop", "Wacht op iemand anders"));
    const lijst = el("div", "lijst");
    for (const t of wacht) lijst.appendChild(tekenTodoRegel(t));
    vak.appendChild(lijst);
  }

  if (MODUS === "mac") {
    const b = el("button", "knop grijs", "+ Op je lijst erbij");
    b.style.marginTop = "14px";
    b.onclick = () => vraagNieuw("todo");
    vak.appendChild(b);
  }
}

function tekenTodoRegel(t) {
  const r = el("div", "regel soort-taak" + (t.klaar ? " klaar" : ""));
  const midden = el("div", "midden");
  midden.appendChild(el("div", "tekst", t.tekst));
  const onder = el("div", "onder");
  if (t.wacht_op_ander) onder.appendChild(el("span", "label", "wacht op " + t.wie));
  if (t.uiterlijk) onder.appendChild(el("span", "label", "uiterlijk " + datumNl(t.uiterlijk)));
  if (onder.childElementCount) midden.appendChild(onder);

  // "Gaat niet gebeuren" vraagt eerst een bevestiging, op de regel zelf.
  if (OPEN.id === t.id && OPEN.modus === "vervalt") {
    const vraag = el("div", "bewerkrij");
    vraag.appendChild(el("span", "hint",
      "Zeker? Hij verdwijnt niet: hij komt bij Klaar te staan met \"(vervallen)\" erachter."));
    const ja = el("button", "knop klein", "Ja, gaat niet gebeuren");
    ja.onclick = () => todoAf(t, true);
    vraag.appendChild(ja);
    const nee = el("button", "knop grijs klein", "Nee, laat staan");
    nee.onclick = () => { OPEN = { id: null, modus: "" }; teken(); };
    vraag.appendChild(nee);
    midden.appendChild(vraag);
  }

  r.appendChild(midden);
  if (!t.klaar) {
    const acties = el("div", "acties");
    const klaar = el("button", "knop grijs klein", "Klaar");
    klaar.title = "Gedaan; komt op vandaag te staan";
    klaar.onclick = () => todoAf(t, false);
    acties.appendChild(klaar);
    const weg = el("button", "knop grijs klein", "Gaat niet gebeuren");
    weg.onclick = () => { OPEN = { id: t.id, modus: OPEN.modus === "vervalt" && OPEN.id === t.id ? "" : "vervalt" }; teken(); };
    acties.appendChild(weg);
    r.appendChild(acties);
  }
  return r;
}

/** Een To do-punt afronden: klaar (komt op vandaag te staan) of vervallen (alleen naar
 *  Klaar in je takenlijst, bewust op geen enkele dag). */
async function todoAf(t, vervallen) {
  OPEN = { id: null, modus: "" };
  const nu = vandaagIso();
  const plek = TODO.indexOf(t);
  if (plek >= 0) TODO.splice(plek, 1);
  const item = {
    id: nieuwId(), soort: vervallen ? "afgemeld" : "afgevinkt", todo: 1,
    taak_nr: t.nr, taak_tekst: t.tekst, dag: nu,
  };
  if (!vervallen && MODUS === "telefoon") {
    // Op het scherm alvast op vandaag zetten; de Mac doet hetzelfde bij het binnenhalen.
    const dag = PLAN.dagen.find((d) => d.datum === nu);
    if (dag) {
      dag.items.push({ id: item.id, soort: "taak", nr: t.nr, tekst: t.tekst, tijd: "", klaar: nu, reacties: [] });
      sorteerDag(dag.items);
    }
  }
  await doeItems([item], vervallen
    ? "Oké, gaat niet gebeuren. Hij staat bij Klaar met \"(vervallen)\" erachter."
    : "Klaar. Hij staat als gedaan op vandaag.");
}

/** Wat speelt er op een dag? Voor de dagtegels en de dagknopjes. */
function dagStand(items) {
  const open = items.filter((i) => !i.klaar).length;
  const afspraken = items.filter((i) => i.soort === "afspraak" && !i.klaar).length;
  const klaar = items.filter((i) => i.klaar && i.soort !== "gewerkt").length;
  let gewerkt = 0;
  for (const i of items) {
    if (i.soort === "gewerkt") gewerkt += i.duur || 0;
    gewerkt += i.gewerkt_min || 0;
  }
  return { open, afspraken, klaar, gewerkt, totaal: items.length };
}

/** Het beginscherm van de telefoon: de week als dagtegels. */
function tekenWeektegels() {
  const vak = $("inhoud");
  vak.innerHTML = "";
  const nu = vandaagIso();
  const rooster = el("div", "dagtegels");

  const maakTegel = (sleutel, boven, onder, breed) => {
    const items = itemsVan(sleutel);
    const s = dagStand(items);
    const t = el("button", "dagtegel" + (sleutel === nu ? " nu" : "") + (breed ? " breed" : ""));
    const kop = el("div", "tegel-kop");
    kop.appendChild(el("strong", null, boven));
    if (sleutel === nu) kop.appendChild(el("span", "tegel-vandaag", "vandaag"));
    t.appendChild(kop);
    t.appendChild(el("small", null, onder));

    const stand = el("div", "tegel-stand");
    if (!items.length) {
      stand.appendChild(el("span", "tegel-leeg", "niets gepland"));
    } else if (!s.open) {
      stand.appendChild(el("span", "tegel-klaar", "✓ alles klaar"));
    } else {
      stand.appendChild(el("span", "tegel-open", `${s.open} te doen`));
      if (s.afspraken) stand.appendChild(el("span", "tegel-los", `${s.afspraken} ${s.afspraken === 1 ? "afspraak" : "afspraken"}`));
    }
    t.appendChild(stand);
    if (s.gewerkt) t.appendChild(el("div", "tegel-gewerkt", `${uurTekst(s.gewerkt)} gewerkt`));

    t.onclick = () => { DAG = sleutel; SCHERM = "dag"; teken(); };
    rooster.appendChild(t);
  };

  for (const dag of PLAN.dagen) {
    maakTegel(dag.datum, hoofdletter(dagnaamVan(dag.datum)), datumNl(dag.datum), false);
  }

  // De achtste plek, naast zondag: de To do-lijst. Eriks eigen lijst, hoort bij geen
  // enkele week — vandaar geen datum maar een telling.
  const eigen = TODO.filter((t) => !t.klaar && !t.wacht_op_ander).length;
  const wacht = TODO.filter((t) => !t.klaar && t.wacht_op_ander).length;
  const tegel = el("button", "dagtegel todo");
  const kop = el("div", "tegel-kop");
  kop.appendChild(el("strong", null, "To do"));
  tegel.appendChild(kop);
  tegel.appendChild(el("small", null, "je eigen lijst"));
  const stand = el("div", "tegel-stand");
  if (eigen) stand.appendChild(el("span", "tegel-open", `${eigen} op je lijst`));
  else stand.appendChild(el("span", "tegel-klaar", "niets open"));
  if (wacht) stand.appendChild(el("span", "tegel-los", `${wacht} wacht op een ander`));
  tegel.appendChild(stand);
  tegel.onclick = () => { SCHERM = "todo"; OPEN = { id: null, modus: "" }; teken(); };
  rooster.appendChild(tegel);

  if ((PLAN.vrij || []).length) {
    maakTegel("vrij", "Nog geen dag", "deze week nog inplannen", true);
  }
  vak.appendChild(rooster);
}

/** Bovenin het dagscherm: terug naar de week, en meteen naar een andere dag kunnen. */
function tekenTelefoonChips() {
  const vak = $("dagchips");
  vak.innerHTML = "";
  vak.classList.add("mini");
  const nu = vandaagIso();

  const terug = el("button", "dagchip terug");
  terug.appendChild(el("strong", null, "‹"));
  terug.appendChild(el("small", null, "week"));
  terug.onclick = () => { SCHERM = "week"; OPEN = { id: null, modus: "" }; teken(); };
  vak.appendChild(terug);

  const maak = (sleutel, boven) => {
    const items = itemsVan(sleutel);
    const open = items.filter((i) => !i.klaar).length;
    const aan = SCHERM === "dag" && DAG === sleutel;
    const b = el("button", "dagchip" + (aan ? " aan" : "") + (sleutel === nu ? " nu" : ""));
    b.appendChild(el("strong", null, boven));
    b.appendChild(el("small", null, open ? String(open) : "·"));
    b.onclick = () => { DAG = sleutel; SCHERM = "dag"; OPEN = { id: null, modus: "" }; teken(); };
    vak.appendChild(b);
  };
  for (const dag of PLAN.dagen) maak(dag.datum, hoofdletter(KORT[dagnaamVan(dag.datum)]));
  if ((PLAN.vrij || []).length || (SCHERM === "dag" && DAG === "vrij")) maak("vrij", "Nog");

  const openTodo = TODO.filter((t) => !t.klaar).length;
  const bt = el("button", "dagchip" + (SCHERM === "todo" ? " aan" : ""));
  bt.appendChild(el("strong", null, "To do"));
  bt.appendChild(el("small", null, openTodo ? String(openTodo) : "·"));
  bt.onclick = () => { SCHERM = "todo"; OPEN = { id: null, modus: "" }; teken(); };
  vak.appendChild(bt);
}

function tekenDag() {
  const vak = $("inhoud");
  vak.innerHTML = "";
  const kop = el("div", "dagkop");
  const links = el("div");
  if (DAG === "vrij") {
    links.appendChild(el("h2", null, "Nog geen dag"));
    links.appendChild(el("div", "hint", "Deze dingen moeten deze week gebeuren, maar hebben nog geen dag."));
  } else {
    links.appendChild(el("h2", null, `${hoofdletter(dagnaamVan(DAG))} ${datumNl(DAG)}`));
    links.appendChild(el("div", "hint",
      (DAG === vandaagIso() ? "vandaag · " : "") + "tik op een regel om de tijd of de tekst aan te passen of er tekst bij te typen"));
  }
  kop.appendChild(links);
  vak.appendChild(kop);

  const items = itemsVan(DAG);
  if (!items.length) {
    vak.appendChild(el("div", "leeg", "Niets gepland op deze dag."));
  } else {
    const lijst = el("div", "lijst");
    for (const it of items) lijst.appendChild(tekenRegel(it, DAG));
    vak.appendChild(lijst);
  }

  if (MODUS === "mac") {
    const b = el("button", "knop grijs", "+ Iets toevoegen");
    b.style.marginTop = "14px";
    b.onclick = () => vraagNieuw(DAG);
    vak.appendChild(b);
  }
}

function tekenWeekraster() {
  const vak = $("inhoud");
  vak.innerHTML = "";
  const raster = el("div", "weekraster");
  const nu = vandaagIso();
  const kolom = (titel, onder, items, sleutel) => {
    const k = el("div", "kolom" + (sleutel === nu ? " vandaag" : ""));
    const h = el("h3", null, titel);
    h.appendChild(el("small", null, onder));
    k.appendChild(h);
    const lijst = el("div", "lijst");
    for (const it of items) lijst.appendChild(tekenRegel(it, sleutel, true));
    if (!items.length) lijst.appendChild(el("div", "leeg", "leeg"));
    k.appendChild(lijst);
    const b = el("button", "knop grijs klein", "+");
    b.style.marginTop = "8px";
    b.onclick = () => vraagNieuw(sleutel);
    k.appendChild(b);
    raster.appendChild(k);
  };
  for (const dag of PLAN.dagen) {
    kolom(hoofdletter(dagnaamVan(dag.datum)), datumNl(dag.datum), dag.items, dag.datum);
  }
  kolom("Nog geen dag", "deze week", PLAN.vrij || [], "vrij");

  // De To do-lijst als eigen kolom. Dit zijn geen weekpunten: tik op een regel en je
  // zit in de lijst zelf, met de knoppen Klaar en Gaat niet gebeuren.
  const k = el("div", "kolom");
  const open = TODO.filter((t) => !t.klaar).length;
  const h = el("h3", null, "To do");
  h.appendChild(el("small", null, open ? `je lijst · ${open} open` : "je lijst"));
  k.appendChild(h);
  const lijst = el("div", "lijst");
  for (const t of TODO) {
    const r = el("div", "regel soort-taak tikbaar");
    r.onclick = () => { DAG = "todo"; HELEWEEK = false; teken(); };
    const midden = el("div", "midden");
    midden.appendChild(el("div", "tekst", t.tekst));
    if (t.wacht_op_ander) {
      const onder = el("div", "onder");
      onder.appendChild(el("span", "label", "wacht op " + t.wie));
      midden.appendChild(onder);
    }
    r.appendChild(midden);
    lijst.appendChild(r);
  }
  if (!TODO.length) lijst.appendChild(el("div", "leeg", "leeg"));
  k.appendChild(lijst);
  const bPlus = el("button", "knop grijs klein", "+");
  bPlus.style.marginTop = "8px";
  bPlus.onclick = () => vraagNieuw("todo");
  k.appendChild(bPlus);
  raster.appendChild(k);

  vak.appendChild(raster);
}

function tekenGeenPlan() {
  const vak = $("inhoud");
  vak.innerHTML = "";
  const kaart = el("div", "seintje");
  if (MODUS === "mac") {
    kaart.appendChild(el("div", "rek",
      "Er is voor deze week nog geen planning. Druk op \"Bijwerken uit het brein\": dan zet ik je vaste week en je open taken erin. Daarna kun je de agenda erbij halen."));
  } else {
    kaart.appendChild(el("div", "rek",
      "Er staat nog geen planning op dit toestel. Laat op de Mac de code zien en scan die met je camera, of tik hierboven op \"Nieuwe week scannen\"."));
  }
  vak.appendChild(kaart);
}

function tekenVoet() {
  const voet = $("voet");
  if (MODUS !== "telefoon") { voet.hidden = true; return; }
  voet.hidden = false;
  voet.innerHTML = "";

  // Eerst een eigen regel met de stand van de wachtrij; daaronder de knoppen. Zo drukt
  // de tekst nooit tegen de knoppen aan op een smal scherm.
  const status = el("div", "voetstatus" + (WACHTRIJ.length ? " vol" : ""));
  if (WACHTRIJ.length) {
    status.appendChild(el("strong", null, `${WACHTRIJ.length} ${WACHTRIJ.length === 1 ? "ding" : "dingen"} klaar om door te sturen`));
    status.appendChild(el("small", null, " · landt in je downloadmap"));
  } else {
    status.appendChild(el("strong", null, "Niets te versturen"));
    status.appendChild(el("small", null, " · alles is doorgegeven"));
  }
  voet.appendChild(status);

  // De plusknop zit ín de balk. Zo kan hij nooit meer achter de balk wegvallen,
  // hoe vol de balk ook staat (gemeld door Erik, 29 juli 2026).
  const rij = el("div", "voetrij");
  const plus = el("button", "voet-plus", "+");
  plus.title = "Iets toevoegen";
  plus.disabled = !PLAN;
  plus.onclick = () => {
    if (!PLAN) return;
    // Waar je staat, daar komt het bij: in de To do-lijst op je lijst, in een dag op
    // die dag, en anders op vandaag. Geen keuzescherm (Eriks ontwerp, 29 juli 2026).
    const nu = vandaagIso();
    const doel = SCHERM === "todo" ? "todo"
      : SCHERM === "dag" && DAG ? DAG
        : (PLAN.dagen.some((d) => d.datum === nu) ? nu : "vrij");
    vraagNieuw(doel);
  };
  rij.appendChild(plus);

  const memo = el("button", "knop rustig klein", "Inspreken");
  memo.onclick = () => vraagMemo(null);
  rij.appendChild(memo);

  rij.appendChild(el("div", "rek"));

  const door = el("button", "knop" + (WACHTRIJ.length ? " gloei" : ""), "Doorsturen");
  door.disabled = !WACHTRIJ.length;
  door.onclick = doorsturen;
  rij.appendChild(door);
  voet.appendChild(rij);

  // Uitwijk voor een toestel waar de downloadmap vastligt: dan alsnog het deelmenu.
  // Alleen zichtbaar als er iets klaarstaat, met woorden erbij — nooit een icoontje.
  if (WACHTRIJ.length) {
    const onderrij = el("div", "voetrij zacht");
    const anders = el("button", "knop rustig klein", "Anders doorsturen");
    anders.title = "Met het deelmenu van je telefoon, als je downloadmap niet in te stellen is";
    anders.onclick = doorsturenViaDeelmenu;
    onderrij.appendChild(anders);
    voet.appendChild(onderrij);
  }
}

function kopieer(tekst) {
  navigator.clipboard?.writeText(tekst).then(
    () => meld(`"${tekst}" gekopieerd. Plak het in Claude Code.`, "goed"),
    () => meld(`Typ dit in Claude Code: ${tekst}`),
  );
}

// ---------- dingen doen ----------

/**
 * Eén plek voor alle wijzigingen. Op de Mac gaan ze meteen naar het brein; op de
 * telefoon in de wachtrij, en we passen ze hier alvast toe zodat het scherm klopt.
 */
/** Zelfde volgorde als op de Mac: eerst op tijd, dan afspraken/vaste punten/taken. */
function sorteerDag(items) {
  const rang = { afspraak: 0, vast: 1, taak: 2, extra: 3, gewerkt: 4 };
  items.sort((a, b) => {
    if (!!a.klaar !== !!b.klaar) return a.klaar ? 1 : -1;
    const ta = a.tijd || "", tb = b.tijd || "";
    if (ta && tb && ta !== tb) return ta.localeCompare(tb);
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return (rang[a.soort] ?? 9) - (rang[b.soort] ?? 9);
  });
}

async function doeItems(items, meldingTekst) {
  if (MODUS === "mac") {
    const r = await fetch("/api/doe" + (PLAN ? "?van=" + PLAN.van : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await r.json();
    if (data.stand) { STAND = data.stand; PLAN = STAND.plan; TODO = STAND.todo || []; }
    teken();
    if (meldingTekst) meld(meldingTekst, "goed");
    return;
  }
  for (const it of items) await zetInWachtrij(it);
  for (const dag of PLAN.dagen) sorteerDag(dag.items);
  bewaarPlan(PLAN);
  teken();
  if (meldingTekst) meld(meldingTekst, "goed");
}

async function vinkAf(it, dagSleutel) {
  it.klaar = vandaagIso();
  await doeItems([{
    id: nieuwId(), soort: "afgevinkt", taak_id: it.id, taak_tekst: it.tekst,
    dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel,
  }], "Afgevinkt.");
}

async function heropen(it) {
  // Op de telefoon zetten we het alleen op het scherm terug; de Mac blijft de baas over
  // taken.md. Zo kan een vinkje nooit per ongeluk iets in het brein terugdraaien.
  it.klaar = "";
  if (MODUS === "telefoon") {
    bewaarPlan(PLAN);
    teken();
    meld("Weer open op je telefoon. Op de Mac blijft hij zoals hij was.", "goed");
    return;
  }
  teken();
  meld("Weer open. Dit verandert taken.md niet; doe dat daar zelf als het nodig is.");
}

function tekenRegel(it, dagSleutel, klein) {
  const r = el("div", `regel soort-${it.soort}${it.klaar ? " klaar" : ""}${it.telaat ? " telaat" : ""}`);
  const open = OPEN.id === it.id ? OPEN.modus : "";

  // In de hele-week-stand zijn de kolommen te smal om in te typen: daar brengt een tik je
  // naar die dag, en daar bewerk je de regel gewoon op zijn plek.
  if (klein) {
    r.classList.add("tikbaar");
    r.onclick = () => { DAG = dagSleutel; HELEWEEK = false; OPEN = { id: it.id, modus: "bewerken" }; teken(); };
    const midden = el("div", "midden");
    const tekst = el("div", "tekst");
    if (it.tijd) tekst.appendChild(el("span", "tijd", it.tijd));
    tekst.appendChild(document.createTextNode(it.tekst));
    midden.appendChild(tekst);
    const onder = el("div", "onder");
    if (it.soort === "gewerkt") onder.appendChild(el("span", "label groen", uurTekst(it.duur || 0)));
    if (it.gewerkt_min) onder.appendChild(el("span", "label groen", uurTekst(it.gewerkt_min) + " gewerkt"));
    if (it.telaat) onder.appendChild(el("span", "label oranje", "te laat"));
    if (it.wie && it.wie.toLowerCase() !== "erik") onder.appendChild(el("span", "label", "wacht op " + it.wie));
    if ((it.reacties || []).length) onder.appendChild(el("span", "label", `${it.reacties.length}× tekst erbij`));
    if (onder.childElementCount) midden.appendChild(onder);
    r.appendChild(midden);
    return r;
  }

  const midden = el("div", "midden");

  // Een gewerkt-regel is een terugblik uit je administratie: hier alleen te lezen.
  // Aanpassen doe je in de boekhoudapp; bij "Bijwerken uit het brein" schuift hij mee.
  if (it.soort === "gewerkt") {
    const tekst = el("div", "tekst");
    if (it.tijd) tekst.appendChild(el("span", "tijd", it.tijd));
    tekst.appendChild(document.createTextNode(it.tekst));
    midden.appendChild(tekst);
    const onder = el("div", "onder");
    onder.appendChild(el("span", "label groen", uurTekst(it.duur || 0)));
    onder.appendChild(el("span", "label", "uit je administratie"));
    midden.appendChild(onder);
    r.appendChild(midden);
    if (MODUS === "mac" && it.bron) {
      const acties = el("div", "acties");
      const weg = el("button", "knop grijs klein", "Weghalen");
      weg.title = "Alleen uit deze week; je administratie verandert niet";
      weg.onclick = () => gewerktWeg(it);
      acties.appendChild(weg);
      r.appendChild(acties);
    }
    return r;
  }

  if (open === "bewerken") {
    // ---------- bewerken op de regel zelf ----------
    const bewerk = el("div", "bewerk");

    const bovenrij = el("div", "bewerkrij");
    const tijdIn = el("input");
    tijdIn.type = "time";
    tijdIn.value = it.tijd || "";
    tijdIn.className = "veld-tijd";
    tijdIn.title = "Hoe laat";
    bovenrij.appendChild(tijdIn);

    const duurIn = el("select");
    duurIn.className = "veld-duur";
    duurIn.title = "Hoe lang (voor je agenda)";
    for (const [waarde, naam] of [[15, "15 min"], [30, "30 min"], [45, "45 min"],
      [60, "1 uur"], [90, "1,5 uur"], [120, "2 uur"], [240, "4 uur"]]) {
      const o = el("option", null, naam);
      o.value = String(waarde);
      if ((it.duur || 30) === waarde) o.selected = true;
      duurIn.appendChild(o);
    }
    bovenrij.appendChild(duurIn);

    const watIn = el("input");
    watIn.type = "text";
    watIn.value = it.tekst;
    watIn.className = "veld-wat";
    watIn.title = "Wat er moet gebeuren";
    bovenrij.appendChild(watIn);
    bewerk.appendChild(bovenrij);

    // wat er al bij getypt of ingesproken is, met de mogelijkheid het te wijzigen
    for (const re of it.reacties || []) {
      bewerk.appendChild(tekenReactie(it, dagSleutel, re, true));
    }

    const erbij = el("textarea");
    erbij.placeholder = "Tekst erbij typen (bijvoorbeeld: Roel gebeld, hij gaat akkoord)";
    erbij.className = "veld-erbij";
    bewerk.appendChild(erbij);

    const knoppen = el("div", "bewerkrij");
    const bewaar = el("button", "knop klein", "Bewaren");
    bewaar.onclick = async () => {
      const nieuweTekst = watIn.value.trim();
      if (!nieuweTekst) { meld("Er moet wel iets staan."); return; }
      const erbijTekst = erbij.value.trim();
      OPEN = { id: null, modus: "" };
      await bewaarRegel(it, dagSleutel, {
        tekst: nieuweTekst, tijd: tijdIn.value || "", duur: parseInt(duurIn.value, 10) || 30,
      }, erbijTekst);
    };
    knoppen.appendChild(bewaar);
    const sluit = el("button", "knop grijs klein", "Sluiten");
    sluit.onclick = () => { OPEN = { id: null, modus: "" }; teken(); };
    knoppen.appendChild(sluit);
    bewerk.appendChild(knoppen);

    midden.appendChild(bewerk);
    setTimeout(() => watIn.focus(), 40);
  } else {
    // ---------- gewone weergave ----------
    r.classList.add("tikbaar");
    r.onclick = (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("textarea")) return;
      OPEN = { id: it.id, modus: "bewerken" };
      teken();
    };

    const tekst = el("div", "tekst");
    if (it.tijd) tekst.appendChild(el("span", "tijd", it.tijd));
    tekst.appendChild(document.createTextNode(it.tekst));
    midden.appendChild(tekst);

    const onder = el("div", "onder");
    if (it.soort === "afspraak") onder.appendChild(el("span", "label agenda", "afspraak"));
    if (it.soort === "vast") onder.appendChild(el("span", "label", "elke week"));
    if (it.telaat) onder.appendChild(el("span", "label oranje", "over de datum"));
    if (it.wie && it.wie.toLowerCase() !== "erik") onder.appendChild(el("span", "label", "wacht op " + it.wie));
    if (it.uiterlijk) onder.appendChild(el("span", "label", "uiterlijk " + datumNl(it.uiterlijk)));
    if (it.duur && it.duur !== 30) onder.appendChild(el("span", "label", it.duur + " min"));
    if (it.gewerkt_min) onder.appendChild(el("span", "label groen", uurTekst(it.gewerkt_min) + " gewerkt"));
    if (it.typ) {
      const b = el("button", "commando", it.typ);
      b.title = "Tik om te kopiëren";
      b.onclick = () => kopieer(it.typ);
      onder.appendChild(b);
    }
    if (onder.childElementCount) midden.appendChild(onder);

    for (const re of it.reacties || []) {
      midden.appendChild(tekenReactie(it, dagSleutel, re, false));
    }
  }

  // ---------- wat je met deze regel kunt doen: op de regel, geen venster ----------
  if (open === "dag") midden.appendChild(tekenDagkiezer(it, dagSleutel));
  if (open === "annuleren") midden.appendChild(tekenAnnuleren(it, dagSleutel));
  if (open === "opnemen") midden.appendChild(tekenOpnemen(it));

  r.appendChild(midden);

  const acties = el("div", "acties");
  const actie = (tekst, doe, titel) => {
    const b = el("button", "knop grijs klein", tekst);
    if (titel) b.title = titel;
    b.onclick = doe;
    acties.appendChild(b);
  };
  if (it.klaar) {
    actie("Weer open", () => heropen(it), "Toch niet klaar");
  } else {
    actie("Klaar", () => vinkAf(it, dagSleutel), "Afgerond");
  }
  actie("Inspreken", () => { OPEN = { id: it.id, modus: open === "opnemen" ? "" : "opnemen" }; teken(); }, "Iets inspreken bij deze regel");
  actie("Andere dag", () => { OPEN = { id: it.id, modus: open === "dag" ? "" : "dag" }; teken(); }, "Naar een andere dag");
  actie("Annuleren", () => { OPEN = { id: it.id, modus: open === "annuleren" ? "" : "annuleren" }; teken(); }, "Gaat niet gebeuren");
  r.appendChild(acties);
  return r;
}

/** Een stukje tekst dat bij een regel hoort, met de mogelijkheid het te wijzigen of weg te halen. */
function tekenReactie(it, dagSleutel, re, bewerkbaar) {
  const d = el("div", "reactie");
  const kop = el("span", "wanneer", re.wanneer);
  d.appendChild(kop);
  if (!bewerkbaar) {
    d.appendChild(document.createTextNode(re.tekst));
    return d;
  }
  const invoer = el("input");
  invoer.type = "text";
  invoer.value = re.tekst;
  invoer.className = "veld-reactie";
  d.appendChild(invoer);
  const rij = el("div", "bewerkrij");
  const bewaar = el("button", "knop grijs klein", "Deze tekst bewaren");
  bewaar.onclick = async () => {
    const nieuw = invoer.value.trim();
    if (!nieuw) { meld("Er staat niets in; gebruik Weghalen als je hem kwijt wil."); return; }
    if (nieuw === re.tekst) { meld("Niets veranderd."); return; }
    re.tekst = nieuw;
    await doeItems([{
      id: nieuwId(), soort: "reactie-gewijzigd", taak_id: it.id, taak_tekst: it.tekst,
      dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel, wanneer_van: re.wanneer, tekst: nieuw,
    }], "Tekst bijgewerkt.");
  };
  rij.appendChild(bewaar);
  const weg = el("button", "knop grijs klein", "Weghalen");
  weg.onclick = async () => {
    it.reacties = (it.reacties || []).filter((x) => x !== re);
    await doeItems([{
      id: nieuwId(), soort: "reactie-weg", taak_id: it.id, taak_tekst: it.tekst,
      dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel, wanneer_van: re.wanneer,
    }], "Weggehaald.");
  };
  rij.appendChild(weg);
  d.appendChild(rij);
  return d;
}

/** Naar een andere dag, gekozen op de regel zelf. */
function tekenDagkiezer(it, dagSleutel) {
  const vak = el("div", "bewerkrij");
  vak.appendChild(el("span", "hint", "Naar welke dag?"));
  const datumIn = el("input");
  datumIn.type = "date";
  datumIn.value = dagSleutel === "vrij" ? "" : dagSleutel;
  datumIn.className = "veld-datum";
  datumIn.onchange = async () => {
    OPEN = { id: null, modus: "" };
    await verschuif(it, dagSleutel, datumIn.value || "vrij");
  };
  vak.appendChild(datumIn);
  const snel = (tekst, naar) => {
    const b = el("button", "knop grijs klein", tekst);
    b.onclick = async () => { OPEN = { id: null, modus: "" }; await verschuif(it, dagSleutel, naar); };
    vak.appendChild(b);
  };
  const basis = dagSleutel === "vrij" ? vandaagIso() : dagSleutel;
  snel("Morgen", plusDagen(basis, 1));
  snel("Volgende week", plusDagen(basis, 7));
  snel("Nog geen dag", "vrij");
  return vak;
}

/** Afmelden, met een bevestiging op de regel zelf. */
function tekenAnnuleren(it, dagSleutel) {
  const vak = el("div", "bewerkrij");
  vak.appendChild(el("span", "hint",
    "Zeker? Hij verdwijnt niet: hij komt bij Klaar te staan met \"(vervallen)\" erachter."));
  const ja = el("button", "knop klein", "Ja, annuleren");
  ja.onclick = async () => {
    OPEN = { id: null, modus: "" };
    it.klaar = vandaagIso();
    await doeItems([{
      id: nieuwId(), soort: "afgemeld", taak_id: it.id, taak_tekst: it.tekst,
      dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel,
    }], "Geannuleerd.");
  };
  vak.appendChild(ja);
  const nee = el("button", "knop grijs klein", "Nee, laat maar staan");
  nee.onclick = () => { OPEN = { id: null, modus: "" }; teken(); };
  vak.appendChild(nee);
  return vak;
}

/** Inspreken op de regel zelf: een bolletje, een teller en twee knoppen. */
function tekenOpnemen(it) {
  const vak = el("div", "bewerkrij opnemen");
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    vak.appendChild(el("span", "hint",
      "Opnemen kan hier niet. Op een telefoon werkt het alleen via een beveiligde verbinding (https)."));
    return vak;
  }
  vak.appendChild(el("div", "bol"));
  const teller = el("div", "teller", "0:00");
  vak.appendChild(teller);
  const stop = el("button", "knop klein", "Stoppen en bewaren");
  vak.appendChild(stop);
  const weg = el("button", "knop grijs klein", "Weggooien");
  vak.appendChild(weg);

  let seconden = 0;
  let klok = null;
  let recorder = null;
  let stroom = null;
  const brokken = [];
  let bewaren = false;

  navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
    stroom = s;
    recorder = new MediaRecorder(s, opnameOpties());
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) brokken.push(e.data); };
    recorder.onstop = async () => {
      stroom.getTracks().forEach((t) => t.stop());
      clearInterval(klok);
      if (!bewaren) return;
      await rondMemoAf(brokken, recorder.mimeType, it, seconden);
    };
    // Elke seconde een stukje ophalen; dan staat er altijd geluid klaar.
    recorder.start(1000);
    klok = setInterval(() => {
      seconden++;
      teller.textContent = `${Math.floor(seconden / 60)}:${String(seconden % 60).padStart(2, "0")}`;
      if (seconden >= 300) stop.click();
    }, 1000);
  }).catch(() => {
    teller.textContent = "geen microfoon";
    meld("Ik kan de microfoon niet gebruiken. Geef deze app toegang tot de microfoon.", "fout");
  });

  stop.onclick = () => {
    bewaren = true;
    OPEN = { id: null, modus: "" };
    try { recorder && recorder.stop(); } catch { /* al gestopt */ }
    meld("Even geduld, ik zet je memo klaar…");
    teken();
  };
  weg.onclick = () => {
    bewaren = false;
    OPEN = { id: null, modus: "" };
    try { recorder && recorder.stop(); } catch { /* al gestopt */ }
    if (stroom) stroom.getTracks().forEach((t) => t.stop());
    clearInterval(klok);
    teken();
  };
  return vak;
}

/** Bewaart wat er op de regel is aangepast, en zet er meteen de extra tekst bij. */
async function bewaarRegel(it, dagSleutel, velden, erbijTekst) {
  const items = [];
  const zelfde = velden.tekst === it.tekst && velden.tijd === (it.tijd || "")
    && velden.duur === (it.duur || 30);
  if (!zelfde) {
    it.tekst = velden.tekst;
    it.tijd = velden.tijd;
    it.duur = velden.duur;
    items.push({
      id: nieuwId(), soort: "gewijzigd", taak_id: it.id, taak_tekst: it.tekst,
      dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel,
      tekst: velden.tekst, tijd: velden.tijd, duur: velden.duur,
    });
  }
  if (erbijTekst) {
    const wanneer = new Date().toISOString().slice(0, 16).replace("T", " ");
    it.reacties = it.reacties || [];
    it.reacties.push({ wanneer, tekst: erbijTekst });
    items.push({
      id: nieuwId(), soort: "reactie", taak_id: it.id, taak_tekst: it.tekst, tekst: erbijTekst,
      dag: dagSleutel === "vrij" ? PLAN.van : dagSleutel,
    });
  }
  if (!items.length) { teken(); meld("Niets veranderd."); return; }
  await doeItems(items, erbijTekst && !zelfde ? "Bijgewerkt en tekst erbij gezet."
    : (erbijTekst ? "Tekst erbij gezet." : "Bijgewerkt."));
}

async function verschuif(it, vanSleutel, naarSleutel) {
  // op het scherm alvast verplaatsen
  const bron = vanSleutel === "vrij" ? PLAN.vrij : (PLAN.dagen.find((d) => d.datum === vanSleutel)?.items || []);
  const i = bron.indexOf(it);
  if (i >= 0) bron.splice(i, 1);
  if (naarSleutel === "vrij") (PLAN.vrij = PLAN.vrij || []).push(it);
  else {
    const doel = PLAN.dagen.find((d) => d.datum === naarSleutel);
    if (doel) doel.items.push(it);
    // een dag buiten deze week: dan verdwijnt hij van dit scherm, dat is goed
  }
  await doeItems([{
    id: nieuwId(), soort: "verschoven", taak_id: it.id, taak_tekst: it.tekst,
    van_dag: vanSleutel === "vrij" ? PLAN.van : vanSleutel, naar_dag: naarSleutel,
  }], naarSleutel === "vrij" ? "Van de dag afgehaald." : "Verplaatst.");
}

function vraagNieuw(dagSleutel) {
  const vak = el("div");
  vak.appendChild(el("label", null, "Wat moet er gebeuren?"));
  const invoer = el("input");
  invoer.type = "text";
  invoer.placeholder = "Bijvoorbeeld: Marc bellen over de nulmeting";
  vak.appendChild(invoer);

  // Waar je staat is alvast gekozen (sta je in de To do-lijst, dan komt het daar);
  // het keuzemenu is er alleen om het nog te kunnen veranderen.
  vak.appendChild(el("label", null, "Waar komt het te staan?"));
  const keuze = el("select");
  for (const dag of PLAN.dagen) {
    const o = el("option", null, `${hoofdletter(dagnaamVan(dag.datum))} ${datumNl(dag.datum)}`);
    o.value = dag.datum;
    if (dag.datum === dagSleutel) o.selected = true;
    keuze.appendChild(o);
  }
  const o = el("option", null, "Nog geen dag (wel deze week)");
  o.value = "vrij";
  if (dagSleutel === "vrij") o.selected = true;
  keuze.appendChild(o);
  const ot = el("option", null, "Op je To do-lijst (geen week)");
  ot.value = "todo";
  if (dagSleutel === "todo") ot.selected = true;
  keuze.appendChild(ot);
  vak.appendChild(keuze);

  vak.appendChild(el("label", null, "Tijd (mag leeg)"));
  const tijd = el("input");
  tijd.type = "time";
  vak.appendChild(tijd);

  vak.appendChild(el("p", null,
    "Nieuwe taken komen ook in je takenlijst te staan: bij \"Deze week\", of bij \"To do\" als je je lijst kiest."));

  const dlg = paneel("Iets toevoegen", null, vak, [{
    tekst: "Toevoegen", stijl: "", sluit: false, doe: async () => {
      const tekst = invoer.value.trim();
      if (!tekst) { meld("Er staat nog niets in."); return; }
      dlg.close();
      const dag = keuze.value;
      if (dag === "todo") {
        const id = nieuwId();
        // Bovenaan de lijst: het laatst opgeschreven staat bovenaan.
        TODO.unshift({ id, nr: "", tekst, wie: "", uiterlijk: "", klaar: "", wacht_op_ander: false });
        if (MODUS === "telefoon") { SCHERM = "todo"; } else { DAG = "todo"; }
        await doeItems([{ id, soort: "nieuwe-taak", todo: 1, tekst }], "Op je To do-lijst gezet.");
        return;
      }
      const nieuw = {
        id: nieuwId(), soort: "taak", tekst, tijd: tijd.value || "",
        wie: "", uiterlijk: "", klaar: "", reacties: [],
      };
      if (dag === "vrij") (PLAN.vrij = PLAN.vrij || []).push(nieuw);
      else PLAN.dagen.find((d) => d.datum === dag)?.items.push(nieuw);
      DAG = dag;
      await doeItems([{
        id: nieuw.id, soort: "nieuwe-taak", tekst, tijd: tijd.value || "",
        dag: dag === "vrij" ? "" : dag,
      }], "Toegevoegd.");
    },
  }]);
  setTimeout(() => invoer.focus(), 60);
}

// ---------- inspreken ----------

let opname = null;

function vraagMemo(bijItem) {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    paneel("Inspreken", null,
      "Dit toestel of deze verbinding staat opnemen niet toe. Op een telefoon werkt het alleen via een beveiligde verbinding (https).", []);
    return;
  }
  const vak = el("div");
  const stand = el("div", "opnemen");
  const bol = el("div", "bol");
  const teller = el("div", "teller", "0:00");
  stand.appendChild(bol);
  stand.appendChild(teller);
  vak.appendChild(stand);
  vak.appendChild(el("p", null, "Vertel gewoon wat je kwijt wil. Op de Mac wordt het uitgetypt en in het brein gezet. Er gaat niets naar een clouddienst."));
  const geluidVak = el("div");
  vak.appendChild(geluidVak);

  let seconden = 0;
  let klok = null;
  const dlg = paneel("Inspreken", bijItem ? "bij: " + bijItem.tekst : "een losse gedachte", vak, [
    { tekst: "Stoppen en bewaren", stijl: "", sluit: false, doe: () => stop(true) },
    { tekst: "Weggooien", sluit: false, doe: () => stop(false) },
  ]);
  // Het venster sluiten telt als weggooien — MAAR alleen als er nog geen keuze is
  // gemaakt. Anders zou "Stoppen en bewaren" zichzelf omzetten naar weggooien: die
  // knop sluit namelijk het venster, en dat sluiten kwam hier weer binnen. Precies
  // daardoor verdween elke ingesproken memo (gemeld door Erik, 27 juli 2026).
  let gekozen = false;
  dlg.addEventListener("close", () => { if (!gekozen) stop(false); }, { once: true });

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stroom) => {
    const recorder = new MediaRecorder(stroom, opnameOpties());
    const brokken = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) brokken.push(e.data); };
    recorder.onstop = async () => {
      stroom.getTracks().forEach((t) => t.stop());
      clearInterval(klok);
      const bewaren = !!(opname && opname.bewaren);
      opname = null;
      if (!bewaren) return;
      await rondMemoAf(brokken, recorder.mimeType, bijItem, seconden);
    };
    opname = { recorder, bewaren: false };
    // Elke seconde een stukje geluid ophalen. Zo staat er altijd iets klaar, ook als
    // het toestel het opnemen halverwege afbreekt.
    recorder.start(1000);
    klok = setInterval(() => {
      seconden++;
      teller.textContent = `${Math.floor(seconden / 60)}:${String(seconden % 60).padStart(2, "0")}`;
      if (seconden >= 300) stop(true); // vijf minuten is genoeg voor een memo
    }, 1000);
  }).catch(() => {
    bol.remove();
    teller.textContent = "geen microfoon";
    meld("Ik kan de microfoon niet gebruiken. Geef in je telefooninstellingen toegang tot de microfoon voor deze app.", "fout");
  });

  function stop(bewaren) {
    if (gekozen) { dlg.close(); return; }
    gekozen = true;
    if (opname) {
      opname.bewaren = bewaren;
      try { opname.recorder.stop(); } catch { /* al gestopt */ }
    }
    dlg.close();
    if (bewaren) meld("Even geduld, ik zet je memo klaar…");
  }
}

/** Het opgenomen geluid omzetten naar een gewone WAV van 16.000 per seconde, mono.
 *  Dat is klein én iedere uitschrijver op de Mac kan het lezen. */
async function naarWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const doelHz = 16000;
  const lengte = Math.ceil(buffer.duration * doelHz);
  const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, lengte, doelHz);
  const bron = off.createBufferSource();
  bron.buffer = buffer;
  bron.connect(off.destination);
  bron.start();
  const uit = await off.startRendering();
  ctx.close();

  const kanaal = uit.getChannelData(0);
  const bytes = new ArrayBuffer(44 + kanaal.length * 2);
  const kijk = new DataView(bytes);
  const tekst = (plek, s) => { for (let i = 0; i < s.length; i++) kijk.setUint8(plek + i, s.charCodeAt(i)); };
  tekst(0, "RIFF");
  kijk.setUint32(4, 36 + kanaal.length * 2, true);
  tekst(8, "WAVEfmt ");
  kijk.setUint32(16, 16, true);
  kijk.setUint16(20, 1, true);
  kijk.setUint16(22, 1, true);
  kijk.setUint32(24, doelHz, true);
  kijk.setUint32(28, doelHz * 2, true);
  kijk.setUint16(32, 2, true);
  kijk.setUint16(34, 16, true);
  tekst(36, "data");
  kijk.setUint32(40, kanaal.length * 2, true);
  for (let i = 0; i < kanaal.length; i++) {
    const v = Math.max(-1, Math.min(1, kanaal[i]));
    kijk.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/** Welke geluidssoort mag dit toestel opnemen? Zonder keuze pakt de ene telefoon webm
 *  en de andere mp4; door het zelf te kiezen weten we wat eruit komt. */
function opnameOpties() {
  const soorten = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const s of soorten) {
    try {
      if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(s)) return { mimeType: s };
    } catch { /* dit toestel wil er niets over zeggen; dan de standaard */ }
  }
  return {};
}

function extensieVan(type) {
  const s = String(type || "");
  if (s.includes("wav")) return "wav";
  if (s.includes("mp4") || s.includes("m4a")) return "m4a";
  if (s.includes("ogg")) return "ogg";
  return "webm";
}

/** Afronden na het opnemen. Drie dingen die het betrouwbaar maken:
 *  - is er niets opgenomen, dan zeggen we dat (in plaats van stil te verdwijnen);
 *  - lukt het omzetten naar WAV niet op dit toestel, dan gaat de opname zoals hij is —
 *    de Mac leest webm, m4a en ogg net zo goed;
 *  - gaat er verderop iets mis, dan komt dat in beeld en niet in de doofpot. */
async function rondMemoAf(brokken, mimeType, bijItem, seconden) {
  const ruw = new Blob(brokken, { type: mimeType || "audio/webm" });
  if (!ruw.size) {
    meld("Er is geen geluid opgenomen. Mag deze app de microfoon gebruiken?", "fout");
    return;
  }
  let geluid = ruw;
  try {
    geluid = await naarWav(ruw);
  } catch {
    geluid = ruw; // omzetten kan niet op dit toestel; de Mac doet het dan wel
  }
  try {
    await bewaarMemo(geluid, bijItem, seconden);
  } catch (e) {
    meld("Je memo kon niet worden klaargezet (" + String((e && e.message) || e).slice(0, 60) + ").", "fout");
  }
}

async function bewaarMemo(geluid, bijItem, seconden) {
  const data = await naarBase64(geluid);
  const type = geluid.type || "audio/wav";
  const item = {
    id: nieuwId(), soort: "memo",
    taak_id: bijItem ? bijItem.id : "", taak_tekst: bijItem ? bijItem.tekst : "",
    seconden,
    geluid: { naam: "memo." + extensieVan(type), type, data },
  };
  if (MODUS === "mac") {
    await doeItems([item], "Memo bewaard. Hij staat bij \"dingen die op jou wachten\".");
  } else {
    await zetInWachtrij(item);
    teken();
    // De grootte erbij: zo zie je met eigen ogen dat er echt geluid in zit.
    meld(`Memo van ${seconden} seconden (${Math.max(1, Math.round(geluid.size / 1024))} kB) staat klaar om door te sturen.`, "goed");
  }
}

function naarBase64(blob) {
  return new Promise((klaar, fout) => {
    const lezer = new FileReader();
    lezer.onload = () => klaar(String(lezer.result).split(",")[1] || "");
    lezer.onerror = () => fout(lezer.error);
    lezer.readAsDataURL(blob);
  });
}

// ---------- doorsturen (telefoon → Mac) ----------

/** Het pakketje zoals het naar de Mac gaat: een gewoon tekstbestand met JSON erin.
 *  De naam maakt niet uit — de Mac kijkt naar de inhoud. Tekst is bewust gekozen:
 *  telefoons doen moeilijk over .json (Android weigert dat in het deelmenu). */
function maakPakketje(items) {
  const inhoud = {
    versie: 1,
    soort: "aibrein-post",
    apparaat: apparaatNaam(),
    verstuurd: new Date().toISOString(),
    items,
  };
  const stempel = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")} ${apparaatNaam()}`;
  return new File([JSON.stringify(inhoud)], `AI Brein ${stempel}.txt`, { type: "text/plain" });
}

/** Doorsturen = het bestandje gewoon opslaan. Bewust GEEN deelvenster: geen enkele
 *  telefoonbrowser mag zelf in een map schrijven (dat is een regel van de telefoon,
 *  zie caniuse "File System Access API"), en in dat deelvenster staat je eigen map
 *  niet — het is immers geen app om iets naartoe te sturen. Wat wél kan: de
 *  downloadmap van je browser één keer op "Postbus FixFerm" zetten. Dan landt elk
 *  pakketje daar meteen, zonder dat je iets hoeft te kiezen. (Erik, 27 juli 2026:
 *  "het enige wat er moet gebeuren is dat het in die map wordt geplaatst".) */
async function doorsturen() {
  if (!WACHTRIJ.length) { meld("Er staat niets klaar."); return; }
  const items = WACHTRIJ.slice();
  const bestand = maakPakketje(items);
  try {
    const url = URL.createObjectURL(bestand);
    const a = document.createElement("a");
    a.href = url;
    a.download = bestand.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await wachtrijLeeg(items);
    teken();
    meld(`${items.length} ${items.length === 1 ? "ding" : "dingen"} opgeslagen in je downloadmap.`, "goed");
  } catch (e) {
    meld("Opslaan lukte niet. Alles staat nog klaar; probeer het zo nog eens.", "fout");
  }
}

/** De uitwijk voor een toestel waar de downloadmap niet in te stellen is: alsnog het
 *  deelmenu. Zit weggestopt onder "Anders doorsturen", want normaal heb je het niet
 *  nodig. */
async function doorsturenViaDeelmenu() {
  if (!WACHTRIJ.length) { meld("Er staat niets klaar."); return; }
  const items = WACHTRIJ.slice();
  const bestand = maakPakketje(items);
  if (!kanDelen(bestand)) {
    meld("Dit toestel kan bestanden niet delen. Gebruik de gewone knop Doorsturen.", "fout");
    return;
  }
  try {
    await navigator.share({
      files: [bestand],
      title: "Voor de weekplanning",
      text: "Zet dit bestandje in je map Postbus FixFerm.",
    });
    await wachtrijLeeg(items);
    teken();
    meld(`${items.length} ${items.length === 1 ? "ding" : "dingen"} doorgestuurd.`, "goed");
  } catch (e) {
    if (String(e).includes("Abort")) { meld("Afgebroken; alles staat nog klaar."); return; }
    meld("Delen lukte niet. Alles staat nog klaar.", "fout");
  }
}

/** Kan dit toestel dit bestand via het deelmenu delen? */
function kanDelen(bestand) {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [bestand] }));
  } catch {
    return false;
  }
}

// ---------- de QR-code (Mac) ----------

async function toonQr() {
  if (!STAND) return;
  if (!STAND.telefoon_adres) { vraagAdres(); return; }
  if (!STAND.qr) { meld("Ik kan de code nu niet maken.", "fout"); return; }

  const vak = el("div");
  const blok = el("div", "qr-blok");
  const plaat = el("div", "qr-plaatje");
  blok.appendChild(plaat);
  const uitleg = el("div", "qr-uitleg");
  const stappen = el("ol");
  for (const s of [
    "Richt de camera van je telefoon op de code.",
    "Tik op de melding die verschijnt; de app opent met deze week erin.",
    "De eerste keer: tik op het deel-knopje en kies \"Zet op beginscherm\".",
  ]) stappen.appendChild(el("li", null, s));
  uitleg.appendChild(stappen);
  uitleg.appendChild(el("p", null,
    `Hierin zit de hele week: ${tellingVanPlan()}. Er gaat niets naar internet; wat achter het hekje in het adres staat leest je telefoon zelf.`));
  // Kan de telefoon geen code scannen (geen camera, of hij wil niet)? Dan zijn er twee
  // wegen zonder scannen. Het webadres is kort genoeg om over te typen; de link mét je
  // week is dat niet (ruim duizend tekens), dus die stuur je naar jezelf.
  const zonder = el("div", "zonder-scannen");
  zonder.appendChild(el("strong", null, "Kan je telefoon niet scannen?"));
  const stappen2 = el("ol");
  const li1 = el("li");
  li1.appendChild(document.createTextNode("Typ dit adres in de browser van je telefoon: "));
  li1.appendChild(el("strong", null, STAND.telefoon_adres.replace(/^https?:\/\//, "")));
  li1.appendChild(document.createTextNode(" — dan heb je de app (en kun je hem op je beginscherm zetten)."));
  stappen2.appendChild(li1);
  stappen2.appendChild(el("li", null,
    "Voor de week zelf: kopieer hieronder de link en stuur die naar jezelf (WhatsApp, mail). "
    + "Tik hem op je telefoon aan en je week staat erop. Die link is te lang om te typen."));
  zonder.appendChild(stappen2);

  const kopieerrij = el("div", "knoppenrij");
  // De link komt altijd óók in beeld te staan, alvast geselecteerd. Kopiëren via de knop
  // werkt meestal, maar niet in elke browser; dan kun je hem gewoon met Cmd+C pakken.
  const linkvak = el("textarea", "linkvak");
  linkvak.readOnly = true;
  linkvak.hidden = true;
  const kopieerLink = el("button", "knop grijs klein",
    STAND.qr.delen > 1 ? "Laat de link zien van de code die je nu ziet" : "Laat de link zien (en kopieer hem)");
  kopieerLink.onclick = () => {
    const url = STAND.qr.urls[deel];
    linkvak.value = url;
    linkvak.hidden = false;
    linkvak.focus();
    linkvak.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => meld("De link staat op je klembord. Stuur hem naar jezelf en tik hem op je telefoon aan.", "goed"),
        () => meld("De link staat hieronder klaar en is geselecteerd: kopieer hem met Cmd + C."),
      );
    } else {
      meld("De link staat hieronder klaar en is geselecteerd: kopieer hem met Cmd + C.");
    }
  };
  kopieerrij.appendChild(kopieerLink);
  const kopieerAdres = el("button", "knop grijs klein", "Laat alleen het webadres zien");
  kopieerAdres.onclick = () => {
    linkvak.value = STAND.telefoon_adres;
    linkvak.hidden = false;
    linkvak.focus();
    linkvak.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(STAND.telefoon_adres).then(
        () => meld("Het webadres staat op je klembord.", "goed"),
        () => meld("Het adres staat hieronder klaar en is geselecteerd."),
      );
    } else {
      meld("Het adres staat hieronder klaar en is geselecteerd.");
    }
  };
  kopieerrij.appendChild(kopieerAdres);
  zonder.appendChild(kopieerrij);
  zonder.appendChild(linkvak);
  uitleg.appendChild(zonder);

  const anders = el("button", "knop grijs klein", "Ander webadres");
  anders.onclick = () => { $("paneel").close(); vraagAdres(); };
  uitleg.appendChild(anders);
  blok.appendChild(uitleg);
  vak.appendChild(blok);

  let deel = 0;
  const wissel = el("div");
  if (STAND.qr.delen > 1) {
    const knoppen = el("div", "keuzeknoppen");
    for (let i = 0; i < STAND.qr.delen; i++) {
      const b = el("button", "knop grijs klein", `Code ${i + 1} van ${STAND.qr.delen}`);
      b.onclick = () => { deel = i; tekenCode(); for (const x of knoppen.children) x.classList.remove("aan"); b.classList.add("aan"); };
      if (i === 0) b.classList.add("aan");
      knoppen.appendChild(b);
    }
    wissel.appendChild(el("p", null, "Deze week is groot, dus hij past niet in één code. Scan ze allebei; de app zegt zelf wanneer hij compleet is."));
    wissel.appendChild(knoppen);
  }
  vak.appendChild(wissel);

  paneel("Naar mijn telefoon", `week ${PLAN.week}, stand van nu`, vak, []);
  await tekenCode();

  async function tekenCode() {
    plaat.innerHTML = "";
    const svg = await QRTekenaar.toString(STAND.qr.urls[deel], {
      type: "svg", errorCorrectionLevel: "L", margin: 1, width: 340,
    });
    plaat.innerHTML = svg;
  }

  // onthouden bij welke stand de code in beeld was
  fetch("/api/gescand", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stempel: STAND.stempel }),
  }).then(() => { STAND.laatst_gescand = STAND.stempel; tekenSeintjes(); }).catch(() => { /* niet belangrijk */ });
}

function tellingVanPlan() {
  let afspraken = 0, taken = 0, vast = 0, gewerkt = 0;
  for (const dag of PLAN.dagen.concat([{ items: PLAN.vrij || [] }])) {
    for (const it of dag.items) {
      if (it.soort === "afspraak") afspraken++;
      else if (it.soort === "vast") vast++;
      else if (it.soort === "gewerkt") gewerkt++;
      else taken++;
    }
  }
  const woord = (n, e, m) => `${n} ${n === 1 ? e : m}`;
  const todoOpen = TODO.filter((t) => !t.klaar).length;
  return `${woord(afspraken, "afspraak", "afspraken")}, ${woord(taken, "taak", "taken")} en ${woord(vast, "vast punt", "vaste punten")}`
    + (todoOpen ? `, plus je To do-lijst (${woord(todoOpen, "punt", "punten")})` : "")
    + (gewerkt ? ` (en ${woord(gewerkt, "gewerkte uurregel", "gewerkte uurregels")} uit je administratie)` : "");
}

/** Minuten in gewone taal: 45 min, 1 uur, 1,5 uur, 2 uur 10 min. */
function uurTekst(min) {
  const m = Math.round(min || 0);
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} uur`;
  if (m % 30 === 0) return `${(m / 60).toString().replace(".", ",")} uur`;
  return `${Math.floor(m / 60)} uur ${m % 60} min`;
}

function vraagAdres() {
  const vak = el("div");
  vak.appendChild(el("label", null, "Op welk webadres staat de app voor je telefoon?"));
  const invoer = el("input");
  invoer.type = "text";
  invoer.placeholder = "https://weekplanning-….vercel.app";
  invoer.value = (STAND && STAND.telefoon_adres) || "";
  vak.appendChild(invoer);
  vak.appendChild(el("p", null,
    "Dat is het openbare adres waar de app staat. Voor de camera, het opnemen en het deelmenu van je telefoon is https nodig; het adres van je NAS werkt daar niet voor."));
  const dlg = paneel("Webadres van de telefoon-app", null, vak, [{
    tekst: "Bewaren", stijl: "", sluit: false, doe: async () => {
      const r = await fetch("/api/adres", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adres: invoer.value }),
      });
      const data = await r.json();
      if (data.fout) { meld(data.fout, "fout"); return; }
      STAND = data.stand; PLAN = STAND.plan;
      dlg.close();
      teken();
      meld("Bewaard.", "goed");
    },
  }]);
  setTimeout(() => invoer.focus(), 60);
}

// ---------- scannen op de telefoon ----------

async function scanNieuweWeek() {
  const kan = "BarcodeDetector" in window;
  if (!kan || !navigator.mediaDevices) {
    paneel("Nieuwe week scannen", null,
      "Deze telefoon kan niet in de app zelf scannen. Gebruik gewoon je camera-app: richt hem op de code op je Mac en tik op de melding. Dan opent deze app met de nieuwe week erin.", []);
    return;
  }
  const vak = el("div");
  const video = el("video", "scanner");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  vak.appendChild(video);
  vak.appendChild(el("p", null, "Richt op de code op je Mac. Hij springt vanzelf over zodra hij hem ziet."));
  const dlg = paneel("Nieuwe week scannen", null, vak, []);

  let stroom = null;
  let bezig = true;
  dlg.addEventListener("close", () => {
    bezig = false;
    if (stroom) stroom.getTracks().forEach((t) => t.stop());
  }, { once: true });

  try {
    stroom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stroom;
    const speurder = new window.BarcodeDetector({ formats: ["qr_code"] });
    const gezien = new Set();
    while (bezig) {
      await new Promise((k) => setTimeout(k, 350));
      let codes = [];
      try { codes = await speurder.detect(video); } catch { /* nog geen beeld */ }
      for (const c of codes) {
        const waarde = c.rawValue || "";
        if (gezien.has(waarde)) continue;
        gezien.add(waarde);
        const hash = waarde.slice(waarde.indexOf("#"));
        if (!hash.startsWith("#w=")) continue;
        const gelukt = await neemCodeOver(hash);
        if (gelukt && PLAN && !localStorage.getItem(SLEUTEL_DELEN)) {
          dlg.close();
          teken();
          return;
        }
      }
    }
  } catch {
    meld("Ik kan de camera niet gebruiken. Gebruik je camera-app om de code te scannen.", "fout");
    dlg.close();
  }
}

// ---------- knoppen van de Mac ----------

async function andereWeek(dagen) {
  DAG = null;
  await haalStand(plusDagen(PLAN.van, dagen));
  teken();
}

async function bouwOpnieuw() {
  await metBezig("Ik haal je vaste week, je open taken en je gewerkte uren erbij…", async () => {
    const r = await fetch("/api/opnieuw" + (PLAN ? "?van=" + PLAN.van : ""), { method: "POST" });
    const data = await r.json();
    STAND = data.stand; PLAN = STAND.plan;
    const u = data.uren || {};
    if (u.gelukt === false) {
      meld("De planning is bijgewerkt uit het brein. Let op: " + (u.melding || "de uren konden niet mee") + ".");
    } else if (u.tekst) {
      meld("De planning is bijgewerkt uit het brein; " + u.tekst + ".", "goed");
    } else {
      meld("De planning is bijgewerkt uit het brein.", "goed");
    }
  });
}

/** Een gewerkt-regel uit deze week halen (alleen op de Mac; de administratie blijft zoals hij is). */
async function gewerktWeg(it) {
  const r = await fetch("/api/gewerkt-weg" + (PLAN ? "?van=" + PLAN.van : ""), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bron: it.bron }),
  });
  const data = await r.json();
  if (data.stand) { STAND = data.stand; PLAN = STAND.plan; }
  teken();
  meld(data.melding || data.fout || "Klaar.", data.fout ? "fout" : "goed");
}

/** Klusje dat even duurt: zichtbaar maken dat hij bezig is, knoppen even op slot. */
async function metBezig(tekst, doe) {
  BEZIG = tekst;
  teken();
  try {
    await doe();
  } catch (e) {
    meld("Dat lukte niet (" + String(e.message || e).slice(0, 60) + ").", "fout");
  } finally {
    BEZIG = "";
    teken();
  }
}

async function haalAgenda() {
  await metBezig("Ik vraag je agenda op. De Agenda-app van je Mac doet daar ongeveer een halve minuut over; je hoeft niets te doen.", async () => {
    const r = await fetch("/api/agenda" + (PLAN ? "?van=" + PLAN.van : ""), { method: "POST" });
    const data = await r.json();
    STAND = data.stand; PLAN = STAND.plan;
    if (data.gelukt) meld(`${data.aantal} ${data.aantal === 1 ? "afspraak" : "afspraken"} uit je agenda erbij gezet.`, "goed");
    else meld(data.melding || "De agenda gaf geen antwoord. De rest werkt gewoon.", "fout");
  });
}

async function naarAgenda() {
  await metBezig("Ik zet je week in de Agenda-app van je Mac…", async () => {
    const r = await fetch("/api/naar-agenda" + (PLAN ? "?van=" + PLAN.van : ""), { method: "POST" });
    const data = await r.json();
    STAND = data.stand; PLAN = STAND.plan;
    meld(data.samenvatting, data.uitkomst && data.uitkomst.gelukt ? "goed" : "fout");
  });
}

async function haalBinnen() {
  await metBezig("Ik kijk in de map van je telefoon. Zit er een ingesproken memo bij, dan typ ik die meteen uit; dat duurt een halve minuut per memo.", async () => {
    const r = await fetch("/api/binnenhalen" + (PLAN ? "?van=" + PLAN.van : ""), { method: "POST" });
    const data = await r.json();
    STAND = data.stand; PLAN = STAND.plan;
    const u = data.uitkomst || {};
    if (!u.bereikbaar) { meld("De map op de NAS is nu niet bereikbaar.", "fout"); return; }
    meld(u.gedaan ? "Binnengehaald: " + data.samenvatting + "." : "Er stond niets nieuws klaar.", u.gedaan ? "goed" : undefined);
  });
}

/**
 * Punten die op elkaar lijken maar niet precies hetzelfde zijn. De app gooit ze niet
 * samen en zet ze ook niet stilletjes dubbel neer: Erik ziet ze naast elkaar en kiest.
 */
function toonTwijfels() {
  const vak = el("div");
  const lijst = (STAND.plan && STAND.plan.twijfels) || [];
  if (!lijst.length) {
    vak.appendChild(el("p", null, "Er staat niets dubbel."));
    paneel("Lijkt dit dubbel?", "", vak, []);
    return;
  }
  vak.appendChild(el("p", null, "Deze punten lijken op elkaar. Horen ze allebei in je week, of is er één te veel?"));

  for (const t of lijst) {
    const kaart = el("div", "regel");
    const midden = el("div", "midden");

    for (const kant of ["een", "twee"]) {
      const p = t[kant];
      const rij = el("div", "tekst", (p.tijd ? p.tijd + " " : "") + p.tekst);
      midden.appendChild(rij);
      const onder = el("div", "onder");
      onder.appendChild(el("span", "label", p.herkomst));
      onder.appendChild(el("span", "label", p.dag === "vrij" ? "nog geen dag" : dagnaamVan(p.dag)));
      const weg = el("button", "knop grijs klein", "Deze weghalen");
      weg.onclick = () => kiesTwijfel(t.sleutel, p.id);
      onder.appendChild(weg);
      midden.appendChild(onder);
    }

    const beide = el("button", "knop grijs klein", "Allebei laten staan");
    beide.onclick = () => kiesTwijfel(t.sleutel, "beide");
    midden.appendChild(beide);

    kaart.appendChild(midden);
    vak.appendChild(kaart);
  }
  paneel("Lijkt dit dubbel?", "jij kiest, ik gok niet", vak, []);
}

async function kiesTwijfel(sleutel, keuze) {
  const r = await fetch("/api/twijfel" + (PLAN ? "?van=" + PLAN.van : ""), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sleutel, keuze }),
  });
  const data = await r.json();
  STAND = data.stand; PLAN = STAND.plan;
  meld(data.melding, data.gelukt ? "goed" : "fout");
  teken();
  if (STAND.plan && STAND.plan.twijfels && STAND.plan.twijfels.length) toonTwijfels();
  else $("paneel").close();
}

function toonAandacht() {
  const vak = el("div");
  const lijst = STAND.aandacht || [];
  if (!lijst.length) vak.appendChild(el("p", null, "Er wacht niets op je."));
  for (const a of lijst) {
    const kaart = el("div", "regel");
    const midden = el("div", "midden");
    midden.appendChild(el("div", "tekst", a.tekst || "(nog geen tekst)"));
    const onder = el("div", "onder");
    onder.appendChild(el("span", "label", a.soort === "memo" ? "ingesproken" : "reactie"));
    onder.appendChild(el("span", "label", a.wanneer));
    if (a.bij) onder.appendChild(el("span", "label", "bij: " + a.bij));
    midden.appendChild(onder);
    if (a.vraag) midden.appendChild(el("div", "hint", a.vraag));
    if (a.soort === "memo" && a.geluid && !a.tekst) {
      const b = el("button", "knop grijs klein", "Laten uittypen");
      b.onclick = async () => {
        meld("Even geduld…");
        const r = await fetch("/api/memo/omzetten", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: a.id }),
        });
        const data = await r.json();
        if (data.fout) { meld(data.fout, "fout"); return; }
        STAND.aandacht = data.aandacht;
        $("paneel").close();
        toonAandacht();
      };
      midden.appendChild(b);
    }
    kaart.appendChild(midden);
    const af = el("button", "meer", "✓");
    af.title = "Afhandelen";
    af.onclick = async () => {
      const r = await fetch("/api/aandacht/af", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id }),
      });
      const data = await r.json();
      STAND.aandacht = data.aandacht;
      $("paneel").close();
      teken();
      toonAandacht();
    };
    kaart.appendChild(af);
    vak.appendChild(kaart);
  }
  if (STAND.spraak && !STAND.spraak.kan) {
    vak.appendChild(el("p", null, STAND.spraak.melding));
  }
  paneel("Dingen die op jou wachten", "van onderweg meegekomen", vak, []);
}

window.addEventListener("resize", () => { if (MODUS === "mac") tekenBalkknoppen(); });
start();
