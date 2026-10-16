# WordTrail — контент

Публичный репозиторий с уроками WordTrail — приложения для изучения английской лексики. Здесь лежат входные файлы из редактора, контент, который готовит агент (Claude Code), и собранные данные `data/`, которые читает iOS-приложение. Репозиторий публикуется через GitHub Pages (ветка `main`, корень) как статика — без сервера, CI и вызовов внешних API.

Цепочка: **редактор** → `lessons/<id>.json` → **агент** (Claude пишет `agent/content/<id>.content.json` по скиллу `wordtrail-lesson`) → `tools/build.py` → `data/` → **приложение**.

## Структура

```
README.md
.nojekyll                       GitHub Pages отдаёт файлы как есть
lessons/<id>.json               words.json из редактора — вход агента
agent/content/<id>.content.json контент агента: переводы, IPA, CEFR, примеры, заметки, phonemes
schemas/
  words.schema.json             формат words.json (JSON Schema 2020-12)
  content.schema.json           формат content.json, включая необязательные поля и поля уровней 2–4+
tools/
  build.py                      words.json + content.json → data/lessons/<id>.json, vocab.json, days.json
  manifest.py                   data/manifest.json (точка входа приложения)
  rebuild.py                    пересобрать всё data/ с нуля в порядке дат
  validate.py                   проверить data/ так, как его ожидает приложение
  schema_check.py               мини-валидатор JSON Schema (stdlib)
data/                           генерируется скриптами, коммитится
  manifest.json                 список уроков с sha, ссылка на vocab
  days.json                     дата → id уроков, число слов
  vocab.json                    память агента: лемма → уровень, значение, все встречи
  lessons/<id>.json             урок: элементы с lemma, level, content, audio-ключами
  audio/                        озвучка (пока пусто, audio_status: pending)
editor/index.html               редактор: разметка текста и экспорт words.json
.claude/skills/wordtrail-lesson/SKILL.md   процедура агента для Claude Code
```

Всё на Python 3 без зависимостей, запускать из корня репозитория.

## Как добавить урок

1. Откройте редактор (https://di0niz.github.io/wordtrail-content/editor/), вставьте текст, отметьте слова, скачайте `<id>.json`. С сайта редактор сам подгружает `data/vocab.json` и подсвечивает повторы; при открытии файла локально словарь можно загрузить вручную.
2. Положите файл в `lessons/`.
3. В Claude Code в этом репозитории: «новый урок» / «собери урок» (скилл `wordtrail-lesson`). Claude напишет `agent/content/<id>.content.json` и запустит:
   ```bash
   python3 tools/build.py lessons/<id>.json   # проблемы → код выхода 1, ничего не пишется (--force — записать всё равно)
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
| Аудио | https://di0niz.github.io/wordtrail-content/data/audio/<ключ>.mp3 |
| Редактор | https://di0niz.github.io/wordtrail-content/editor/ |

## manifest.json

Приложение сначала загружает манифест и скачивает только уроки, у которых изменился `sha`.

```json
{
  "version": 1,
  "generated_at": "2026-10-17T10:00:00Z",
  "lessons": [
    {"id": "…", "date": "2026-10-16", "title": "<source.title>", "title_ru": "<source.title_ru>",
     "day_index": 1, "words": 12, "new": 12, "repeats": 0,
     "path": "lessons/<id>.json", "sha": "<16 hex sha256 файла>", "audio_status": "pending"}
  ],
  "vocab": {"path": "vocab.json", "sha": "<16 hex>"},
  "audio_base": "audio/"
}
```

Уроки отсортированы по дате (новые первыми), внутри дня — по `day_index`. Пути — относительно `data/`.

## Форматы

- **words.json** — `version, id, date, source{title, url?}, items[]{text, kind: word|phrase, sentence, note}`; см. `schemas/words.schema.json`.
- **content.json** — `source_title_ru`, `sentences{key: {display?, ru}}`, `items{<text>: {s, lemma, pos, ipa, cefr, ru, ru_short, definition_en, note_ru, examples[{en, ru}], …}}`. Необязательные поля: `suggest_phrase, text_fixed, flags[], proper_noun, short_context, phonemes` (ARPAbet для тренажёра произношения) и поля углубления для повторов `collocations, family, compare_ru, synonyms, register_ru, mistakes_ru, story` (приложение пока их не показывает). См. `schemas/content.schema.json`.
- **data/lessons/<id>.json** — `id, date, source{title, title_ru}, day{index, total}, build{prompt_version, model, audio_status}, items[]`; элемент: `text, kind, sentence, note, id, lemma, level, encounter_no, content{…}, audio{word, sentence, sentence_slow, examples[]}`, при правках агента — `text_original`, `sentence_original`, у повторов — `history`.

## Ещё не сделано

- Озвучки нет: в уроках только имена будущих mp3 (`audio.*` — хэш текста, голоса и скорости), `audio_status: "pending"`.
- Разные значения одного слова (bank — банк / берег) пока не различаются: у каждой леммы одно значение `s1`.
