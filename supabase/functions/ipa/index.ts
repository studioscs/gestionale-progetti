// =============================================================================
// SCS Gestionale Progetti - funzione «ipa»
// Dati pubblici di un ufficio di fatturazione della Pubblica Amministrazione
// =============================================================================
// Digitando il Codice Univoco Ufficio (6 caratteri) il gestionale compila da
// solo l'anagrafica dell'ente. I dati vengono dall'Indice dei domicili
// digitali della PA (IPA, AgID), open data CC-BY 4.0:
//   https://indicepa.gov.it/ipa-dati/
// Il browser non puo' interrogare l'IPA direttamente (CORS): questa funzione
// fa solo da tramite, in sola lettura, verso due tabelle fisse dell'IPA.
// Nessuna chiave, nessun segreto: e' riservata agli utenti collegati
// (verify_jwt) e accetta solo un codice di 6 lettere/cifre o una breve
// ricerca per nome.
//
// Richiesta (POST o GET):  { "codice": "UFNLEP" }  oppure  { "q": "comune di pollenza" }
// Risposta:   { "uffici": [ { codice_univoco, denominazione, ufficio, cf,
//               indirizzo, cap, comune, provincia, pec, categoria } ] }
// =============================================================================

const BASE = "https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search";
const RIS_UFFICI = "57bd2be0-4d3d-41cd-bdb8-2f0a60d6f490"; // UO che ricevono fatture elettroniche
const RIS_ENTI   = "d09adf99-dc10-4349-8c53-27b1e5aa97b6"; // Enti

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Sigla della provincia dal codice ISTAT (prime tre cifre del codice comune).
// Le citta' metropolitane hanno il codice della provincia + 200.
const PROV: Record<number, string> = {
  1:"TO",2:"VC",3:"NO",4:"CN",5:"AT",6:"AL",7:"AO",8:"IM",9:"SV",10:"GE",11:"SP",12:"VA",13:"CO",
  14:"SO",15:"MI",16:"BG",17:"BS",18:"PV",19:"CR",20:"MN",21:"BZ",22:"TN",23:"VR",24:"VI",25:"BL",
  26:"TV",27:"VE",28:"PD",29:"RO",30:"UD",31:"GO",32:"TS",33:"PC",34:"PR",35:"RE",36:"MO",37:"BO",
  38:"FE",39:"RA",40:"FC",41:"PU",42:"AN",43:"MC",44:"AP",45:"MS",46:"LU",47:"PT",48:"FI",49:"LI",
  50:"PI",51:"AR",52:"SI",53:"GR",54:"PG",55:"TR",56:"VT",57:"RI",58:"RM",59:"LT",60:"FR",61:"CE",
  62:"BN",63:"NA",64:"AV",65:"SA",66:"AQ",67:"TE",68:"PE",69:"CH",70:"CB",71:"FG",72:"BA",73:"TA",
  74:"BR",75:"LE",76:"PZ",77:"MT",78:"CS",79:"RC",80:"CZ",81:"TP",82:"PA",83:"ME",84:"AG",85:"CL",
  86:"EN",87:"CT",88:"RG",89:"SR",90:"SS",91:"NU",92:"CA",93:"PN",94:"IS",95:"OR",96:"BI",97:"LC",
  98:"LO",99:"RN",100:"PO",101:"KR",102:"VV",103:"VB",108:"MB",109:"FM",110:"BT",111:"SU",
};
function provincia(istat: string | null): string {
  const n = parseInt(String(istat || "").slice(0, 3), 10);
  if (!n) return "";
  return PROV[n] || PROV[n - 200] || "";
}

async function cerca(risorsa: string, par: Record<string, string>) {
  const u = new URL(BASE);
  u.searchParams.set("resource_id", risorsa);
  for (const [k, v] of Object.entries(par)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("IPA risponde " + r.status);
  const j = await r.json();
  return (j && j.result && j.result.records) || [];
}

// Nome del comune: ogni comune e' esso stesso un ente IPA, «c_<codice catastale>».
const cacheComuni = new Map<string, string>();
async function nomeComune(catastale: string | null): Promise<string> {
  const c = String(catastale || "").toLowerCase();
  if (!/^[a-z]\d{3}$/.test(c)) return "";
  if (cacheComuni.has(c)) return cacheComuni.get(c)!;
  const r = await cerca(RIS_ENTI, { filters: JSON.stringify({ Codice_IPA: "c_" + c }), limit: "1" });
  const nome = r[0] ? String(r[0].Denominazione_ente || "").replace(/^\s*comune\s+di\s+/i, "").trim() : "";
  cacheComuni.set(c, nome);
  return nome;
}

function pec(r: Record<string, string | null>): string {
  for (const i of [1, 2, 3]) if (String(r["Tipo_Mail" + i] || "").toLowerCase() === "pec" && r["Mail" + i]) return r["Mail" + i]!;
  return r.Mail1 || "";
}

async function ufficio(r: Record<string, string | null>) {
  const cf = r.Codice_fiscale_sfe || r.Codice_fiscale_ente || "";
  return {
    codice_univoco: r.Codice_uni_uo || "",
    denominazione: r.Denominazione_ente || "",
    ufficio: r.Descrizione_uo || "",
    cf,
    // una P.IVA ha 11 cifre: molti enti usano lo stesso numero come C.F. e P.IVA
    piva: /^\d{11}$/.test(cf) ? cf : "",
    indirizzo: r.Indirizzo || "",
    cap: r.CAP || "",
    comune: await nomeComune(r.Codice_catastale_comune),
    provincia: provincia(r.Codice_comune_ISTAT),
    pec: pec(r),
    categoria: r.Nome_Categoria || "",
  };
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { codice?: string; q?: string } = {};
  if (req.method === "GET") {
    const u = new URL(req.url);
    body = { codice: u.searchParams.get("codice") || "", q: u.searchParams.get("q") || "" };
  } else if (req.method === "POST") {
    try { body = await req.json(); } catch { return json({ error: "richiesta non valida" }, 400); }
  } else return json({ error: "metodo non ammesso" }, 405);

  try {
    const codice = String(body.codice || "").toUpperCase().trim();
    if (codice) {
      if (!/^[A-Z0-9]{6}$/.test(codice)) return json({ error: "Il codice ufficio ha 6 caratteri, lettere e cifre" }, 400);
      const r = await cerca(RIS_UFFICI, { filters: JSON.stringify({ Codice_uni_uo: codice }), limit: "1" });
      return json({ uffici: r.length ? [await ufficio(r[0])] : [] });
    }
    const q = String(body.q || "").replace(/[^\p{L}\p{N} '.-]/gu, " ").replace(/\s+/g, " ").trim();
    if (q.length < 3 || q.length > 80) return json({ error: "Scrivi da 3 a 80 caratteri" }, 400);
    const r = await cerca(RIS_UFFICI, { q, limit: "10" });
    return json({ uffici: await Promise.all(r.map(ufficio)) });
  } catch (e) {
    return json({ error: "IPA non raggiungibile: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }
});
