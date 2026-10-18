(function () {
  'use strict';
  if (window.kinogo_online_plugin) return;
  window.kinogo_online_plugin = true;

  var PROXY = '';
  var PROXY_KEY = '';
  var KINOGO = 'https://kinogo.luxury';
  var NEXTEMBED = 'https://api.nextembed.ws';
  var BAL_KEY = 'kinogo_balanser_v2';

  var BALANSERS = [
    { name: 'nextembed', title: 'Kinogo · Плеер 1' },
    { name: 'cinemar',   title: 'Kinogo · Смотреть онлайн' },
    { name: 'vidi',      title: 'Kinogo · Плеер 3' }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function startPlugin() {
    Lampa.Lang.add({
      kinogo_title: { ru: 'Kinogo', en: 'Kinogo' },
      kinogo_desc:  { ru: 'Фильмы и сериалы с kinogo.luxury', en: 'Movies from kinogo.luxury' },
      kinogo_nolink:{ ru: 'Kinogo: не удалось получить видео', en: 'Kinogo: no video' },
      kinogo_noid:  { ru: 'Kinogo: не смог построить адрес плеера (нет ID Кинопоиска и IMDb, страница kinogo недоступна из этой среды)', en: 'Kinogo: no player url' },
      kinogo_switch:{ ru: 'Kinogo: открываю запасной плеер', en: 'Kinogo: fallback' }
    });

    Lampa.Template.add('kinogo_css',
      "<style>" +
      ".kinogo-row{position:relative;display:flex;padding:.8em 1em;background:rgba(0,0,0,.3);border-radius:.4em;margin-bottom:1em}" +
      ".kinogo-row__num{width:2.4em;font-size:1.7em;opacity:.55;text-align:center;flex-shrink:0}" +
      ".kinogo-row__body{flex:1;min-width:0}" +
      ".kinogo-row__title{font-size:1.35em;overflow:hidden;text-overflow:ellipsis}" +
      ".kinogo-row__info{opacity:.7;margin-top:.3em;font-size:1em;overflow:hidden;text-overflow:ellipsis}" +
      ".kinogo-row__viewed{position:absolute;top:.6em;left:.6em;background:rgba(0,0,0,.5);border-radius:50%;padding:.25em;font-size:.8em}" +
      ".kinogo-row.focus{outline:.25em solid #fff}" +
      ".kinogo-frame-wrap{position:absolute;top:0;left:0;right:0;bottom:0;background:#000}" +
      ".kinogo-frame-bar{display:flex;gap:.6em;padding:.6em;background:rgba(0,0,0,.85)}" +
      ".kinogo-frame-btn{padding:.4em 1em;background:rgba(255,255,255,.12);border-radius:.4em}" +
      ".kinogo-frame-btn.focus{background:#fff;color:#000}" +
      ".kinogo-frame-box{position:absolute;top:3.4em;left:0;right:0;bottom:0}" +
      ".kinogo-frame{width:100%;height:100%;border:0}" +
      ".kinogo-empty{padding:2em;font-size:1.3em;opacity:.9}" +
      ".kinogo-empty__buttons{display:flex;margin-top:1.2em}" +
      ".kinogo-empty__button{background:rgba(0,0,0,.4);font-size:1em;padding:.6em 1.4em;border-radius:.4em;margin-right:1em}" +
      ".kinogo-empty__button.focus{background:#fff;color:#000}" +
      ".kinogo-trace{margin-top:1.4em;font-size:.7em;opacity:.55;line-height:1.6;word-break:break-all}" +
      "</style>");
    $('body').append(Lampa.Template.get('kinogo_css', {}, true));

    Lampa.Template.add('kinogo_item',
      "<div class='kinogo-row selector'>" +
        "<div class='kinogo-row__num'>{num}</div>" +
        "<div class='kinogo-row__body'>" +
          "<div class='kinogo-row__title'>{title}</div>" +
          "<div class='kinogo-row__timeline'></div>" +
          "<div class='kinogo-row__info'>{info}</div>" +
        "</div>" +
      "</div>");

    function Component(object) {
      var self = this, destroyed = false, initialized = false, last = false;
      var scroll = new Lampa.Scroll({ mask: true, over: true });
      var files  = new Lampa.Explorer(object);
      var filter = new Lampa.Filter(object);
      var providers = {}, config = null, filterData = {};
      var trace = [], statusEl = null;
      var balanser = Lampa.Storage.get(BAL_KEY, 'nextembed');
      var choice = getChoice();

      function getChoice() {
        var all = Lampa.Storage.cache('kinogo_choice', 3000, {});
        var save = all[object.movie.id] || {};
        if (typeof save.season !== 'number') save.season = 0;
        return save;
      }
      function saveChoice() {
        var all = Lampa.Storage.cache('kinogo_choice', 3000, {});
        all[object.movie.id] = choice;
        Lampa.Storage.set('kinogo_choice', all);
      }
      function log(msg) {
        trace.push(msg);
        try { console.log('[kinogo] ' + msg); } catch (e) {}
        if (statusEl) statusEl.text('Kinogo: ' + msg);
      }
      function status(text) {
        if (destroyed) return;
        if (!statusEl) {
          scroll.clear();
          statusEl = $('<div class="kinogo-empty"></div>');
          scroll.append(statusEl);
        }
        statusEl.text(text);
      }
      function showFail(msg) {
        var lines = trace.slice(-8);
        self.empty(esc(msg) + '<div class="kinogo-trace">' + lines.map(esc).join('<br>') + '</div>');
      }
      function safely(fn, arg) {
        try { fn(arg); }
        catch (e) { log('исключение: ' + (e && (e.message || e))); showFail(Lampa.Lang.translate('kinogo_nolink')); }
      }
      function proxyBase() {
        var p = '';
        try { p = Lampa.Storage.get('kinogo_proxy', '') || PROXY || ''; } catch (e) { p = PROXY || ''; }
        p = String(p).replace(/\s+/g, '');
        return p ? p.replace(/\/+$/, '') + '/' : '';
      }
      function snippet(s) {
        return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      }
      function getText(url, check, ok, fail, ref) {
        var steps = [], px = proxyBase();
        var host = url.replace(/^https?:\/\/([^\/]+).*$/, '$1');
        if (px) steps.push({
          name: 'воркер',
          url: px + '?url=' + encodeURIComponent(url) +
               (ref ? '&ref=' + encodeURIComponent(ref) : '') +
               (PROXY_KEY ? '&key=' + encodeURIComponent(PROXY_KEY) : '')
        });
        steps.push({ name: 'напрямую', url: url });
        function step(i) {
          if (destroyed) return;
          if (i >= steps.length) { safely(function () { fail(); }); return; }
          var st = steps[i], finished = false, timer, net;
          function next(reason) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            log(host + ' · ' + st.name + ': ' + reason);
            step(i + 1);
          }
          timer = setTimeout(function () {
            try { if (net && net.clear) net.clear(); } catch (e) {}
            next('нет ответа за 10 с');
          }, 10000);
          try {
            net = new Lampa.Reguest();
            net.timeout(8000);
            net['native'](st.url, function (str) {
              if (finished) return;
              str = (str === undefined || str === null) ? '' : (typeof str === 'string' ? str : JSON.stringify(str));
              if (check(str)) {
                finished = true;
                clearTimeout(timer);
                log(host + ' · ' + st.name + ': ok (' + str.length + ' симв.)');
                safely(ok, str);
              } else {
                next('ответ не похож на нужный: «' + snippet(str) + '»');
              }
            }, function (er) {
              next('ошибка ' + ((er && er.status) || 0));
            }, false, { dataType: 'text' });
          } catch (e) {
            if (finished) throw e;
            next('исключение ' + (e && e.message));
          }
        }
        step(0);
      }

      function loadProviders(cb) {
        if (providers[0] || providers[1]) return cb();
        function fromPage(html) {
          var re = /<li data-provider="(\d)" data-src="([^"]+)"/g, m;
          while ((m = re.exec(html))) providers[m[1]] = m[2].replace(/&amp;/g, '&');
          if (!providers[0] && !providers[1] && !providers[2]) log('kinogo: на странице фильма не найдены плееры');
          cb();
        }
        var title = object.movie.title || object.movie.name || '';
        status('Kinogo: ищу «' + title + '»…');
        getText(KINOGO + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(title),
          function (h) { return /href="\/\d+[^"]*?\.html"/.test(h) || /href="https:\/\/kinogo\.luxury\/\d+[^"]*?\.html"/.test(h); },
          function (html) {
            var cut = html.split("id='dle-content'")[1] || html;
            var m = cut.match(/href="\/(\d+[^"]*?\.html)"/) || cut.match(/href="https:\/\/kinogo\.luxury\/(\d+[^"]*?\.html)"/);
            if (!m) { log('kinogo: в результатах поиска нет ссылки'); return cb(); }
            getText(KINOGO + '/' + m[1],
              function (h) { return /<li data-provider="\d" data-src="/.test(h); },
              fromPage, cb, KINOGO + '/');
          }, cb, KINOGO + '/');
      }

      function extractConfig(code) {
        var i = code.indexOf('makePlayer(');
        if (i >= 0) {
          var s = code.indexOf('{', i);
          if (s >= 0) {
            var depth = 0, inStr = false, q = '', ex = false, e = -1, k, c;
            for (k = s; k < code.length; k++) {
              c = code.charAt(k);
              if (inStr) { if (ex) ex = false; else if (c === '\\') ex = true; else if (c === q) inStr = false; }
              else if (c === '"' || c === "'") { inStr = true; q = c; }
              else if (c === '{') depth++;
              else if (c === '}') { depth--; if (depth === 0) { e = k; break; } }
            }
            if (e > 0) { try { return JSON.parse(code.slice(s, e + 1)); } catch (err) {} }
          }
        }
        var opts = null;
        var shadow = ['window', 'document', 'Lampa', '$', 'jQuery', 'localStorage', 'sessionStorage',
          'fetch', 'XMLHttpRequest', 'top', 'parent', 'self', 'globalThis', 'navigator', 'location'];
        try {
          var fn = Function.apply(null, shadow.concat(['makePlayer', 'adsConfig', '"use strict";\n' + code]));
          fn.apply(undefined, shadow.map(function () { return undefined; })
            .concat([function (o) { opts = o; }, {}]));
        } catch (err2) {
          log('nextembed: скрипт конфига не выполнился: ' + (err2 && err2.message));
          return null;
        }
        return opts;
      }
      function parseNextembed(html) {
        var m = html.match(/<script data-name="mk">([\s\S]*?)<\/script>/);
        if (!m) { log('nextembed: нет блока data-name="mk"'); return null; }
        var opts = extractConfig(m[1]);
        if (!opts || !opts.source) { log('nextembed: в конфиге нет source'); return null; }
        opts._key = (html.match(/var lok\s*=\s*1\s*,\s*[a-f0-9]{8,}\s*=\s*"([a-f0-9]{6,12})"/) || [])[1] || '';
        if (!opts._key) log('nextembed: ключ lok не найден — ссылка может не открыться');
        return opts;
      }
      function withKey(u, key) { return (u && key) ? u + (u.indexOf('?') >= 0 ? '&' : '?') + key : u; }
      function srcUrl(src, key) { return withKey(src && (src.hls || src.dasha), key); }
      function mapCC(cc) { return (cc || []).map(function (s) { return { label: s.name, url: s.url }; }); }

      // ===== ГЛАВНОЕ ИЗМЕНЕНИЕ 1.4: мосты Кинопоиск-ID → IMDb-код → страница kinogo =====
      function nextembedUrl(cb) {
        if (object.movie.kinopoisk_id) return cb(NEXTEMBED + '/embed/kp/' + object.movie.kinopoisk_id, 'kp');
        if (object.movie.imdb_id)      return cb(NEXTEMBED + '/embed/imdb/' + object.movie.imdb_id, 'imdb');
        loadProviders(function () {
          if (providers[1]) cb(providers[1], 'kinogo');
          else cb('', 'none');
        });
      }
      function loadNextembed(cb) {
        if (config) return cb(config);
        nextembedUrl(function (url, via) {
          if (!url) return cb(null);
          log('nextembed: адрес через ' + via + ': ' + url.slice(0, 60));
          getText(url, function (h) { return /<script data-name="mk">/.test(h); },
            function (html) { cb(parseNextembed(html), url); },
            function () { cb(null, url); }, KINOGO + '/');
        });
      }

      this.loading = function (state) {
        if (state) this.activity.loader(true);
        else { this.activity.loader(false); this.activity.toggle(); }
      };
      this.reset = function () { statusEl = null; scroll.clear(); scroll.render().find('.kinogo-empty').remove(); };
      this.empty = function (html) {
        this.loading(false);
        statusEl = null;
        setFilter();
        scroll.clear();
        scroll.append($('<div class="kinogo-empty">' + html + '</div>'));
        Lampa.Controller.enable('content');
      };

      this.initialize = function () {
        scroll.body().addClass('torrent-list');
        files.appendFiles(scroll.render());
        files.appendHead(filter.render());
        scroll.minus(files.render().find('.explorer__files-head'));
        if (filter.addButtonBack) filter.addButtonBack();
        filter.onBack = function () { self.start(); };
        filter.onSelect = function (type, a, b) {
          if (type == 'sort') {
            balanser = a.source;
            Lampa.Storage.set(BAL_KEY, balanser);
            Lampa.Select.close();
            Lampa.Activity.replace();
          } else if (type == 'filter') {
            if (a.reset) { choice.season = 0; saveChoice(); Lampa.Select.close(); Lampa.Activity.replace(); return; }
            if (a.stype == 'season') { choice.season = b.index; saveChoice(); Lampa.Select.close(); self.reset(); self.loading(true); build(); }
          }
        };
        setFilter();
        this.loading(true);
        if (balanser !== 'nextembed') startIframe();
        else build();
      };

      function build() {
        status('Kinogo: подбираю плеер…');
        loadNextembed(function (cfg, url) {
          if (destroyed) return;
          config = cfg;
          if (config && srcUrl(config.source, config._key)) { buildNative(); return; }
          // конфиг не скачать (CORS/защита) → ОТКРЫВАЕМ ОКНО с тем же адресом: окну запреты не мешают
          if (url) { startIframe(url); return; }
          // адреса нет вообще → пробуем запасные окна через страницу kinogo
          loadProviders(function () {
            if (providers[0]) {
              Lampa.Noty.show(Lampa.Lang.translate('kinogo_switch'));
              balanser = 'cinemar';
              startIframe();
            } else {
              showFail(Lampa.Lang.translate('kinogo_noid'));
            }
          });
        });
      }

      function buildNative() {
        var items = [];
        var seasons = config.playlist && config.playlist.seasons;
        if (seasons && seasons.length) {
          var si = Math.min(choice.season, seasons.length - 1);
          choice.season = si;
          filterData.season = seasons.map(function (s, i) { return s.title || ('Сезон ' + (i + 1)); });
          (seasons[si].episodes || []).forEach(function (ep, idx) {
            items.push({
              season: si + 1, episode: idx + 1,
              title: ep.title || ('Серия ' + (idx + 1)),
              url: srcUrl(ep, config._key) || srcUrl(config.source, config._key),
              subtitles: mapCC(ep.cc || config.source.cc),
              voices: (ep.audio && ep.audio.names) || (config.source.audio && config.source.audio.names) || []
            });
          });
        } else {
          items.push({
            title: object.movie.title || object.movie.name || 'Фильм',
            url: srcUrl(config.source, config._key),
            subtitles: mapCC(config.source.cc),
            voices: (config.source.audio && config.source.audio.names) || []
          });
        }
        log('список готов: ' + items.length + ' пункт(ов)');
        draw(items);
      }

      function mark(hash) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        if (viewed.indexOf(hash) == -1) { viewed.push(hash); Lampa.Storage.set('online_view', viewed); }
      }

      function draw(items) {
        if (destroyed) return;
        self.loading(false);
        statusEl = null;
        scroll.clear();
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        items.forEach(function (el) {
          el.hash = Lampa.Utils.hash([el.season || '', (el.season > 10 ? ':' : ''), el.episode || '',
            object.movie.original_title || object.movie.title || ''].join(''));
          el.timeline = Lampa.Timeline.view(el.hash);
        });
        var playlist = items.map(function (el) {
          return {
            title: el.title, url: el.url, subtitles: el.subtitles, isonline: true,
            season: el.season, episode: el.episode,
            voice_name: el.voices && el.voices[0] ? el.voices[0] : '',
            timeline: el.timeline,
            callback: function () { mark(el.hash); }
          };
        });
        items.forEach(function (el, i) {
          var num = el.episode ? ((el.episode < 10 ? '0' : '') + el.episode) : '';
          var info = el.voices.length ? el.voices.slice(0, 3).join(', ') + (el.voices.length > 3 ? '…' : '') : '';
          var html = Lampa.Template.get('kinogo_item', { num: num, title: el.title, info: info });
          html.find('.kinogo-row__timeline').append(Lampa.Timeline.render(el.timeline));
          if (viewed.indexOf(el.hash) !== -1) html.find('.kinogo-row__num').append('<div class="kinogo-row__viewed">✓</div>');
          html.on('hover:enter', function () {
            mark(el.hash);
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            Lampa.Player.play(playlist[i]);
            if (playlist.length > 1) Lampa.Player.playlist(playlist);
          }).on('hover:focus', function (e) {
            last = e.target;
            scroll.update($(e.target), true);
          });
          scroll.append(html);
        });
        setFilter();
        Lampa.Controller.enable('content');
      }

      function setFilter() {
        var select = [{ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true }];
        if (filterData.season) {
          select.push({
            title: Lampa.Lang.translate('torrent_serial_season'), stype: 'season',
            items: filterData.season.map(function (t, i) { return { title: t, index: i, selected: i == choice.season }; })
          });
        }
        filter.set('filter', select);
        filter.set('sort', BALANSERS.map(function (b) {
          return { title: b.title, source: b.name, selected: b.name == balanser };
        }));
        var chosen = [];
        if (filterData.season) chosen.push(Lampa.Lang.translate('torrent_serial_season') + ': ' + filterData.season[choice.season]);
        filter.chosen('filter', chosen);
        var cur = BALANSERS.filter(function (b) { return b.name == balanser; })[0];
        filter.chosen('sort', [cur ? cur.title : balanser]);
      }

      function startIframe(url) {
        function open(srcUrlValue) {
          if (destroyed) return;
          log('открываю окно плеера: ' + srcUrlValue.slice(0, 60));
          self.loading(false);
          statusEl = null;
          scroll.clear();
          var wrap = $('<div class="kinogo-frame-wrap"></div>');
          var bar  = $('<div class="kinogo-frame-bar"></div>');
          var back = $('<div class="kinogo-frame-btn selector">← ' + Lampa.Lang.translate('back') + '</div>');
          back.on('hover:enter', function () { Lampa.Activity.backward(); });
          var src = $('<div class="kinogo-frame-btn selector">' + Lampa.Lang.translate('settings_rest_source') + '</div>');
          src.on('hover:enter', function () {
            var order = ['nextembed', 'cinemar', 'vidi'];
            balanser = order[(order.indexOf(balanser) + 1) % order.length];
            Lampa.Storage.set(BAL_KEY, balanser);
            Lampa.Activity.replace();
          });
          bar.append(back).append(src);
          var box = $('<div class="kinogo-frame-box"></div>');
          box.append($('<iframe class="kinogo-frame" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>').attr('src', srcUrlValue));
          wrap.append(bar).append(box);
          scroll.append(wrap);
          setFilter();
          Lampa.Controller.enable('content');
        }
        if (url) return open(url);
        loadProviders(function () {
          var idx = balanser == 'vidi' ? 2 : 0;
          if (providers[idx]) open(providers[idx]);
          else showFail(Lampa.Lang.translate('kinogo_nolink'));
        });
      }

      this.create = function () { return this.render(); };
      this.render = function () { return files.render(); };
      this.start = function () {
        if (Lampa.Activity.active().activity !== this.activity) return;
        if (!initialized) {
          initialized = true;
          try { this.initialize(); }
          catch (e) { log('исключение: ' + (e && (e.message || e))); showFail('Kinogo: ошибка в плагине'); }
        }
        Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
        Lampa.Controller.add('content', {
          toggle: function () {
            Lampa.Controller.collectionSet(scroll.render(), files.render());
            Lampa.Controller.collectionFocus(last || false, scroll.render());
          },
          up:    function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
          down:  function () { Navigator.move('down'); },
          right: function () { if (Navigator.canmove('right')) Navigator.move('right'); else filter.show(Lampa.Lang.translate('title_filter'), 'filter'); },
          left:  function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
          back:  function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('content');
      };
      this.pause = function () {};
      this.stop = function () {};
      this.destroy = function () {
        destroyed = true;
        files.destroy();
        scroll.destroy();
      };
    }

    Lampa.Component.add('kinogo_online', Component);

    Lampa.Manifest.plugins = {
      type: 'video',
      name: 'Kinogo',
      description: Lampa.Lang.translate('kinogo_desc'),
      component: 'kinogo_online',
      onContextMenu: function () { return { name: Lampa.Lang.translate('kinogo_title'), description: '' }; },
      onContextLauch: function (object) {
        Lampa.Activity.push({ title: Lampa.Lang.translate('kinogo_title'), component: 'kinogo_online', movie: object });
      }
    };

    var button = "<div class='full-start__button selector view--kinogo kinogo--button'><span>#{kinogo_title}</span></div>";
    function addButton(e) {
      if (!e.render || !e.render.length || e.render.find('.kinogo--button').length) return;
      var btn = $(Lampa.Lang.translate(button));
      btn.on('hover:enter', function () {
        Lampa.Activity.push({ title: Lampa.Lang.translate('kinogo_title'), component: 'kinogo_online', movie: e.movie });
      });
      e.render.after(btn);
    }
    Lampa.Listener.follow('full', function (e) {
      if (e.type == 'complite') {
        addButton({ render: e.object.activity.render().find('.view--torrent'), movie: e.data.movie });
      }
    });
    try {
      if (Lampa.Activity.active().component == 'full')
        addButton({ render: Lampa.Activity.active().activity.render().find('.view--torrent'), movie: Lampa.Activity.active().card });
    } catch (e) {}
  }

  if (window.appready) startPlugin();
  else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') startPlugin(); });
})();
