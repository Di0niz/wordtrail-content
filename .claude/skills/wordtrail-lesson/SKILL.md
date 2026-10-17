---
name: wordtrail-lesson
description: >-
  Агент контента WordTrail: превращает words.json из редактора в урок — Claude сам пишет
  agent/content/<id>.content.json (переводы в контексте, IPA, CEFR, примеры, заметки, ARPAbet для
  тренажёра произношения, углубление для повторов), затем tools/phonemes.py, sentence_pron.py, build.py, tts.py, manifest.py, validate.py.
  WordTrail content agent: turns an editor words.json into a lesson by hand-writing content.json, then
  builds, validates and proposes a commit. Триггеры / triggers: "новый урок", "собери урок",
  "обработай words.json", "добавь урок", "подготовь контент", "add lesson", "build lesson",
  "process words.json", "new WordTrail lesson".
---

# WordTrail: новый урок из words.json

Ты — агент контента WordTrail. Внешних API нет: контент пишешь ты сам, скрипты (Python 3, stdlib)
только сливают, проверяют и пишут `data/`. Все команды — из корня репозитория (где лежит `tools/`).

Файлы:
- вход: `lessons/<id>.json` — words.json из редактора, формат `schemas/words.schema.json`;
- твой результат: `agent/content/<id>.content.json`, формат `schemas/content.schema.json` (прочитай схему целиком перед работой — там описано каждое поле);
- выход скриптов: `data/lessons/<id>.json`, `data/vocab.json`, `data/days.json`, `data/manifest.json`.
- образцы стиля: `agent/content/2026-10-16-building-resilient-ai-powered-software.content.json` (формат с `sentences`) и `agent/content/2026-10-16-today-s-episode-is-a-deepdive-into.content.json` (старый формат с `sentence_ru` в элементе — для новых уроков не используй).

## 1. Найти урок

Если пользователь назвал файл или id — бери его. Если файл лежит вне репозитория (например, `~/Downloads/2026-10-20-x.json`) — скопируй в `lessons/`, имя файла = `id` из JSON.
Иначе найди несобранные: `python3 tools/validate.py` печатает `warning: lessons/<id>.json ещё не собран`.
Несколько новых уроков — обрабатывай по порядку даты (более ранний урок должен попасть в vocab раньше). Если урока нет — скажи об этом и остановись.

Проверь вход: `python3 tools/schema_check.py schemas/words.schema.json lessons/<id>.json`.

## 2. Сверка с vocab.json (повторы)

Прочитай `data/vocab.json` (ключ — лемма, `level` = сколько раз встречалась, `encounters[]` — уроки и предложения, `senses[0].ru` — перевод).
Для каждого элемента сначала определи лемму (см. правила ниже), затем:
- лемма есть в vocab → это повтор, уровень в этом уроке = `vocab[lemma].level + 1` (если урок датирован позже всех встреч; build.py считает только более ранние уроки);
- проверь и близкие ключи: нормальную форму фразы (`spin up` для `spinning`), `suggest_phrase`, вариант через дефис/слитно;
- для повтора прочитай прошлые предложения (`encounters[].sentence`) и прошлые примеры в `data/lessons/<lesson>.json` → `items[].content.examples` — новые примеры не должны их повторять;
- значение другое (bank — банк/берег)? Отдельных значений build.py пока не поддерживает (всегда `s1`): учи слово в новом значении, явно скажи об этом в `note_ru` («Раньше встречалось в значении …, здесь — …») и упомяни в итоговой сводке.

Быстрая проверка списка лемм:
```bash
python3 -c "import json,sys; v=json.load(open('data/vocab.json')); [print(l, v[l]['level'] if l in v else '-') for l in sys.argv[1:]]" resilient "spin up"
```

## 3. Написать agent/content/<id>.content.json

Структура (подробно — в схеме):
```json
{
  "source_title_ru": "…",
  "sentences": {"s1": {"display": "…(только если чистил)…", "ru": "…"}},
  "items": {
    "<items[].text ровно как в words.json>": {
      "s": "s1", "lemma": "…", "pos": "…", "ipa": "/…/", "cefr": "B2",
      "ru": "…", "ru_short": "…", "definition_en": "…", "note_ru": "…",
      "examples": [{"en": "…", "ru": "…"}, {"en": "…", "ru": "…"}],
      "phonemes": "…"
    }
  }
}
```
Ключ в `items` — `text` из words.json символ в символ (включая типографские апострофы ’, регистр, опечатки).
Пиши файл с `ensure_ascii=False`-видом (кириллица как есть), отступ 2 пробела.

### Правила качества (уровень 1 — всегда)

