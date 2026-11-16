// rk-tube: corner brand overlay, per the owner's approved design reference:
// "RK Tube" top right with "disfrutar sin anuncios" below it.
// Non-interactive (pointer-events: none) so it never interferes with remote navigation.

function mountBrand() {
    if (!document.body || !document.head) return setTimeout(mountBrand, 500);
    if (document.getElementById('rk-brand')) return;

    const style = document.createElement('style');
    style.id = 'rk-brand-style';
    style.textContent = [
        '#rk-brand{position:fixed;top:1.2vh;right:1.5vw;z-index:9999;pointer-events:none;text-align:right;line-height:1.15}',
        '#rk-brand .rk-title{color:#fff;font-size:2.2vh;font-weight:700}',
        '#rk-brand .rk-sub{color:#aaa;font-size:1.4vh}'
    ].join('\n');
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'rk-brand';

    const title = document.createElement('div');
    title.className = 'rk-title';
    title.textContent = 'RK Tube';

    const sub = document.createElement('div');
    sub.className = 'rk-sub';
    sub.textContent = 'disfrutar sin anuncios';

    el.appendChild(title);
    el.appendChild(sub);
    document.body.appendChild(el);

    // rk-tube: the brand is approved only for the main page. Default is hidden:
    // it shows only when the route is home (hash '/' or the Principal browseId
    // FEtopics, the same route signals adblock.js uses) AND the main app guide
    // (ytlr-guide-response) exists. The sign-in screen and any unknown route
    // therefore stay exactly as in TizenTube.
    function isMainPage() {
        const hash = location.hash.substring(1);
        const homeRoute = hash === '/' || hash.includes('c=FEtopics');
        const mainUiPresent = !!document.querySelector('ytlr-guide-response');
        return homeRoute && mainUiPresent;
    }
    function syncBrandVisibility() {
        el.style.display = isMainPage() ? '' : 'none';
    }
    window.addEventListener('hashchange', syncBrandVisibility);
    setInterval(syncBrandVisibility, 700);
    syncBrandVisibility();
}

mountBrand();
