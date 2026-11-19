// RK Tube (copia "solo listas"): buscador interno sobre las listas de la usuaria.
//
// Lo que hace:
//  1. Arma un indice local con los videos de TODAS sus listas (publicas y
//     privadas) pidiendolos al propio cliente con browse de InnerTube, con la
//     sesion ya iniciada. No pide nada a servidores ajenos.
//  2. Envuelve KabukiInnerTubeClient.fetch: cuando el pedido es de busqueda
//     (/youtubei/v1/search), reescribe la respuesta para que los resultados
//     sean SOLO los videos del indice local que coinciden con el texto.
//     Los items se fabrican clonando el primer resultado real de YouTube y
//     cambiando id/titulo/miniatura, para que el cliente los dibuje con su
//     propia interfaz nativa (foco, control remoto, reproductor nativo).
//  3. Si el indice todavia no esta (sin sesion, sin listas, primer arranque),
//     deja pasar la respuesta original de YouTube sin tocar (nada se rompe).
//
// No toca login, bloqueo de anuncios ni reproduccion.

const STORE_KEY = 'rk-busca-local-v1';
const MAX_RESULTS = 20;
const MAX_PLAYLISTS = 60;
const MAX_VIDEOS = 5000;
const FETCH_GAP_MS = 700;
const INDEX_MAX_AGE_MS = 30 * 60 * 1000;

// ---------------- utilidades ----------------

function norm(s) {
    return (s == null ? '' : String(s))
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function deepWalk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') deepWalk(value, visit);
    }
}

function firstText(node) {
    // Devuelve el primer texto visible encontrado en un subarbol.
    let found = null;
    deepWalk(node, (n) => {
        if (found != null) return;
        if (typeof n.simpleText === 'string' && n.simpleText.trim()) found = n.simpleText;
        else if (Array.isArray(n.runs) && n.runs[0] && typeof n.runs[0].text === 'string' && n.runs[0].text.trim()) found = n.runs[0].text;
        else if (typeof n.content === 'string' && n.content.trim() && n.content.length < 300) found = found || n.content;
    });
    return found;
}

function getKabuki() {
    try {
        for (const a of Object.values(window._yttv)) {
            if (!a) continue;
            // En el cliente real el valor tiene .get y .mappings a la vez;
            // se aceptan ambas formas (y un Map directo) por robustez.
            if (typeof a.get === 'function') {
                const k = a.get('KabukiInnerTubeClient');
                if (k) return k;
            }
            if (a.mappings && typeof a.mappings.get === 'function') {
                const k = a.mappings.get('KabukiInnerTubeClient');
                if (k) return k;
            }
        }
    } catch (e) { /* abajo devuelve null */ }
    return null;
}

function browse(kabuki, browseId) {
    const request = {
        path: '/youtubei/v1/browse',
        payload: { browseId }
    };
    return new Promise((resolve) => {
        try {
            kabuki.fetch(request).subscribe((response) => resolve(response), () => resolve(null));
        } catch (e) {
            resolve(null);
        }
    });
}

// ---------------- extraccion (tolerante a la forma del JSON) ----------------

function extractPlaylists(root) {
    const out = [];
    const seen = new Set();
    deepWalk(root, (n) => {
        const ep = n.navigationEndpoint?.browseEndpoint?.browseId
            || n.browseEndpoint?.browseId
            || n.onSelectCommand?.browseEndpoint?.browseId
            || n.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
        if (typeof ep === 'string' && ep.startsWith('VL') && ep.length > 4) {
            const id = ep.slice(2);
            if (!seen.has(id)) {
                seen.add(id);
                out.push({ id, title: firstText(n) || '' });
            }
        }
        // Algunos renderers exponen playlistId directo.
        if (typeof n.playlistId === 'string' && n.playlistId.length > 4 && !seen.has(n.playlistId)) {
            seen.add(n.playlistId);
            out.push({ id: n.playlistId, title: firstText(n) || '' });
        }
    });
    return out;
}

function extractVideos(root, playlistTitle) {
    const out = [];
    const seen = new Set();
    deepWalk(root, (n) => {
        let id = null;
        if (n.tileRenderer && typeof n.tileRenderer.contentId === 'string') id = n.tileRenderer.contentId;
        else if (n.lockupViewModel && typeof n.lockupViewModel.contentId === 'string') id = n.lockupViewModel.contentId;
        else if (n.videoRenderer && typeof n.videoRenderer.videoId === 'string') id = n.videoRenderer.videoId;
        else if (n.gridVideoRenderer && typeof n.gridVideoRenderer.videoId === 'string') id = n.gridVideoRenderer.videoId;
        else if (n.playlistVideoRenderer && typeof n.playlistVideoRenderer.videoId === 'string') id = n.playlistVideoRenderer.videoId;
        else if (n.watchEndpoint && typeof n.watchEndpoint.videoId === 'string') id = n.watchEndpoint.videoId;
        if (id && /^[\w-]{11}$/.test(id) && !seen.has(id)) {
            seen.add(id);
            out.push({ id, title: firstText(n) || '', pl: playlistTitle || '' });
        }
    });
    return out;
}