- **source_title_ru** — осмысленное русское название источника, а не перевод обрезанного заголовка редактора («Today’s episode is a deepdive into» → «Повседневные инструменты разработчиков Uber»).
- **sentences** — по ключу на каждое исходное предложение (`s1`, `s2`, … по порядку); элементы из одного предложения ссылаются на один ключ.
  - `ru` — полный естественный перевод предложения (в его очищенном виде), не подстрочник. Имена — транслитерацией (Удай Киран Медисетти), названия книг/продуктов — как в оригинале, термины AI, API, DR, PR не переводятся.
  - `display` — только если контекст пришлось чистить: разделить склеенные заголовок и подзаголовок; убрать подписи, авторов, даты, номера сносок («apparently.5»), хвосты вроде «GERGELY OROSZ OCT 13, 2026»; сократить длинный абзац до предложения со словом; исправить опечатку-склейку («showsomeone» → «shows someone»). `display` обязан содержать слово (или `text_fixed`). Слова исходника не перефразируй — только вырезай и чини.
  - Каждой правке контекста соответствует флаг в элементе (`flags`) и одна фраза в конце `note_ru`: «Агент разделил заголовок и подзаголовок на два предложения.», «Агент убрал из контекста подпись автора и дату.», «Агент сократил длинный абзац до нужного предложения.».
- **lemma** — словарная форма в нижнем регистре: `revealed` → `reveal`, `regressions` → `regression`, `Mentions` → `mention`, `Minion` → `minion`. Для фраз и частей фраз — нормальная форма: `turned it down` → `turn down`, `spinning` → `spin up`, `ought` → `ought to`, `bleeding` → `bleeding edge`. Сложные слова через дефис оставляй как есть (`longest-tenured`, `trade-off`). Лемма — ключ памяти повторов, будь последователен.
- **pos** — по-английски: noun, verb, adjective, adverb, preposition, phrasal verb, modal verb, idiom.
- **ipa** — в /слэшах/, американское произношение (ɑː, oʊ, r: /ˈɑːpəreɪt/, не /ˈɒpəreɪt/), со знаками ударения ˈ ˌ; транскрипция той формы, что в тексте (`awaited` → /əˈweɪtɪd/, `spinning` (spin up) → /ˈspɪnɪŋ ʌp/).
- **cefr** — A1…C2, оценка уровня слова в этом значении.
- **ru** — перевод в ЭТОМ контексте; можно 2 близких варианта через запятую. Если значение в контексте отличается от обычного — «здесь: …» (redundant → «здесь: бесполезный, ненужный»; Minion → «здесь: название внутреннего инструмента Uber»).
- **ru_short** — для карточки и таблицы, 1–4 слова; второе значение через «; » (`лишний; резервный`, `чередование по времени; серпантин`). Попадает в vocab как перевод.
- **definition_en** — короткое определение в стиле learner's dictionary, со строчной буквы, без точки, для этого значения. Для фраз — с самой фразой: «spin up — to start a new server or service quickly».
- **note_ru** — 1–3 предложения о том, чего нет в переводе: базовое значение vs. значение в тексте («Базовое значение — «серпантин»…»), семья слова («Существительное — resilience.»), устойчивые сочетания и предлоги («Конструкция: be laser-focused on something.»), ложные ассоциации («С error не связано по смыслу»), ударение («Ударение на первый слог»), регистр/британский вариант, опечатки исходника («В исходном тексте опечатка: «on of» вместо «one of».»). Не пересказывай перевод.
- **examples** — 2 (на высоких уровнях до 3) естественных коротких предложения (≤ 12 слов), разных по смыслу: одно из той же сферы, что и текст (IT, бизнес), одно — в базовом/общем значении. Каждый пример содержит форму слова: build.py принимает только text, лемму и их -s/-es/-ed/-d/-ing — для неправильных форм (spun, ran) и фраз используй форму, которая пройдёт проверку (`spin up`, `spinning`). `ru` — естественный перевод, не подстрочник.
- **suggest_phrase** — если выбрано одно слово, а учить стоит фразу: pick → `pick out`, ought → `ought to`, auspices → `under the auspices of`, bleeding → `bleeding edge`, spinning → `spin up`. Обычно `lemma` = фраза; примеры — с фразой; `note_ru` объясняет, почему фраза.
- **text_fixed** — если опечатка в самом выбранном тексте (`showsomeone` → `shows`). Тогда `display` с исправлением, флаг `в тексте опечатка: shows someone`, объяснение в `note_ru`. Исходник сохранится в `text_original`/`sentence_original` автоматически.
- **flags** — короткие русские пометки о вмешательстве агента: `контекст очищен агентом`, `контекст разделён агентом`, `контекст сокращён агентом`, `в тексте опечатка: …`.
- **proper_noun: true** — если в тексте слово — имя (Minion — инструмент Uber). `ru` — «здесь: название …», `ru_short` и примеры — обычное значение, `note_ru` начинается с «В тексте это имя собственное.».
- **short_context: true** — если «предложение» — заголовок или подпись («Mentions during the episode:»), а не полноценная фраза.
- Если у элемента есть `note` от пользователя — это значение, которое он имеет в виду; следуй ему.

