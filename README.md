# FARMAJO — электронное меню
Файлы: public/screen.html (экраны), public/admin.html (админ-панель), sql/import.sql (разовая загрузка меню).
Ключи Supabase НЕ хранятся в коде: при сборке (node build.mjs) берутся из переменных окружения
SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY и записываются в dist/config.js.
Хостинг: Netlify (команда сборки node build.mjs, папка dist). Адреса: /admin.html, /screen.html?id=screen1, /screen.html?id=screen2, /screen.html?id=screen3 (шашлычная). Для нового экрана выполните sql/screen3_shashlychnaya.sql в Supabase SQL Editor.


## AI-редактор меню шашлычной
- AI работает только в бесплатном mock-режиме. OpenAI API не вызывается; `OPENAI_API_KEY` не читается и не требуется.
- Черновик сохраняет серверная Netlify Function в `ai_menu_drafts`. Для этой операции используется серверная переменная `SUPABASE_SERVICE_ROLE_KEY`; она никогда не передаётся браузеру. Черновик связан с UUID пользователя, полученным из проверенной Supabase-сессии.
- Клиент получает ID, хеш и точный список предложенных операций для предпросмотра. При подтверждении отправляет только ID и хеш, но mock-черновик всегда отклоняется функцией применения.
- SQL-функция применения предназначена для одной транзакции PostgreSQL и проверяет владельца, срок, хеш, одноразовое использование и принадлежность категории исключительно screen3. В текущем mock-only режиме она не может применить ни один черновик.
- Перед запуском функций после отдельного согласования проверьте и примените `sql/screen3_ai_security.sql`. Никакой SQL здесь не выполнялся.
- Для работы mock preview на сервере нужны `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` и `SUPABASE_SERVICE_ROLE_KEY`. Не размещайте service-role ключ в `public/config.js`, HTML или браузере.
