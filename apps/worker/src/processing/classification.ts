import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import type { DocumentAiEntities } from '@docunest/shared-types';

import { getWorkerEnvironment } from '../env';

export type CategoryOption = {
  slug: string;
  name: string;
};

export type ClassificationResult = {
  categorySlug: string;
  confidence: number;
  summary: string;
  suggestedNewCategory: string | null;
  entities: DocumentAiEntities;
};

const UNCATEGORIZED_SLUG = 'uncategorized';

let cachedClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const environment = getWorkerEnvironment();
  // BullMQ already retries the whole job (3 attempts, exponential backoff)
  // on any thrown error, so the OpenAI client's own retries are disabled
  // here to avoid two independent, uncoordinated retry loops stacking
  // their delays on top of each other.
  cachedClient = new OpenAI({
    apiKey: environment.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: 60_000,
  });

  return cachedClient;
}

function buildEntitiesSchema() {
  return z.object({
    vendor: z.string().nullable(),
    amount: z.string().nullable(),
    date: z.string().nullable(),
  });
}

function buildClassificationSchema(categories: CategoryOption[]) {
  const allowedSlugs = [
    ...categories.map((category) => category.slug),
    UNCATEGORIZED_SLUG,
  ];

  return z.object({
    // `allowedSlugs` always has at least one element (UNCATEGORIZED_SLUG),
    // but that's a runtime fact zod's tuple-typed `enum()` signature can't
    // see from a plain `string[]`.
    category_slug: z.enum(allowedSlugs as unknown as [string, ...string[]]),
    confidence: z.number().min(0).max(1),
    summary: z.string().max(400),
    suggested_new_category: z.string().nullable(),
    entities: buildEntitiesSchema(),
  });
}

/**
 * Stable content (instructions + the user's actual category list) comes
 * before the variable document text in the user message, which is what
 * makes automatic prompt-caching effective — see the system prompt below,
 * which never varies per-document for a given user.
 */
function buildSystemPrompt(categories: CategoryOption[]): string {
  const categoryList = categories
    .map((category) => `- ${category.slug}: ${category.name}`)
    .join('\n');

  return [
    'You are DocuNest\'s document classification assistant. DocuNest is a personal document vault: users upload or forward in documents like receipts, tickets, bills, and contracts, and you file each one into one of the user\'s existing categories and summarize it.',
    '',
    "The user's categories (slug: name):",
    categoryList,
    `- ${UNCATEGORIZED_SLUG}: (use only if truly nothing fits and you have no better suggestion)`,
    '',
    'Rules:',
    '- category_slug must be exactly one of the slugs listed above.',
    '- confidence is your genuine confidence in that category assignment, from 0 (no idea) to 1 (certain).',
    '- summary is at most 40 words, plain language, describing what the document is and its key facts.',
    "- suggested_new_category is null unless none of the existing categories fit well, in which case propose a short, human-readable new category name (do not use an existing slug or name).",
    '- entities.vendor, entities.amount and entities.date are extracted from the document when present, or null when not applicable/found. amount should include a currency symbol or code when known. date should be in the format it appears in the document.',
    '- Base your answer only on the provided filename and extracted text. If the text looks garbled, truncated, or non-existent, say so honestly with a low confidence rather than guessing.',
  ].join('\n');
}

export async function classifyDocument(params: {
  filename: string;
  extractedText: string;
  categories: CategoryOption[];
}): Promise<ClassificationResult> {
  const environment = getWorkerEnvironment();
  const client = getOpenAiClient();
  const schema = buildClassificationSchema(params.categories);

  const completion = await client.chat.completions.parse({
    model: environment.OPENAI_CLASSIFICATION_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(params.categories) },
      {
        role: 'user',
        content: `Filename: ${params.filename}\n\nExtracted document text (may be truncated):\n${params.extractedText || '(no text could be extracted from this file)'}`,
      },
    ],
    response_format: zodResponseFormat(schema, 'document_classification'),
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error(
      'OpenAI response did not include a parsed structured result.',
    );
  }

  return {
    categorySlug: parsed.category_slug,
    confidence: parsed.confidence,
    summary: parsed.summary,
    suggestedNewCategory: parsed.suggested_new_category,
    entities: parsed.entities,
  };
}