### Произношение: phonemes (для тренажёра в приложении)

Для каждого нового элемента добавь `phonemes` — ARPAbet в стиле CMUdict (американский), для `text` в том виде, как он показывается (после `text_fixed`):
- фонемы через пробел, у каждой гласной цифра ударения: 1 — основное, 2 — побочное, 0 — без ударения (`resilient` → `R IH0 Z IH1 L Y AH0 N T`);
- несколько слов (фраза, слово через дефис) — слова разделяются ` | ` (`spin up` → `S P IH1 N | AH1 P`, `longest-tenured` → `L AO1 NG G IH0 S T | T EH1 N Y ER0 D`);
- бери произношение из CMUdict, для словоформ достраивай окончания: -s → S/Z/IH0 Z, -ed → T/D/IH0 D, -ing → IH0 NG;
- должно соответствовать `ipa` (то же ударение, тот же вариант произношения);
- допустимые символы: AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW (+0/1/2), B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH и `|`. Схема проверяет формат.

Заполнять вручную не нужно: после записи content.json запусти `python3 tools/phonemes.py agent/content/<id>.content.json` — он берёт CMUdict (скачивается в `tools/cache/`) и `tools/phonemes_manual.json` и вписывает `phonemes` после `ipa`, сохраняя форматирование файла. Затем:
- слова, которых нет в CMUdict (`missing: …`, код выхода 1), допиши сам — в `tools/phonemes_manual.json` (ключ — текст элемента в нижнем регистре), если слово может встретиться снова, или прямо в content.json;
- сверь каждое значение с `ipa`: CMUdict даёт одно (первое) произношение и часто полные гласные вместо редуцированных (`AH0` вместо `IH0`), ударение существительного вместо глагола (`reuse`). Если расходится — исправь (`phonemes.py` не перезаписывает существующие значения без `--force`).

build.py передаёт `phonemes` в `items[].content` как есть. Все уже собранные уроки содержат phonemes.

### Произношение предложения: sentence_pron (фонемы с вариантами, отрезки, интонация)

После `phonemes.py` запусти генератор (свой venv, один раз: `uv venv --python 3.11 tools/sentence_pron/.venv && uv pip install --python tools/sentence_pron/.venv/bin/python -r tools/sentence_pron/requirements.txt`, плюс `brew install espeak-ng`; словарь MFA — см. README):
```bash
tools/sentence_pron/.venv/bin/python tools/sentence_pron.py agent/content/<id>.content.json
```
Он пишет `sentence_pron` после `phonemes`: слова предложения (`tools/tokenizer.py`), `ph` — первый вариант CMUdict (ZIPA ждёт словарные формы), `alt` — до 3 вариантов со штрафом (слабые формы служебных слов, другие варианты CMUdict/MFA/espeak-ng), `fn`/`wt`/`target`, омографы по части речи, отрезки для чтения (1–4 по 4–12 слов, целевое слово целиком в одном), интонацию (тип предложения, финальный тон, ядерное слово, паузы по пунктуации). Подробности — шапка `tools/sentence_pron.py` и `docs/stage3-contracts.md` в репозитории приложения.

Затем разбери строки `unreviewed:` — это то, в чём генератор не уверен:
- `OOV:` (g2p_en угадал), `COMPOUND:`, `CAMEL:` — проверь произношение; неверное — исправь в `tools/sentence_pron/overrides.json` → `_words` (`"evals": {"ph": "IH0 V AE1 L Z", "alt": [{"ph": "…", "p": 0.5}]}`), это действует во всех уроках;
- `ACR:` (аббревиатура по буквам), `NUM:` (числа: годы читаются «twenty twenty-five», кардинальное чтение — вариант) — проверь, что так и читают;
- `HOM:` — омограф, части речи spaCy и NLTK разошлись: реши по смыслу и запиши `set: {"words[i].ph": "…", "words[i].hom": "checked"}`;
- `TUNE:` / `Q:declarative` — интонация неоднозначна (tag-вопрос, двоеточие, нет точки): проверь `prosody`;
- `CHUNK:long` и любые неудачные отрезки («in terms ‖ of», «its entire ‖ annual») — задай `set: {"chunks": [{"from": 0, "to": 7}, …]}`.

