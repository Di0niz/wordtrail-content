# WordTrail — контент

Публичный репозиторий с уроками WordTrail — приложения для изучения английской лексики. Здесь лежат входные файлы из редактора, контент, который готовит агент (Claude Code), и собранные данные `data/`, которые читает iOS-приложение. Репозиторий публикуется через GitHub Pages (ветка `main`, корень) как статика — без сервера и вызовов внешних API; GitHub Action только проверяет данные.

Цепочка: **редактор** → `lessons/<id>.json` → **агент** (Claude пишет `agent/content/<id>.content.json` по скиллу `wordtrail-lesson`) → `tools/build.py` → `data/` → **приложение**.

## Структура

```
README.md
.nojekyll                       GitHub Pages отдаёт файлы как есть
lessons/<id>.json               words.json из редактора — вход агента
agent/content/<id>.content.json контент агента: переводы, IPA, CEFR, примеры, заметки, phonemes, sentence_pron
schemas/
  words.schema.json             формат words.json (JSON Schema 2020-12)
  content.schema.json           формат content.json, включая необязательные поля и поля уровней 2–4+
  tokenizer-golden.json         эталон токенизатора слов: те же случаи проходит Swift-двойник в приложении
tools/
  phonemes.py                   phonemes (ARPAbet) в content.json из CMUdict + phonemes_manual.json
  phonemes_manual.json          произношения, написанные агентом (нет в CMUdict или сверены с IPA)
  sentence_pron.py              sentence_pron предложения: фонемы с вариантами, отрезки, интонация (свой venv, не в CI)
  sentence_pron/                requirements.txt (закреплённые версии), overrides.json (решения агента), .venv/ (не коммитится)
  sentence_pron_check.py        проверка sentence_pron без зависимостей (её зовёт validate.py)
  weak_forms.json, arpabet_zipa.json  слабые формы служебных слов со штрафами и соответствие ARPAbet ↔ фонемы ZIPA —
                                копии из tools/pronunciation-model/g2p_eval/ репозитория приложения (там источник и замер)
  build.py                      words.json + content.json → data/lessons/<id>.json, vocab.json, days.json
  tts.py                        озвучка Kokoro-82M (или macOS `say`) → data/audio/<hash>.m4a, audio_status
  tts/                          venv Kokoro, kokoro_synth.py, lexicon.json, check_pron.py, check_tune.py
  manifest.py                   data/manifest.json (точка входа приложения)
  rebuild.py                    пересобрать всё data/ с нуля в порядке дат (+ tts; --no-tts для CI)
  validate.py                   проверить data/ так, как его ожидает приложение (+ эталон токенизатора)
  tokenizer.py                  общий токенизатор слов (смещения в кодовых точках); --check — прогнать эталон
  schema_check.py, content_io.py  мини-валидатор JSON Schema; чтение/запись content.json без переформатирования
  cache/                        CMUdict, словарь MFA (скачиваются, не коммитятся)
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

Всё на Python 3 без зависимостей, кроме `tools/sentence_pron.py` (свой venv, см. ниже); запускать из корня репозитория.

## Как добавить урок

1. Откройте редактор (https://di0niz.github.io/wordtrail-content/editor/), вставьте текст, отметьте слова, скачайте `<id>.json`. С сайта редактор сам подгружает `data/vocab.json` и подсвечивает повторы; при открытии файла локально словарь можно загрузить вручную.
2. Положите файл в `lessons/`.
3. В Claude Code в этом репозитории: «новый урок» / «собери урок» (скилл `wordtrail-lesson`). Claude напишет `agent/content/<id>.content.json` и запустит:
   ```bash
   python3 tools/phonemes.py agent/content/<id>.content.json
   tools/sentence_pron/.venv/bin/python tools/sentence_pron.py agent/content/<id>.content.json
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
- **content.json** — `source_title_ru`, `sentences{key: {display?, ru}}`, `items{<text>: {s, lemma, pos, ipa, cefr, ru, ru_short, definition_en, note_ru, examples[{en, ru}], …}}`. Необязательные поля: `suggest_phrase, text_fixed, flags[], proper_noun, short_context, phonemes` (ARPAbet для тренажёра произношения) и поля углубления для повторов `collocations, family, compare_ru, synonyms, register_ru, mistakes_ru, story` (приложение пока их не показывает). См. `schemas/content.schema.json`.
- **data/lessons/<id>.json** — `id, date, source{title, title_ru}, day{index, total}, build{prompt_version, model, audio_status}, items[]`; элемент: `text, kind, sentence, note, id, lemma, level, encounter_no, content{…}, audio{word, sentence, sentence_slow, examples[]}`, при правках агента — `text_original`, `sentence_original`, у повторов — `history`. Файл пишется компактно, без отступов (его скачивает приложение; читаемый исходник — `agent/content/<id>.content.json`); `vocab.json` и `days.json` — с отступом 2 пробела.

## Озвучка

`tools/tts.py` синтезирует офлайн нейросетевой моделью **Kokoro-82M** (hexgrad, лицензия Apache-2.0, произношение — её G2P Misaki). На каждый элемент: слово, предложение 1× и 0.75×, каждый пример.

| Роль | Голос | Скорость |
| --- | --- | --- |
| слово, предложение | `af_heart` (US, женский) | 1.0 |
| медленное предложение | `af_heart` | 0.75 — настоящий темп Kokoro, без растягивания пауз |
| примеры | `am_michael` (US, мужской) | 1.0 |

