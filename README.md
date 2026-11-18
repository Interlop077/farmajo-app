# FARMAJO — электронное меню
Файлы: public/screen.html (экраны), public/admin.html (админ-панель), sql/import.sql (разовая загрузка меню).
Ключи Supabase НЕ хранятся в коде: при сборке (node build.mjs) берутся из переменных окружения
SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY и записываются в dist/config.js.
Хостинг: Netlify (команда сборки node build.mjs, папка dist). Адреса: /admin.html, /screen.html?id=screen1, /screen.html?id=screen2, /screen.html?id=screen3 (шашлычная). Для нового экрана выполните sql/screen3_shashlychnaya.sql в Supabase SQL Editor.
