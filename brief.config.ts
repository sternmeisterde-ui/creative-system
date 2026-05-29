/**
 * BRIEF: бизнес-контекст проекта.
 *
 * Этот файл — единственное место, где описана семантика бизнеса.
 * Меняешь содержимое — меняются:
 *  • AI-промпты (analyze-performance, recommend, generate-briefs)
 *  • Парсер имён объявлений
 *  • Лейблы потоков в UI
 *  • Тон / запретные слова при генерации брифов
 *
 * Числовые пороги (CPL/CPQL/red flags) хранятся отдельно — в БД `app_settings`,
 * чтобы менять без передеплоя. Редактируется через Supabase Studio
 * либо через миграцию `011_app_settings.sql` (там seed).
 */

export interface BriefConfig {
  business: {
    /** Внутреннее короткое имя (для логов, заголовков). */
    name: string;
    /** Описание продукта 1-2 предложения. */
    product: string;
    /** ISO 639-1 язык контента: 'ru', 'en', 'de', ... */
    language: string;
    /** Кто целевая аудитория. */
    audience: string;
  };

  /**
   * Контекст, который вставляется в системные промпты Claude.
   * Сюда — длинный текст, всё что AI должен знать про бизнес.
   * Используется в /api/ai/analyze-performance, recommend, generate-briefs.
   */
  ai_context: string;

  /**
   * Потоки лидов = разрезы аналитики и Meta-аккаунты.
   * Минимум один. Каждый flow имеет код (для парсинга имён) и Meta ad account.
   */
  flows: Array<{
    code: string;            // 'com', 'gov', 'b2c', ...
    label: string;           // UI-лейбл, "Коммерческий"
    description?: string;    // подсказка для контекста
    meta_account_env: string; // имя env-переменной с ID аккаунта, напр. "META_AD_ACCOUNT_ID_COM"
  }>;

  /**
   * Воронка лидов — стадии и средний цикл сделки.
   * cycle_days_max используется для red flag low_roas (порог возраста).
   */
  funnel: {
    stages: string[];        // ['lead', 'qual_lead', 'transaction']
    cycle_days_min: number;
    cycle_days_max: number;
  };

  /**
   * Параметры креативной матрицы. Кол-во и имена параметров определяют
   * формат имени объявления и интерпретацию кодов.
   */
  creative_matrix: {
    /**
     * Параметры. Порядок важен — он определяет формат имени.
     * letter — короткий префикс кода (P, H, B, A).
     * label — UI-название.
     */
    params: Array<{
      key: "persona" | "hook" | "body" | "angle" | string; // используется как paramType
      letter: string;          // 'P', 'H', 'B', 'A'
      label: string;           // 'Персона', 'Хук', 'Боди', 'Энгл'
      color: string;           // hex для UI
    }>;
    formats: string[];         // 'UGC', 'STATIC', 'ANIMATION', 'HUMAN', 'MIXED'
    /**
     * Регулярка для парсинга имени объявления.
     * Group order должен совпадать с params[*].letter + затем format + flow.
     * Пример для P-H-B-A-FORMAT-FLOW:
     *   ^P(\d+)-H(\d+)-B(\d+)-A(\d+)-(UGC|STATIC|ANIMATION|HUMAN|MIXED)-(COM|GOV)$
     */
    name_pattern_template: string; // см. buildNameRegex() в lib/naming.ts
  };

  /**
   * Голос бренда — попадает в промпты при генерации брифов/сценариев.
   */
  brand_voice: {
    tone: string;
    forbidden_words?: string[];
    style_notes?: string;
    /**
     * Правила транслитерации / произношения для диалогов и voice-over.
     * Каждая строка — одно правило. Например:
     *   "SternMeister пишем как ШтернМастер"
     *   "DATEV произносится как дАтэв (ударение на первый слог)"
     * Если пусто — секция в промпте не выводится.
     */
    dialogue_rules?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//                     ТЕКУЩАЯ КОНФИГУРАЦИЯ — SternMeister
// При форке проекта под другую компанию — меняй только эту константу.
// ─────────────────────────────────────────────────────────────────────────────

export const brief: BriefConfig = {
  business: {
    name: "SternMeister",
    product: "Онлайн-курс «Бухгалтер в Германии» — 7 месяцев, сертификат DEKRA, на русском",
    language: "ru",
    audience: "Русскоязычные иммигранты в Германии, ищущие работу",
  },

  ai_context: `
SternMeister — онлайн-школа бухгалтерии для русскоязычных иммигрантов в Германии.
Продукт: курс «Бухгалтер в Германии», 7 месяцев, сертификат DEKRA, обучение на русском языке.

Два потока лидов:
• COM (коммерческие) — платят сами, проблемный сегмент, CPQL стабильно выше плана.
• GOV (госники) — получают Bildungsgutschein через Jobcenter, государство платит.

Команда говорит по-русски, креативы на русском, посадочные на русском.
Целевая — иммигранты, часто без опыта работы в Германии, ищущие стабильную профессию.
  `.trim(),

  flows: [
    {
      code: "com",
      label: "Коммерческий",
      description: "Платят сами",
      meta_account_env: "META_AD_ACCOUNT_ID_COM",
    },
    {
      code: "gov",
      label: "Госники",
      description: "Bildungsgutschein через Jobcenter",
      meta_account_env: "META_AD_ACCOUNT_ID_GOV",
    },
  ],

  funnel: {
    stages: ["lead", "qual_lead", "transaction"],
    cycle_days_min: 14,
    cycle_days_max: 30,
  },

  creative_matrix: {
    params: [
      { key: "persona", letter: "P", label: "Персона", color: "#48B8D0" },
      { key: "hook",    letter: "H", label: "Хук",     color: "#C490D1" },
      { key: "body",    letter: "B", label: "Боди",    color: "#6EC8A0" },
      { key: "angle",   letter: "A", label: "Энгл",    color: "#FF8B5A" },
    ],
    formats: ["UGC", "STATIC", "ANIMATION", "HUMAN", "MIXED"],
    name_pattern_template: "P{n}-H{n}-B{n}-A{n}-FORMAT-FLOW",
  },

  brand_voice: {
    tone: "Прямой, с конкретными примерами из жизни. Без воды и обещаний быстрого результата.",
    forbidden_words: [],
    style_notes: "Можно использовать немецкие термины (Steuer, Jobcenter, Bildungsgutschein) — целевая знакома с ними. Не использовать сленг и анекдоты.",
    dialogue_rules: [
      "В диалогах писать «ШтернМастер», не «SternMeister» — это правильное произношение",
      "DATEV произносится как «дАтэв» (ударение на первый слог) — пишем именно «дАтэв» в диалогах",
      "Без длинных тире в репликах — Higgsfield/voice-генерация плохо их обрабатывает",
    ],
  },
};
