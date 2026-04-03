(function () {
  if (window.__dropEverythingActive) return;
  window.__dropEverythingActive = true;

  // Load matter.js, then run
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js';
  script.onload = run;
  document.head.appendChild(script);

  function run() {
    const { Engine, World, Bodies, Body, Events, Composite, Runner } = Matter;

    const MAX_BODIES = 2000;
    const STAGGER_MS = 1;
    const DEBUG = false;

    // --- Style baking for text spans ---
    const TEXT_STYLE_PROPS = [
      'color', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle',
      'letterSpacing', 'lineHeight', 'textTransform', 'textDecoration',
      'background', 'backgroundColor', 'backgroundImage', 'backgroundClip',
      'webkitBackgroundClip', 'webkitTextFillColor',
      'textShadow',
    ];

    function bakeTextStyles(span) {
      const cs = getComputedStyle(span.parentElement || span);
      for (const prop of TEXT_STYLE_PROPS) {
        try {
          const val = cs[prop];
          if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)') {
            span.style[prop] = val;
          }
        } catch (e) {}
      }
    }

    // --- Word wrapping ---
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'CANVAS', 'TEMPLATE', 'LINK']);

    function wrapWords(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
            if (node.hasAttribute('hidden')) return NodeFilter.FILTER_REJECT;
            const cs = getComputedStyle(node);
            if (cs.display === 'none') return NodeFilter.FILTER_REJECT;
            if (cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            if (cs.overflow === 'hidden' && node.offsetHeight === 0) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim().length === 0) return NodeFilter.FILTER_SKIP;
            if (!node.parentElement) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      });

      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      const wordSpans = [];
      for (const textNode of textNodes) {
        if (wordSpans.length >= MAX_BODIES) break;
        const parent = textNode.parentNode;
        const words = textNode.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of words) {
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
          } else if (part.length > 0) {
            const span = document.createElement('span');
            span.className = '__drop-w';
            span.textContent = part;
            frag.appendChild(span);
            wordSpans.push(span);
          }
        }
        parent.replaceChild(frag, textNode);
      }
      return wordSpans;
    }

    // --- Collect block elements visible in viewport ---
    function collectBlocks() {
      const blocks = [];
      const seen = new WeakSet();
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      for (const el of document.querySelectorAll('img')) {
        if (seen.has(el)) continue;
        const src = el.currentSrc || el.src;
        if (!src) continue;
        try {
          const u = new URL(src, location.href);
          if (u.origin !== location.origin) continue;
        } catch (e) { continue; }

        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) continue;
        if (r.bottom < 0 || r.bottom > vh || r.right < 0 || r.left > vw) continue;

        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

        seen.add(el);
        blocks.push(el);
      }
      return blocks;
    }

    // --- Go! ---
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const wordSpans = wrapWords(document.body);
    const blockElements = collectBlocks();

    requestAnimationFrame(() => {
      for (const span of wordSpans) {
        bakeTextStyles(span);
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Word bodies
      const bodyData = wordSpans.map(span => {
        const r = span.getBoundingClientRect();
        return {
          type: 'text',
          element: span,
          x: r.left, y: r.top, w: r.width, h: r.height,
          bakedColor: span.style.color,
          bakedWebkitFill: span.style.webkitTextFillColor,
          bakedTextShadow: span.style.textShadow,
        };
      }).filter(d => d.w > 0 && d.h > 0
        && d.y + d.h > 0 && d.y + d.h <= vh
        && d.x + d.w > 0 && d.x < vw);

      // Block element bodies (images, inputs, buttons, etc.)
      const blockData = blockElements.map(el => {
        const r = el.getBoundingClientRect();
        return {
          type: 'block',
          element: el,
          x: r.left, y: r.top, w: r.width, h: r.height,
        };
      });

      const allData = [...bodyData, ...blockData];

      // Prepare image placeholders (but don't swap yet)
      const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const IMG_STYLE_PROPS = [
        'display', 'float', 'clear', 'verticalAlign',
        'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'border', 'borderRadius', 'boxSizing',
      ];
      for (const d of blockData) {
        const el = d.element;
        const cs = getComputedStyle(el);
        const placeholder = document.createElement('img');
        placeholder.src = TRANSPARENT_PNG;
        placeholder.className = el.className;
        for (const prop of IMG_STYLE_PROPS) {
          placeholder.style[prop] = cs[prop];
        }
        placeholder.style.width = d.w + 'px';
        placeholder.style.height = d.h + 'px';
        d.placeholder = placeholder;
      }



      // Canvas overlay
      const canvas = document.createElement('canvas');
      canvas.setAttribute('layoutsubtree', '');
      canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;border:0;padding:0;margin:0;';
      canvas.width = vw;
      canvas.height = vh;
      document.body.appendChild(canvas);

      document.body.style.overflow = 'hidden';
      window.scrollTo(scrollX, scrollY);

      const ctx = canvas.getContext('2d');

      // Create all wrappers (must be in DOM before drawElementImage works)
      const items = [];
      for (const d of allData) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `position:absolute;left:0;top:0;`;

        if (d.type === 'text') {
          const clone = d.element.cloneNode(true);
          clone.style.color = d.bakedColor;
          clone.style.webkitTextFillColor = d.bakedWebkitFill;
          clone.style.textShadow = d.bakedTextShadow;
          clone.style.background = 'transparent';
          clone.style.backgroundColor = 'transparent';
          clone.style.position = 'static';
          clone.style.margin = '0';
          clone.style.whiteSpace = 'nowrap';
          wrapper.appendChild(clone);
        } else {
          const clone = d.element.cloneNode(true);
          clone.style.position = 'static';
          clone.style.margin = '0';
          clone.style.width = d.w + 'px';
          clone.style.height = d.h + 'px';
          wrapper.appendChild(clone);
        }

        canvas.appendChild(wrapper);
        items.push({ wrapper, x: d.x, y: d.y, w: d.w, h: d.h, type: d.type, original: d.element, placeholder: d.placeholder, matterBody: null, active: false, hidden: false });
      }

      // --- Matter.js setup ---
      const engine = Engine.create({
        gravity: { x: 0, y: 1.5 },
      });

      const wallThick = 60;
      const floor = Bodies.rectangle(vw / 2, vh + wallThick / 2 - 5, vw * 2, wallThick, { isStatic: true, friction: 0.8, restitution: 0.1 });
      const wallL = Bodies.rectangle(-wallThick / 2, vh / 2, wallThick, vh * 3, { isStatic: true });
      const wallR = Bodies.rectangle(vw + wallThick / 2, vh / 2, wallThick, vh * 3, { isStatic: true });
      World.add(engine.world, [floor, wallL, wallR]);

      // Wait one frame for layoutsubtree paint, then draw all + hide originals
      requestAnimationFrame(() => {
        const canvasRect = canvas.getBoundingClientRect();
        const offsetX = canvasRect.left;
        const offsetY = canvasRect.top;

        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, vw, vh);

        // Draw all items and hide originals in one frame
        for (const item of items) {
          ctx.save();
          ctx.translate(item.x - offsetX, item.y - offsetY);
          ctx.drawElementImage(item.wrapper, 0, 0);
          ctx.restore();

          if (item.type === 'text') {
            item.original.style.color = 'transparent';
            item.original.style.webkitTextFillColor = 'transparent';
            item.original.style.textShadow = 'none';
            item.original.style.background = 'transparent';
            item.original.style.backgroundColor = 'transparent';
            item.original.style.backgroundImage = 'none';
            item.original.style.border = 'none';
            item.original.style.boxShadow = 'none';
          } else if (item.placeholder && item.original.parentNode) {
            item.original.parentNode.replaceChild(item.placeholder, item.original);
          }
          item.hidden = true;
        }
        // Activate bottom-first
        const sorted = [...items].sort((a, b) => (b.y + b.h) - (a.y + a.h));
        sorted.forEach((item, i) => {
          setTimeout(() => {
            const cx = item.x - offsetX + item.w / 2;
            const cy = item.y - offsetY + item.h / 2;
            const isImg = item.type === 'block';
            const body = Bodies.rectangle(cx, cy, item.w, item.h, {
              friction: 0.6,
              frictionStatic: 0.8,
              frictionAir: isImg ? 0.01 : 0.02,
              restitution: isImg ? 0.1 : 0.15,
              density: isImg ? 0.005 : 0.002,
            });
            Body.setVelocity(body, {
              x: (Math.random() - 0.5) * 1,
              y: 0,
            });
            item.matterBody = body;
            item.active = true;
            World.add(engine.world, body);
          }, i * STAGGER_MS);
        });

        // Window motion tracking
        let prevScreenX = window.screenX;
        let prevScreenY = window.screenY;
        let smoothGx = 0;
        let smoothGy = 0;

        // Physics + render loop
        let lastTime = performance.now();

        function tick(now) {
          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;

          // Window inertia → gravity shift
          const sx = window.screenX;
          const sy = window.screenY;
          const dx = sx - prevScreenX;
          const dy = sy - prevScreenY;
          prevScreenX = sx;
          prevScreenY = sy;

          const rawGx = -dx / Math.max(dt, 0.001) * 0.0015;
          const rawGy = -dy / Math.max(dt, 0.001) * 0.005;
          smoothGx += (rawGx - smoothGx) * 0.15;
          smoothGy += (rawGy - smoothGy) * 0.15;
          if (dx === 0 && dy === 0) { smoothGx *= 0.9; smoothGy *= 0.9; }

          engine.gravity.x = smoothGx;
          engine.gravity.y = 1.5 + smoothGy;

          Engine.update(engine, dt * 1000);

          // Draw
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, vw, vh);

          for (const item of items) {
            if (!item.active) {
              // Still in original position
              ctx.save();
              ctx.translate(item.x - offsetX, item.y - offsetY);
              ctx.drawElementImage(item.wrapper, 0, 0);
              ctx.restore();
              continue;
            }

            const pos = item.matterBody.position;
            const angle = item.matterBody.angle;

            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(angle);
            ctx.drawElementImage(item.wrapper, -item.w / 2, -item.h / 2);

            if (DEBUG) {
              ctx.strokeStyle = item.matterBody.isSleeping ? 'rgba(0,255,0,0.5)' : 'rgba(255,0,0,0.5)';
              ctx.lineWidth = 1;
              ctx.strokeRect(-item.w / 2, -item.h / 2, item.w, item.h);
            }

            ctx.restore();
          }

          requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      });
    });
  }
})();
