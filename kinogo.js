(function () {
    'use strict';
    
    // 1. Защита от двойного запуска (если URL случайно добавили дважды)
    if (window.my_site_plugin) return;
    window.my_site_plugin = true;

    function startPlugin() {
        // 2. Добавляем собственные переводы
        Lampa.Lang.add({
            mysite_title: { ru: 'Мой Сайт', en: 'My Site', uk: 'Мій Сайт' }
        });

        // 3. HTML-шаблон кнопки. 
        // Важно: класс 'selector' обязателен для работы пульта/клавиатуры.
        // Класс 'view--mysite' нужен, чтобы мы могли проверить, не добавлена ли кнопка уже.
        var buttonHtml = "<div class='full-start__button selector view--mysite' style='background: #2bd49a; color: #071510; font-weight: bold; border-radius: 0.3em;'>" +
                         "<span>#{mysite_title}</span></div>";

        // 4. Подписываемся на событие полной отрисовки карточки фильма
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            
            var render = e.object.activity.render();
            
            // Защита от дублирования (событие может срабатывать повторно)
            if (render.find('.view--mysite').length) return;

            // Создаем jQuery-объект кнопки и подставляем переводы
            var btn = $(Lampa.Lang.translate(buttonHtml));
            
            // 5. Обработчик нажатия (ОК на пульте, Enter на клавиатуре или клик мышью)
            btn.on('hover:enter', function () {
                var movie = e.data.movie;
                var title = movie.title || movie.name || 'Без названия';
                var year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
                
                // Выводим всплывающее уведомление Lampa
                Lampa.Noty.show('✅ Тест плагина прошел успешно!<br>Фильм: ' + title + (year ? ' (' + year + ')' : ''));
            });
            
            // 6. Вставляем кнопку в интерфейс (сразу после кнопки "Торренты" или "Онлайн")
            var target = render.find('.view--torrent');
            if (target.length) {
                target.after(btn);
            } else {
                // Фоллбек: если кнопка торрентов скрыта или отсутствует, добавляем в общий контейнер кнопок
                render.find('.full-start__buttons').append(btn);
            }
        });
    }

    // 7. Безопасный запуск: ждем, пока Lampa полностью проинициализируется
    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }
})();
