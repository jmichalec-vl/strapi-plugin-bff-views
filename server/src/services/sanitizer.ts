import type { Core } from '@strapi/types';

/**
 * Wraps strapi.contentAPI.sanitize.output against the full content-type model,
 * which recurses into components/dynamic zones/media and strips `private: true`
 * attributes. This runs before transform/assemble so private fields can never
 * leak through custom shapes - and it must not rely on the schema IR, which
 * does not track privacy.
 */
const sanitizer = ({ strapi }: { strapi: Core.Strapi }) => {
  const sanitizeDocument = async (data: unknown, uid: string, auth: unknown): Promise<unknown> => {
    if (data === null || data === undefined) return null;
    const model = strapi.getModel(uid as Parameters<typeof strapi.getModel>[0]);
    return strapi.contentAPI.sanitize.output(data, model, { auth });
  };

  return { sanitizeDocument };
};

export default sanitizer;