- **Окружение.** Kokoro работает в отдельном venv (Python 3.11, torch с MPS): `uv venv -p python3.11 tools/tts/.venv && uv pip install -p tools/tts/.venv -r tools/tts/requirements.txt`. Модель (~330 МБ) скачивается с Hugging Face в `tools/tts/.cache/` при первом запуске. Сам `tts.py`, `build.py` и CI остаются на stdlib: `tts.py` запускает `tools/tts/kokoro_synth.py` из venv (модель грузится один раз; тишина по краям обрезается до 80 мс, громкость выравнивается до −20 dBFS RMS речи). Около 0,3 с на предложение на M4 Pro.
- **Словарь произношения** `tools/tts/lexicon.json`: слова, которые Kokoro читает неправильно, и имена/бренды, которых нет в словаре Misaki, → фонемы Misaki; подставляются в текст как `[слово](/фонемы/)`. Имя файла считается от текста *после* подстановки — правка словаря порождает новые файлы. Пополнять: `tools/tts/.venv/bin/python tools/tts/check_pron.py --zipa <app>/tools/pronunciation-model --suggest` — ZIPA распознаёт аудио слова и сравнивает с `content.phonemes`; для слов с PER > 20 % пробует наши фонемы и оставляет их, только если стало лучше; добавляет неизвестные Misaki слова из `sentence_pron`. Ручные записи перечислены в `_manual` и не перезаписываются.
- **Проверка интонации эталона:** `tools/tts/check_tune.py` — понижение/повышение в конце (только для контроля). Kokoro заканчивает длинные утверждения ровнее, чем `say`, а общие вопросы — иногда понижением; приложение оценивает тон по правилам `sentence_pron.prosody`, синтез служит только образцом для графика.
- **Запасной движок:** `WORDTRAIL_TTS_ENGINE=say python3 tools/rebuild.py` — системный голос macOS Samantha (файлы получат другие имена). Компактный Samantha не умеет ровно 0.75× (≈0.77×).
- `audio_status` урока: `ready` — все файлы на месте, `partial` — часть, `pending` — нет ни одного; считается по файлам, а не задаётся руками.

## Произношение: phonemes

Для тренажёра произношения у каждого элемента есть `content.phonemes` — ARPAbet в стиле CMUdict (американский, цифры ударения, слова фразы через ` | `). Источник — [CMUdict](https://github.com/cmusphinx/cmudict) (© Carnegie Mellon University, лицензия BSD-2-Clause) и `tools/phonemes_manual.json` (написано агентом: слова вне словаря и значения, сверенные с IPA урока).

## Произношение предложения: sentence_pron

`content.sentence_pron` — ожидаемое произношение и интонация предложения элемента для тренажёра (формат — `docs/stage3-contracts.md` §3, §6 в репозитории приложения; решения — `tools/pronunciation-model/G2P-EVAL.md` там же). Пишет `tools/sentence_pron.py`, проверяет `tools/sentence_pron_check.py` (в составе `validate.py` и CI).

- Слова — `tools/tokenizer.py`; `ph` — первый вариант CMUdict; вне словаря — составное из словарных частей или g2p_en; аббревиатуры — по буквам; числа — как `NumberFormatter.spellOut` (en_US) в приложении («21» → twenty-one), годы 1100–2099 — естественно («2025» → twenty twenty-five, кардинальное чтение — вариант со штрафом 0.3).
- `alt` — до трёх `{ph, p}`: слабые формы (`tools/weak_forms.json`), другие варианты CMUdict (p 0.5), словарь MFA с вероятностью ≥ 0.1 (p 0.7), espeak-ng en-us (p 0.7). `joins` пустой, DX/Q не используются.
- Служебные слова по части речи spaCy (`en_core_web_sm`) — вес 0.3; целевое — 1.5. Омографы (read, live, use, close, record, appropriate…) — по части речи; spaCy и NLTK не согласны → `hom: "ambiguous"` и флаг агенту.
- Отрезки: 1–4 по 4–12 слов (для предложений длиннее 48 слов — до ⌈n/4⌉+3), граница по пунктуации и синтаксису (меньше пересечённых зависимостей), не внутри целевого слова.
- Интонация: тип по пунктуации и первому слову (wh / общий / tag / альтернативный вопрос, побуждение, утверждение), финальный тон (утверждение, wh, побуждение — понижение; общий вопрос — повышение; tag, двоеточие, нет точки — `tune_ambiguous`), ядро — последнее знаменательное слово, паузы по пунктуации.
- Ручные решения — `tools/sentence_pron/overrides.json`.

Окружение (один раз, на Mac):
```bash
uv venv --python 3.11 tools/sentence_pron/.venv
uv pip install --python tools/sentence_pron/.venv/bin/python -r tools/sentence_pron/requirements.txt
brew install espeak-ng                          # GPL, используется только офлайн; в контент попадают данные
curl -fsSL -o tools/cache/english_us_arpa.dict \
  https://github.com/MontrealCorpusTools/mfa-models/releases/download/dictionary-english_us_arpa-v3.0.0/english_us_arpa.dict
```
Источники: CMUdict (BSD-2-Clause), словарь MFA english_us_arpa v3.0.0 (CC BY 4.0, Montreal Forced Aligner), g2p_en (Apache-2.0), spaCy + en_core_web_sm (MIT), espeak-ng (GPL-3, только офлайн).

## Ещё не сделано

- Разные значения одного слова (bank — банк / берег) пока не различаются: у каждой леммы одно значение `s1`.