// ---------------- indice local ----------------

function readStore() {
    try {
        const raw = window.localStorage[STORE_KEY];
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.videos)) return null;
        return data;
    } catch (e) {
        return null;
    }
}

function writeStore(data) {
    try {
        window.localStorage[STORE_KEY] = JSON.stringify(data);
    } catch (e) { /* sin espacio: el indice vive solo en memoria */ }
}

let memoryIndex = null;      // {ts, playlists, videos}
let indexing = false;

function indexReady() {
    if (memoryIndex) return memoryIndex;
    memoryIndex = readStore();
    return memoryIndex;
}

async function buildIndex(force) {
    if (indexing) return;
    const current = indexReady();
    if (!force && current && (Date.now() - current.ts) < INDEX_MAX_AGE_MS && current.videos.length) return;
    const kabuki = getKabuki();
    if (!kabuki) return;
    indexing = true;
    try {
        let lib = await browse(kabuki, 'FElibrary');
        let playlists = lib ? extractPlaylists(lib) : [];
        if (!playlists.length) {
            lib = await browse(kabuki, 'FEmy_youtube');
            playlists = lib ? extractPlaylists(lib) : [];
        }
        playlists = playlists.slice(0, MAX_PLAYLISTS);
        const videos = [];
        const seen = new Set();
        for (const pl of playlists) {
            if (videos.length >= MAX_VIDEOS) break;
            const resp = await browse(kabuki, 'VL' + pl.id);
            if (!resp) continue;
            for (const v of extractVideos(resp, pl.title)) {
                if (videos.length >= MAX_VIDEOS) break;
                if (seen.has(v.id)) continue;
                seen.add(v.id);
                videos.push(v);
            }
            await new Promise(r => setTimeout(r, FETCH_GAP_MS));
        }
        if (videos.length) {
            memoryIndex = { ts: Date.now(), playlists, videos };
            writeStore(memoryIndex);
        }
    } catch (e) {
        console.warn('rk-busca: error armando indice', e);
    } finally {
        indexing = false;
    }
}

// ---------------- busqueda local ----------------

function searchLocal(query) {
    const idx = indexReady();
    if (!idx || !idx.videos.length) return null; // null = sin indice: dejar pasar YouTube
    const q = norm(query);
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const v of idx.videos) {
        const title = norm(v.title);
        const pl = norm(v.pl);
        const hay = title + ' | ' + pl;
        let ok = true;
        for (const w of words) {
            if (hay.indexOf(w) === -1) { ok = false; break; }
        }
        if (!ok) continue;
        let score = 1;
        if (title.startsWith(q)) score = 4;
        else if (title.indexOf(q) !== -1) score = 3;
        else if (new RegExp('(^| )' + words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(title)) score = 2;
        scored.push({ v, score });
    }
    scored.sort((a, b) => b.score - a.score || a.v.title.localeCompare(b.v.title));
    return scored.slice(0, MAX_RESULTS).map(s => s.v);
}

// ---------------- reescritura de la respuesta de busqueda ----------------

const TEMPLATE_KEYS = ['tileRenderer', 'lockupViewModel', 'videoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer', 'compactVideoRenderer'];

function findTemplate(root) {
    let tpl = null;
    deepWalk(root, (n) => {
        if (tpl) return;
        for (const key of TEMPLATE_KEYS) {
            const item = n[key];
            if (item && typeof item === 'object') {
                const id = item.contentId || item.videoId;
                if (typeof id === 'string' && /^[\w-]{11}$/.test(id)) {
                    tpl = { key, item, id, title: firstText(item) || '' };
                    return;
                }
            }
        }
    });
    return tpl;
}

function findItemArrays(root, templateKey) {
    const arrays = [];
    deepWalk(root, (n) => {
        if (Array.isArray(n) && n.length && n[0] && typeof n[0] === 'object' && n[0][templateKey]) {
            arrays.push(n);
        }
    });
    return arrays;
}

