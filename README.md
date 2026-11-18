# FARMAJO — электронное меню
Файлы: public/screen.html (экраны), public/admin.html (админ-панель), sql/import.sql (разовая загрузка меню).
Ключи Supabase НЕ хранятся в коде: при сборке (node build.mjs) берутся из переменных окружения
SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY и записываются в dist/config.js.
Хостинг: Netlify (команда сборки node build.mjs, папка dist). Адреса: /admin.html, /screen.html?id=screen1, /screen.html?id=screen2, /screen.html?id=screen3 (шашлычная). Для нового экрана выполните sql/screen3_shashlychnaya.sql в Supabase SQL Editor.


## AI-редактор меню шашлычной
- В админ-панели откройте вкладку «AI шашлычной». По умолчанию действует `AI_MODE=mock`: платные запросы не выполняются, черновик не содержит операций и ничего не записывает.
- Генерация черновика выполняется Netlify Function `/.netlify/functions/ai-menu-draft`. Ключ OpenAI никогда не передаётся в браузер.
- Запись выполняется отдельной функцией `ai-menu-apply` только после подтверждения в интерфейсе. Функция повторно проверяет категории и позиции: разрешены только категории, привязанные к screen3 и не привязанные к screen1/screen2. Запись идёт с пользовательским JWT Supabase, без service-role ключа.
- Для будущего включения OpenAI в Netlify Environment Variables задаются `AI_MODE=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` (необязательно; по умолчанию `gpt-4.1-mini`), `AI_ALLOWED_USER_IDS` (UUID разрешённых администраторов через запятую), а также серверные `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY`. Пока не задавайте `AI_MODE=openai` и не добавляйте OpenAI ключ — тестовый режим останется бесплатным.
- Для теста функций в Netlify должны быть доступны `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY`; это те же настройки, которые использует сборка сайта.
