import fs from 'node:fs/promises';
import path from 'node:path';
import type { Core } from '@strapi/strapi';

type SeedData = {
  site: Record<string, unknown>;
  pages: Array<Record<string, unknown>>;
  articles: Array<Record<string, unknown>>;
};

async function readSeed(): Promise<SeedData> {
  const seedPath = path.resolve(process.cwd(), '..', 'data', 'hms-seed.json');
  const seed = await fs.readFile(seedPath, 'utf8');
  return JSON.parse(seed);
}

async function upsertSingle(strapi: Core.Strapi, uid: string, data: Record<string, unknown>) {
  const documents = (strapi.documents as any)(uid);
  const current =
    (await documents.findFirst({ status: 'draft' })) ||
    (await documents.findFirst({ status: 'published' }));

  if (current?.documentId) {
    await documents.update({ documentId: current.documentId, data, status: 'published' });
    return;
  }

  await documents.create({ data, status: 'published' });
}

async function upsertBySlug(
  strapi: Core.Strapi,
  uid: string,
  data: Record<string, unknown>,
  order: number
) {
  const documents = (strapi.documents as any)(uid);
  const filters = { slug: { $eq: data.slug } };
  const current =
    (await documents.findFirst({ filters, status: 'draft' })) ||
    (await documents.findFirst({ filters, status: 'published' }));
  const payload = { ...data, order };

  if (current?.documentId) {
    await documents.update({ documentId: current.documentId, data: payload, status: 'published' });
    return;
  }

  await documents.create({ data: payload, status: 'published' });
}

async function ensurePublicPermissions(strapi: Core.Strapi) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' }
  });

  if (!publicRole) return;

  const actions = [
    'api::page.page.find',
    'api::page.page.findOne',
    'api::article.article.find',
    'api::article.article.findOne',
    'api::site-setting.site-setting.find'
  ];

  for (const action of actions) {
    const permission = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: { action, role: publicRole.id }
    });

    if (!permission) {
      await strapi.db.query('plugin::users-permissions.permission').create({
        data: { action, role: publicRole.id }
      });
    }
  }
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const seed = await readSeed();

    await upsertSingle(strapi, 'api::site-setting.site-setting', seed.site);

    for (const [index, page] of seed.pages.entries()) {
      await upsertBySlug(strapi, 'api::page.page', page, index + 1);
    }

    for (const [index, article] of seed.articles.entries()) {
      await upsertBySlug(strapi, 'api::article.article', article, index + 1);
    }

    await ensurePublicPermissions(strapi);
  },
};