Решения записываются в `overrides.json` по ключу `<lesson id>/<текст элемента>`; просмотренные флаги — в `reviewed` того же ключа (тогда они больше не всплывают). Повтор с `--check` должен дать `would change 0`, без `unreviewed:` и `error:`.

### Углубление для повторов (уровень = номер встречи)

build.py сейчас использует только поля уровня 1; дополнительные поля проходят в `items[].content` без изменений, приложение научится их показывать позже. Поля уровня 1 пиши всегда, плюс:
- **уровень 2**: `collocations` (3–5 частых сочетаний: `emit metrics`, `emit light`), `family` (семья слова с частью речи: `resilience (n)`, `resiliently (adv)`), `compare_ru` (1–2 предложения: чем этот контекст похож/отличается от прошлых). Примеры — новые, не повторяющие прошлые уроки.
- **уровень 3**: всё из уровня 2 + `synonyms` (`[{"word": "robust", "note_ru": "чем отличается"}]`, 2–4 шт.), `register_ru` (нейтральное/книжное/разговорное/техническое), `mistakes_ru` (типичные ошибки русскоговорящих: предлог, ложный друг, произношение). 3 примера.
- **уровень 4+**: всё из уровня 3 + `story` (`{"en": "…", "ru": "…"}`, 3–5 предложений с этим словом и 2–4 другими словами из vocab.json, лучше тоже повторами).

## 4. Сборка, озвучка и проверка

```bash
python3 tools/phonemes.py agent/content/<id>.content.json   # см. «Произношение» выше
tools/sentence_pron/.venv/bin/python tools/sentence_pron.py agent/content/<id>.content.json   # см. «sentence_pron» выше
python3 tools/build.py lessons/<id>.json     # content: agent/content/<id>.content.json, data: data/
```
- Выход 0 и `problems: нет` — дальше. Выход 1 — ничего не записано: исправь content.json и запусти снова (не используй `--force`, если пользователь не попросил). Типичные проблемы: ключ `items` не совпадает с `text` (апострофы!), слова нет в `display`, пример без формы слова, пустой `sentence_ru` (нет `s` или `ru`), ошибка схемы.
- `warning: леммы встречаются в более поздних уроках` — урок датирован раньше уже собранных: запусти `python3 tools/rebuild.py`, чтобы пересчитать уровни.
- Повторный запуск того же урока безопасен (идемпотентно).

Затем:
```bash
python3 tools/tts.py         # озвучка Kokoro-82M (af_heart; примеры — am_michael) → data/audio/<hash>.m4a; готовые файлы не трогает
python3 tools/manifest.py
python3 tools/validate.py
```
- `tts.py` синтезирует слово, предложение (1× и 0.75×) и примеры моделью Kokoro-82M в venv `tools/tts/.venv` (создание — README, раздел «Озвучка»), удаляет файлы без ссылок и пересчитывает `build.audio_status`. Нужен macOS (afconvert). Без venv — пропусти шаг, урок соберётся со статусом `pending`, приложение прочитает его системным голосом.
- **Произношение имён и редких слов.** После `tts.py` запусти `tools/tts/.venv/bin/python tools/tts/check_pron.py --zipa <app>/tools/pronunciation-model --suggest`: он добавит в `tools/tts/lexicon.json` слова, которых Kokoro не знает (имена, бренды), и исправит слова, где ZIPA слышит не то. Проверь новые записи на здравый смысл (фонемы Misaki: A=eɪ, I=aɪ, O=oʊ, W=aʊ, Y=ɔɪ), при сомнении впиши своё произношение и добавь слово в `_manual`; затем снова `tts.py` → manifest → validate. Слова, оставшиеся с PER > 20 %, перечисли в сводке.
- validate должен закончиться `OK`. Если правил контент — снова build → tts → manifest → validate.

## 5. Итог и коммит

Покажи пользователю коротко:
- урок: id, название и `source_title_ru`, элементов N (новых / повторов);
- повторы: слово → уровень, с каким уроком совпало, если значение новое — отметь;
- вмешательства агента: исправленные опечатки, очищенные контексты, предложенные фразы, имена собственные;
- проблемы и сомнения (спорные леммы, неуверенность в значении).

Предложи команды, но **не пушь без явного подтверждения пользователя**:
```bash
git add lessons/<id>.json agent/content/<id>.content.json tools/phonemes_manual.json data/
git commit -m "Lesson <id>"
git push
```
После пуша урок появится на https://di0niz.github.io/wordtrail-content/data/manifest.json (GitHub Pages обновляется через 1–2 минуты).
