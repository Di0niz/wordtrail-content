# WordTrail — контент

Публичный репозиторий с уроками WordTrail — приложения для изучения английской лексики. Здесь лежат входные файлы из редактора, контент, который готовит агент (Claude Code), и собранные данные `data/`, которые читает iOS-приложение. Репозиторий публикуется через GitHub Pages (ветка `main`, корень) как статика — без сервера и вызовов внешних API; GitHub Action только проверяет данные.

Цепочка: **редактор** → `lessons/<id>.json` → **агент** (Claude пишет `agent/content/<id>.content.json` по скиллу `wordtrail-lesson`) → `tools/build.py` → `data/` → **приложение**.

## Структура

```
README.md
.nojekyll                       GitHub Pages отдаёт файлы как есть
lessons/<id>.json               words.json из редактора — вход агента
agent/content/<id>.content.json контент агента: переводы, IPA, CEFR, примеры, заметки, углубление для повторов
schemas/
  words.schema.json             формат words.json (JSON Schema 2020-12)
  content.schema.json           формат content.json, включая необязательные поля и поля уровней 2–4+
tools/
  build.py                      words.json + content.json → data/lessons/<id>.json, vocab.json, days.json
  tts.py                        озвучка Kokoro-82M (или macOS `say`) → data/audio/<hash>.m4a, audio_status
  tts/                          venv Kokoro, kokoro_synth.py, lexicon.json
  manifest.py                   data/manifest.json (точка входа приложения)
  rebuild.py                    пересобрать всё data/ с нуля в порядке дат (+ tts; --no-tts для CI)
  validate.py                   проверить data/ так, как его ожидает приложение
  schema_check.py, content_io.py  мини-валидатор JSON Schema; чтение/запись content.json без переформатирования
data/                           генерируется скриптами, коммитится
  manifest.json                 список уроков с sha, ссылка на vocab
  days.json                     дата → id уроков, число слов
  vocab.json                    память агента: лемма → уровень, значение, все встречи
  lessons/<id>.json             урок: элементы с lemma, level, content, audio-ключами
  audio/<hash>.m4a              озвучка: AAC, моно, 24 кГц, ~64 кбит/с; имя = хэш произносимого текста, голоса роли и скорости
editor/index.html               редактор: разметка текста и экспорт words.json
.claude/skills/wordtrail-lesson/SKILL.md   процедура агента для Claude Code
.github/workflows/validate.yml  CI: validate + rebuild --no-tts не даёт диффа
```

Всё на Python 3 без зависимостей, кроме озвучки (свой venv, см. «Озвучка»); запускать из корня репозитория.

## Как добавить урок

