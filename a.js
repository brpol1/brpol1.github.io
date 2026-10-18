(function () {
  'use strict';
  if (window.kinogo_online_plugin) return;          // защита от двойного запуска (docs §4)
  window.kinogo_online_plugin = true;

  var BALANSERS = [
    { name: 'nextembed', title: 'Kinogo · Плеер 1 (без рекламы)' },
    { name: 'cinemar',   title: 'Kinogo · Смотреть онлайн' },
    { name: 'vidi',      title: 'Kinogo · Плеер 3' }
  ];
  var KINOGO = 'https://kinogo.luxury';

  function startPlugin() {
    Lampa.Lang.add({
      kinogo_title: { ru: 'Kinogo', en: 'Kinogo' },
      kinogo_desc:  { ru: 'Фильмы и сериалы с kinogo.luxury', en: 'Movies from kinogo.luxury' },
      kinogo_nolink:{ ru: 'Kinogo: не удалось получить видео', en: 'Kinogo: no video' },
      kinogo_switch:{ ru: 'Kinogo: Плеер 1 не ответил, включаю резервный', en: 'Kinogo: fallback' }
    });

    Lampa.Template.add('kinogo_css',
      "<style>" +
      ".kinogo-row{display:flex;padding:.8em 1em;background:rgba(0,0,0,.3);border-radius:.4em;margin-bottom:1em}" +
      ".kinogo-row__num{width:2.4em;font-size:1.7em;opacity:.55;text-align:center;flex-shrink:0}" +
      ".kinogo-row__body{flex:1;min-width:0}" +
      ".kinogo-row__title{font-size:1.35em;overflow:hidden;text-overflow:ellipsis}" +
      ".kinogo-row__info{opacity:.7;margin-top:.3em;font-size:1em;overflow:hidden;text-overflow:ellipsis}" +
      ".kinogo-row__viewed{position:absolute;top:.6em;left:.6em;background:rgba(0,0,0,.5);border-radius:50%;padding:.25em;font-size:.8em}" +
      ".kinogo-row{position:relative}" +
      ".kinogo-row.focus{outline:.25em solid #fff}" +
      ".kinogo-frame-wrap{position:absolute;top:0;left:0;right:0;bottom:0;background:#000}" +
      ".kinogo-frame-bar{display:flex;gap:.6em;padding:.6em;background:rgba(0,0,0,.85)}" +
      ".kinogo-frame-btn{padding:.4em 1em;background:rgba(255,255,255,.12);border-radius:.4em}" +
      ".kinogo-frame-btn.focus{background:#fff;color:#000}" +
      ".kinogo-frame-box{position:absolute;top:3.4em;left:0;right:0;bottom:0}" +
      ".kinogo-frame{width:100%;height:100%;border:0}" +
      ".kinogo-empty{padding:2em;font-size:1.3em;opacity:.8}" +
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

    // ================= компонент-экран (docs §8, §9) =================
    function Component(object) {
      var self = this, destroyed = false, initialized = false, last = false;
      var scroll = new Lampa.Scroll({ mask: true, over: true });
      var files  = new Lampa.Explorer(object);
      var filter = new Lampa.Filter(object);
      var providers = {}, config = null, filterData = {}, iframeMode = false;
      var balanser = Lampa.Storage.get('kinogo_balanser', 'nextembed');
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

      // --- сеть: native → прокси 1 → прокси 2 (docs §10.1)
      function getText(url, ok, fail) {
        var chain = [url,
          'https://corsproxy.io/?url=' + encodeURIComponent(url),
          'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)];
        function step(i) {
          if (destroyed) return;
          if (i >= chain.length) { if (fail) fail(); return; }
          var net = new Lampa.Reguest();
          net.timeout(12000);
          net['native'](chain[i], function (str) {
            if (str && String(str).length > 100) ok(String(str));
            else step(i + 1);
          }, function () { step(i + 1); }, false, { dataType: 'text' });
        }
        step(0);
      }

      // --- страница kinogo → адреса трёх плееров (ul.video-tabs)
      function loadProviders(cb) {
        if (providers[0] || providers[1]) return cb();
        function fromPage(html) {
          var re = /<li data-provider="(\d)" data-src="([^"]+)"/g, m;
          while ((m = re.exec(html))) providers[m[1]] = m[2].replace(/&amp;/g, '&');
          cb();
        }
        var title = object.movie.title || object.movie.name || '';
        getText(KINOGO + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(title),
          function (html) {
            var m = html.match(/href="(https:\/\/kinogo\.luxury\/\d+[^"]*?\.html)"/);
            if (!m) return cb();
            getText(m[1], fromPage, cb);
          }, cb);
      }

      // --- конфиг VenomPlayer со страницы nextembed (script data-name="mk")
      function parseNextembed(html) {
        var m = html.match(/<script data-name="mk">([\s\S]*?)<\/script>/);
        if (!m) return null;
        var opts = null;
        try {
          new Function('makePlayer', 'adsConfig', m[1])(function (o) { opts = o; }, {});
        } catch (e) { return null; }
        if (!opts || !opts.source) return null;
        opts._key = (html.match(/var lok\s*=\s*1\s*,\s*[a-f0-9]{8,}\s*=\s*"([a-f0-9]{6,12})"/) || [])[1] || '';
        return opts;
      }
      function withKey(u, key) { return u ? u + (u.indexOf('?') >= 0 ? '&' : '?') + key : u; }
      function srcUrl(src, key) { return withKey(src && (src.hls || src.dasha), key); }
      function mapCC(cc) {
        return (cc || []).map(function (s) { return { label: s.name, url: s.url }; });
      }
      function loadNextembed(cb) {
        if (config) return cb(config);
        function go(url) { getText(url, function (html) { cb(parseNextembed(html)); }, function () { cb(null); }); }
        if (providers[1]) return go(providers[1]);
        if (object.movie.kinopoisk_id) return go('https://api.nextembed.ws/embed/kp/' + object.movie.kinopoisk_id);
        loadProviders(function () { providers[1] ? go(providers[1]) : cb(null); });
      }

      this.loading = function (status) {
        if (status) this.activity.loader(true);
        else { this.activity.loader(false); this.activity.toggle(); }
      };
      this.reset = function () { scroll.clear(); scroll.render().find('.kinogo-empty').remove(); };
      this.empty = function (msg) {
        this.loading(false);
        scroll.clear();
        scroll.append($('<div class="kinogo-empty">' + msg + '</div>'));
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
            Lampa.Storage.set('kinogo_balanser', balanser);
            Lampa.Select.close();
            Lampa.Activity.replace();
          } else if (type == 'filter') {
            if (a.reset) { choice.season = 0; saveChoice(); Lampa.Select.close(); Lampa.Activity.replace(); return; }
            if (a.stype == 'season') { choice.season = b.index; saveChoice(); Lampa.Select.close(); self.reset(); build(); }
          }
        };
        this.loading(true);
        if (balanser !== 'nextembed') startIframe();
        else build();
      };

      function build() {
        loadNextembed(function (cfg) {
          if (destroyed) return;
          config = cfg;
          if (!config || !srcUrl(config.source, config._key)) {
            Lampa.Noty.show(Lampa.Lang.translate('kinogo_switch'));
            balanser = 'cinemar';
            Lampa.Storage.set('kinogo_balanser', balanser);
            startIframe();
            return;
          }
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
          draw(items);
        });
      }

      function mark(hash) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        if (viewed.indexOf(hash) == -1) { viewed.push(hash); Lampa.Storage.set('online_view', viewed); }
      }

      function draw(items) {
        if (destroyed) return;
        self.loading(false);
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

      // --- iframe-режимы (cinemar / vidi): их родной плеер внутри рамки
      function startIframe() {
        loadProviders(function () {
          if (destroyed) return;
          self.loading(false);
          var idx = balanser == 'vidi' ? 2 : 0;
          var url = providers[idx];
          if (!url) { self.empty(Lampa.Lang.translate('kinogo_nolink')); return; }
          iframeMode = true;
          scroll.clear();
          var wrap = $('<div class="kinogo-frame-wrap"></div>');
          var bar  = $('<div class="kinogo-frame-bar"></div>');
          var back = $('<div class="kinogo-frame-btn selector">← ' + Lampa.Lang.translate('back') + '</div>');
          back.on('hover:enter', function () { Lampa.Activity.backward(); });
          var src = $('<div class="kinogo-frame-btn selector">' + Lampa.Lang.translate('settings_rest_source') + '</div>');
          src.on('hover:enter', function () {
            balanser = 'nextembed';
            Lampa.Storage.set('kinogo_balanser', balanser);
            Lampa.Activity.replace();
          });
          bar.append(back).append(src);
          var box = $('<div class="kinogo-frame-box"></div>');
          box.append($('<iframe class="kinogo-frame" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe>').attr('src', url));
          wrap.append(bar).append(box);
          scroll.append(wrap);
          Lampa.Controller.enable('content');
        });
      }

      this.create = function () { return this.render(); };
      this.render = function () { return files.render(); };
      this.start = function () {
        if (Lampa.Activity.active().activity !== this.activity) return;   // docs §8.2
        if (!initialized) { initialized = true; this.initialize(); }
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
      this.destroy = function () {                                       // docs §9.5
        destroyed = true;
        files.destroy();
        scroll.destroy();
      };
    }

    Lampa.Component.add('kinogo_online', Component);

    // манифест: пункт в меню «Источник» карточки (docs §4 шаг 2)
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

    // кнопка в карточке (docs §5)
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
      if (e.type == 'complite') {   // опечатка в самой Lampa — писать именно так
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
