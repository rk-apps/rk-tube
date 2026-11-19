// RK Tube (copia "solo listas"): la pagina principal muestra UNICAMENTE la
// grilla de playlists.
//
// La app arranca en Biblioteca (launchToOnStartup -> FElibrary), pero esa
// pagina trae mas filas (historial, etc.). Esta capa sobre JSON.parse - el
// mismo patron probado de customGuideAction - conserva solo las secciones
// cuyos items son playlists (items que navegan a browseId "VL...") y quita
// las demas.
//
// Fallback seguro: si la respuesta no tiene ninguna seccion de playlists
// (pagina de una lista, portada, canal, o un cambio de estructura de
// YouTube), no se toca nada.

function deepWalkLocal(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') deepWalkLocal(value, visit);
    }
}

function hasPlaylistTarget(item) {
    let found = false;
    deepWalkLocal(item, (n) => {
        if (found) return;
        const id = n.browseEndpoint && n.browseEndpoint.browseId;
        if (typeof id === 'string' && id.startsWith('VL') && id.length > 4) found = true;
    });
    return found;
}

function itemsArrayOf(section) {
    // horizontalListRenderer / verticalListRenderer / gridRenderer exponen .items
    let items = null;
    deepWalkLocal(section, (n) => {
        if (items) return;
        if ((n.horizontalListRenderer && Array.isArray(n.horizontalListRenderer.items)) ) items = n.horizontalListRenderer.items;
        else if (n.verticalListRenderer && Array.isArray(n.verticalListRenderer.items)) items = n.verticalListRenderer.items;
        else if (n.gridRenderer && Array.isArray(n.gridRenderer.items)) items = n.gridRenderer.items;
    });
    return items;
}

function filterLibraryResponse(r) {
    const sections = r && r.contents && r.contents.sectionListRenderer && r.contents.sectionListRenderer.contents;
    if (!Array.isArray(sections) || !sections.length) return r;
    const kept = [];
    let playlistSections = 0;
    for (const section of sections) {
        const items = itemsArrayOf(section);
        if (!items || !items.length) {
            kept.push(section); // encabezados u otras piezas sin items
            continue;
        }
        if (items.some(hasPlaylistTarget)) {
            playlistSections++;
            kept.push(section);
        }
        // seccion con items que no son playlists: se omite
    }
    if (!playlistSections) return r; // no es una pagina con grilla de listas: intacta
    r.contents.sectionListRenderer.contents = kept;
    return r;
}

const prevParseGrid = JSON.parse; // puede ser ya una capa previa: se encadena
JSON.parse = function () {
    const r = prevParseGrid.apply(this, arguments);
    try {
        return filterLibraryResponse(r);
    } catch (e) {
        console.warn('rk-listas: respuesta original conservada', e);
        return r;
    }
};

export { filterLibraryResponse, hasPlaylistTarget, itemsArrayOf };