1. Откройте редактор (https://di0niz.github.io/wordtrail-content/editor/), вставьте текст, отметьте слова, скачайте `<id>.json`. С сайта редактор сам подгружает `data/vocab.json` и подсвечивает повторы; при открытии файла локально словарь можно загрузить вручную.
2. Положите файл в `lessons/`.
3. В Claude Code в этом репозитории: «новый урок» / «собери урок» (скилл `wordtrail-lesson`). Claude напишет `agent/content/<id>.content.json` и запустит:
   ```bash
   python3 tools/build.py lessons/<id>.json   # проблемы → код выхода 1, ничего не пишется (--force — записать всё равно)
   python3 tools/tts.py                       # только macOS + venv tools/tts; без него audio_status: pending
   python3 tools/manifest.py
   python3 tools/validate.py
   ```
4. Проверьте сводку и закоммитьте: `git add lessons agent data && git commit -m "Lesson <id>" && git push`.

`build.py` идемпотентен: повторный запуск урока заменяет его встречи в vocab, а не добавляет новые. Уровень слова = номер встречи; считаются только встречи в более ранних уроках (по дате и порядку в дне). Если добавлен урок задним числом — `python3 tools/rebuild.py` пересчитает всё. `manifest.py` меняет `generated_at`, только если что-то изменилось, поэтому повторные запуски не дают диффа.

## Адреса (GitHub Pages)

| Что | URL |
| --- | --- |
| Манифест | https://di0niz.github.io/wordtrail-content/data/manifest.json |
| Урок | https://di0niz.github.io/wordtrail-content/data/lessons/<id>.json |
| Словарь | https://di0niz.github.io/wordtrail-content/data/vocab.json |
| Дни | https://di0niz.github.io/wordtrail-content/data/days.json |
| Аудио | https://di0niz.github.io/wordtrail-content/data/audio/<ключ>.m4a |
| Редактор | https://di0niz.github.io/wordtrail-content/editor/ |
| Веб-приложение | https://di0niz.github.io/wordtrail-content/web/ (корень сайта перенаправляет сюда) |

## Веб-версия (`web/`)

Статическое приложение для браузера: те же уроки, карточки и тренировки, что в приложении для iPhone. Без сборки и зависимостей — ES-модули и CSS, данные берутся из `../data/`.

- **Экраны:** лента (словарь, серия дней, «на повторение сегодня», неделя, архив), урок (карточки, тренировка, список слов), повторение и новые слова по всем урокам, словарь с поиском и фильтрами, страница слова, настройки.
- **Тренировка** — перенос доменной логики приложения (`Packages/WordTrailKit` → `web/js/domain/`): «Послушать и понять», «Пропуск», «Перевод назад», «Диктант»; до 20 слов, сначала просроченные; ошибка возвращает слово один раз и проще; Лейтнер 1/3/7/14/30 дней; тренировка до срока не поднимает коробку, ошибка опускает. Уход посреди тренировки сохраняет ответы.
- **Озвучка:** m4a урока; повторное нажатие — медленнее (`sentence_slow` или 0.75×); без записи или офлайн — голос браузера.
- **Прогресс** — `localStorage` этого браузера. Экспорт/импорт JSON в формате приложения (`wordtrail-progress-YYYY-MM-DD.json`, даты ISO-8601 без миллисекунд) — переносится между браузером и iPhone в обе стороны; при импорте остаётся более свежая запись.
- **Офлайн (PWA):** `web/sw.js` кэширует оболочку, уроки (по `sha` из манифеста) и аудио по мере прослушивания; на iPhone — «Поделиться» → «На экран „Домой“». При изменении файлов `web/` поднимите `VERSION` в `sw.js` — страница предложит «Обновить».
- **Клавиатура:** ← → карточки, Пробел — прослушать, 1–4 — вариант, Enter — дальше.
- **Тесты:** `node --test web/tests/*.test.mjs` (Node 20+, без зависимостей; есть в CI) — паритет Лейтнера/сессии/диктанта/слияния с тестами Swift, формат файла прогресса iOS, список файлов service worker, все реальные уроки.
- Локально: `python3 -m http.server` в корне репозитория → http://localhost:8000/web/.

## manifest.json

Приложение сначала загружает манифест и скачивает только уроки, у которых изменился `sha`.

```json
{
  "version": 1,
  "generated_at": "2026-10-17T10:00:00Z",
  "lessons": [
    {"id": "…", "date": "2026-10-16", "title": "<source.title>", "title_ru": "<source.title_ru>",
     "day_index": 1, "words": 12, "new": 12, "repeats": 0,
     "path": "lessons/<id>.json", "sha": "<16 hex sha256 файла>", "audio_status": "ready"}
  ],
  "vocab": {"path": "vocab.json", "sha": "<16 hex>"},
  "audio_base": "audio/"
}
```

Уроки отсортированы по дате (новые первыми), внутри дня — по `day_index`. Пути — относительно `data/`.

## Форматы

- **words.json** — `version, id, date, source{title, url?}, items[]{text, kind: word|phrase, sentence, note}`; см. `schemas/words.schema.json`.
- **content.json** — `source_title_ru`, `sentences{key: {display?, ru}}`, `items{<text>: {s, lemma, pos, ipa, cefr, ru, ru_short, definition_en, note_ru, examples[{en, ru}], …}}`. Необязательные поля: `suggest_phrase, text_fixed, flags[], proper_noun, short_context` и поля углубления для повторов `collocations, family, compare_ru, synonyms, register_ru, mistakes_ru, story` (приложение показывает их на странице слова). См. `schemas/content.schema.json`.
- **data/lessons/<id>.json** — `id, date, source{title, title_ru}, day{index, total}, build{prompt_version, model, audio_status}, items[]`; элемент: `text, kind, sentence, note, id, lemma, level, encounter_no, content{…}, audio{word, sentence, sentence_slow, examples[]}`, при правках агента — `text_original`, `sentence_original`, у повторов — `history`. Файл пишется компактно, без отступов (его скачивает приложение; читаемый исходник — `agent/content/<id>.content.json`); `vocab.json` и `days.json` — с отступом 2 пробела.

## Озвучка

`tools/tts.py` синтезирует офлайн нейросетевой моделью **Kokoro-82M** (hexgrad, лицензия Apache-2.0, произношение — её G2P Misaki). На каждый элемент: слово, предложение 1× и 0.75×, каждый пример.

| Роль | Голос | Скорость |
| --- | --- | --- |
| слово, предложение | `af_heart` (US, женский) | 1.0 |
| медленное предложение | `af_heart` | 0.75 — настоящий темп Kokoro, без растягивания пауз |
| примеры | `am_michael` (US, мужской) | 1.0 |

- **Окружение.** Kokoro работает в отдельном venv (Python 3.11, torch с MPS): `uv venv -p python3.11 tools/tts/.venv && uv pip install -p tools/tts/.venv -r tools/tts/requirements.txt`. Модель (~330 МБ) скачивается с Hugging Face в `tools/tts/.cache/` при первом запуске. Сам `tts.py`, `build.py` и CI остаются на stdlib: `tts.py` запускает `tools/tts/kokoro_synth.py` из venv (модель грузится один раз; тишина по краям обрезается до 80 мс, громкость выравнивается до −20 dBFS RMS речи). Около 0,3 с на предложение на M4 Pro.
- **Словарь произношения** `tools/tts/lexicon.json`: слова, которые Kokoro читает неправильно, и имена/бренды, которых нет в словаре Misaki, → фонемы Misaki; подставляются в текст как `[слово](/фонемы/)`. Имя файла считается от текста *после* подстановки — правка словаря порождает новые файлы. Пополняется вручную после прослушивания; ручные записи перечислены в `_manual` и не перезаписываются.
- **Запасной движок:** `WORDTRAIL_TTS_ENGINE=say python3 tools/rebuild.py` — системный голос macOS Samantha (файлы получат другие имена). Компактный Samantha не умеет ровно 0.75× (≈0.77×).
- `audio_status` урока: `ready` — все файлы на месте, `partial` — часть, `pending` — нет ни одного; считается по файлам, а не задаётся руками.

## Ещё не сделано

- Разные значения одного слова (bank — банк / берег) пока не различаются: у каждой леммы одно значение `s1`.
