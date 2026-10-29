(() => {
  try {
    const config = __GLOSSA_CONFIG__;
    if (window.top !== window || !document.documentElement || !document.body) return {};
    const toolbarId = '__glossa_capture_toolbar__';
    let toolbar = document.getElementById(toolbarId);
    if (config.interactive && !toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = toolbarId;
      toolbar.setAttribute('role', 'region');
      toolbar.setAttribute('aria-label', config.captureLabel);
      toolbar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid currentColor;font:14px system-ui;';
      toolbar.style.background = config.background;
      toolbar.style.color = config.foreground;
      const hint = document.createElement('span');
      hint.textContent = config.hint;
      hint.style.flex = '1 1 220px';
      toolbar.append(hint);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = config.cancelLabel;
      cancel.onclick = () => {
        toolbar.dataset.cancelled = 'true';
      };
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = config.captureLabel;
      // Retain the source selection when pointer focus moves to the toolbar.
      save.onpointerdown = save.onmousedown = (event) => event.preventDefault();
      save.onclick = () => {
        const selection = window.getSelection();
        if (
          selection &&
          selection.rangeCount &&
          selection.toString().trim() &&
          !toolbar.contains(selection.anchorNode)
        ) {
          const container = document.createElement('article');
          container.append(selection.getRangeAt(0).cloneContents());
          toolbar.__glossaSelection = container.outerHTML;
        }
        toolbar.dataset.capture = 'true';
      };
      for (const button of [cancel, save]) {
        button.style.cssText =
          'font:inherit;min-height:44px;min-width:64px;padding:8px 14px;border:1px solid currentColor;border-radius:6px;cursor:pointer;background:transparent;color:inherit;';
        toolbar.append(button);
      }
      document.documentElement.append(toolbar);
    }
    if (toolbar && toolbar.dataset.cancelled === 'true') return { cancelled: true };
    const finalUrl = location.href;
    const baseUrl = document.baseURI || finalUrl;
    if (config.capture || (toolbar && toolbar.dataset.capture === 'true')) {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelector('#' + toolbarId)?.remove();
      clone.querySelector('#__readest_overlay__')?.remove();
      const selection = !!toolbar?.__glossaSelection;
      if (selection) clone.querySelector('body').innerHTML = toolbar.__glossaSelection;
      const html = '<!DOCTYPE html>' + clone.outerHTML;
      if (html.length > config.maxChars) return { error: 'Page is too large to capture' };
      return { html, finalUrl, baseUrl, selection };
    }
    const candidates = [
      ...document.querySelectorAll(
        'article,main,[role="main"],[itemprop="articleBody"],#js_content,.post-content,.entry-content,.markdown-body',
      ),
    ];
    let content = document.body;
    let bestLength = 0;
    for (const candidate of candidates) {
      const length = (candidate.innerText || candidate.textContent || '').trim().length;
      if (length > bestLength) {
        content = candidate;
        bestLength = length;
      }
    }
    const text = (content.innerText || content.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > config.maxChars) return { error: 'Page is too large to capture' };
    const images = [...content.querySelectorAll('img[src],img[data-src],picture')];
    const pending = images.filter((image) => image.tagName === 'IMG' && !image.complete).length;
    // Detect changes throughout the article, including edits of identical length.
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++)
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    const signature =
      text || images.length
        ? finalUrl + ':' + text.length + ':' + hash + ':' + images.length + ':' + pending
        : '';
    return { signature, loaded: document.readyState !== 'loading' };
  } catch (_) {
    return { error: 'Could not capture page content' };
  }
})();