function jsonEscapeFrag(s) {
    // s tal como aparece dentro de un string JSON (sin comillas exteriores).
    return JSON.stringify(String(s)).slice(1, -1);
}

function stamp(template, templateId, templateTitle, match) {
    let txt = JSON.stringify(template);
    txt = txt.split(templateId).join(match.id);
    if (templateTitle && match.title) {
        txt = txt.split(jsonEscapeFrag(templateTitle)).join(jsonEscapeFrag(match.title));
    }
    return JSON.parse(txt);
}

function rewriteSearchResponse(resp, query) {
    const matches = searchLocal(query);
    if (matches === null) return resp;      // sin indice: no tocar
    const tpl = findTemplate(resp);
    if (!tpl) return resp;                  // no sabemos dibujar: no tocar
    const arrays = findItemArrays(resp, tpl.key);
    if (!arrays.length) return resp;
    const stamped = matches.map(m => stamp(tpl.item, tpl.id, tpl.title, m));
    arrays[0].length = 0;
    for (const item of stamped) {
        const wrapper = {};
        wrapper[tpl.key] = item;
        arrays[0].push(wrapper);
    }
    for (let i = 1; i < arrays.length; i++) arrays[i].length = 0; // fuera secciones ajenas
    return resp;
}

// ---------------- instalacion del puente ----------------

// Dos piezas, ambas transparentes para el cliente:
//  1. Un observador sobre KabukiInnerTubeClient.fetch que SOLO registra cuando
//     hubo un pedido de busqueda (texto y momento). Devuelve SIEMPRE el
//     observable original intacto: el cliente llama .pipe/.forEach sobre el y
//     un observable sustituto romperia la pantalla de busqueda.
//  2. Una capa sobre JSON.parse (el mismo patron que ya usa customGuideAction
//     y que corre probado en la 1.0.1): si la respuesta parseada es de busqueda
//     (marcador: estimatedResults string, presente en toda respuesta de
//     /youtubei/v1/search y ausente en browse/guide) y hubo un pedido de
//     busqueda segundos atras, reescribe los resultados con las coincidencias
//     del indice local.

let lastSearchQuery = '';
let lastSearchAt = 0;
const SEARCH_WINDOW_MS = 20000;

let fetchWrapped = false;
let parseWrapped = false;

function installFetchObserver() {
    if (fetchWrapped) return;
    const kabuki = getKabuki();
    if (!kabuki || typeof kabuki.fetch !== 'function') return;
    fetchWrapped = true;
    const origFetch = kabuki.fetch.bind(kabuki);
    kabuki.fetch = function (request) {
        try {
            if (request && request.path === '/youtubei/v1/search') {
                const q = request.payload && request.payload.query;
                if (typeof q === 'string' && q.trim()) lastSearchQuery = q;
                // Las continuaciones (scroll) tambien son /search: renuevan la
                // ventana aunque no traigan query.
                lastSearchAt = Date.now();
            }
        } catch (e) { /* el observador jamas interfiere con el pedido */ }
        return origFetch(request);
    };
}

function installParseHook() {
    if (parseWrapped) return;
    parseWrapped = true;
    const prevParse = JSON.parse; // puede ser ya la capa de customGuideAction: se encadena
    JSON.parse = function () {
        const r = prevParse.apply(this, arguments);
        try {
            if (
                r && typeof r === 'object' &&
                typeof r.estimatedResults === 'string' &&
                lastSearchQuery &&
                lastSearchAt && (Date.now() - lastSearchAt) < SEARCH_WINDOW_MS
            ) {
                const index = indexReady();
                if (index && index.videos.length) {
                    return rewriteSearchResponse(r, lastSearchQuery);
                }
            }
        } catch (e) {
            console.warn('rk-busca: respuesta original conservada', e);
        }
        return r;
    };
}

let bridgeAttempts = 0;
function installSearchBridge() {
    installParseHook(); // no depende del cliente: queda desde el primer intento
    installFetchObserver();
    if (!fetchWrapped && ++bridgeAttempts < 60) {
        setTimeout(installSearchBridge, 1000);
        return;
    }
    // Indice en segundo plano: arranca unos segundos despues de cargar.
    setTimeout(() => { buildIndex(false); }, 5000);
    // Refresco si el indice guardado ya envejecio.
    const stored = readStore();
    if (stored && (Date.now() - stored.ts) > INDEX_MAX_AGE_MS) {
        setTimeout(() => { buildIndex(true); }, 15000);
    }
}

setTimeout(installSearchBridge, 1000);

export { searchLocal, rewriteSearchResponse, extractPlaylists, extractVideos, norm, stamp, findTemplate };
